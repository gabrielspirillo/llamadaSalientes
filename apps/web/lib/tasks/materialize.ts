import 'server-only';
import { and, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';

import { inactivePatients, patientsWithPendingFollowUp } from '@/lib/agenda/sweeps';
import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  clinicSettings,
  patientsCache,
  taskTemplates,
  tenants,
} from '@/lib/db/schema';
import { runTaskAutomation } from '@/lib/tasks/automation';
import { type RecurrenceSpec, pendingOccurrences } from '@/lib/tasks/recurrence';
import { createTask } from '@/lib/tasks/service';
import { loadTemplateItems } from '@/lib/tasks/templates';
import { localDateKey, parseDateKey, parseTimeOfDay, zonedToUtc } from '@/lib/tasks/tz';

const DEFAULT_TZ = 'Europe/Madrid';

export async function getTenantTimezone(tenantId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  return row?.timezone || DEFAULT_TZ;
}

export async function listActiveTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(sql`${tenants.status} not in ('suspended', 'archived')`);
  return rows.map((r) => r.id);
}

/**
 * Materializa las rutinas que tocan hoy (y las de la ventana `lead_days`).
 *
 * Idempotente por partida doble: `dedupe_key` único en la tabla y
 * `last_materialized_on` en la plantilla. Se puede correr cada 15 minutos sin
 * generar nada de más.
 */
export async function materializeRoutinesForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ created: number; templates: number }> {
  const tz = await getTenantTimezone(tenantId);
  const todayKey = localDateKey(now, tz);

  const templates = await db
    .select()
    .from(taskTemplates)
    .where(and(eq(taskTemplates.tenantId, tenantId), eq(taskTemplates.enabled, true)));
  if (templates.length === 0) return { created: 0, templates: 0 };

  const itemsByTemplate = await loadTemplateItems(
    tenantId,
    templates.map((t) => t.id),
  );

  let created = 0;

  for (const tpl of templates) {
    const spec: RecurrenceSpec = {
      freq: tpl.recurrenceFreq,
      interval: tpl.recurrenceInterval,
      weekdays: tpl.recurrenceWeekdays ?? [],
      monthDay: tpl.recurrenceMonthDay,
      month: tpl.recurrenceMonth,
      anchorDateKey: localDateKey(tpl.createdAt, tz),
    };

    const days = pendingOccurrences({
      spec,
      todayKey,
      leadDays: tpl.leadDays,
      lastMaterializedOn: tpl.lastMaterializedOn,
    });

    for (const dayKey of days) {
      const parts = parseDateKey(dayKey);
      if (!parts) continue;
      const { hour, minute } = parseTimeOfDay(tpl.dueTime);
      const dueAt = zonedToUtc(parts.year, parts.month, parts.day, hour, minute, tz);

      const res = await createTask({
        tenantId,
        title: tpl.name,
        description: tpl.description,
        category: tpl.category,
        priority: tpl.priority,
        dueAt,
        source: 'ROUTINE',
        templateId: tpl.id,
        dedupeKey: `routine:${tpl.id}:${dayKey}`,
        requiresEvidence: tpl.requiresEvidence,
        labels: tpl.defaultRole ? [tpl.defaultRole] : [],
        assigneeUserIds: tpl.defaultAssigneeUserId ? [tpl.defaultAssigneeUserId] : [],
        checklist: (itemsByTemplate.get(tpl.id) ?? []).map((i) => i.content),
        activityNote: `Generada por la rutina "${tpl.name}"`,
      });
      if (res.created) created += 1;
    }

    // Una ocurrencia de un día ya pasado que nadie marcó no se puede hacer
    // (la apertura de ayer): si ya hay otra más nueva de la misma rutina, se
    // archiva en vez de acumularse. Archivar no borra: queda como registro.
    await archiveSupersededOccurrences(tenantId, tpl.id, todayKey, tz).catch((err) => {
      console.warn('[tasks] archivar rutinas pasadas falló', (err as Error).message);
    });

    // Avanzamos la marca aunque no haya tocado ningún día: lo que importa es
    // hasta dónde ya se evaluó la plantilla.
    await db
      .update(taskTemplates)
      .set({ lastMaterializedOn: todayKey, updatedAt: new Date() })
      .where(eq(taskTemplates.id, tpl.id));
  }

  return { created, templates: templates.length };
}

/**
 * Archiva las ocurrencias abiertas de una rutina cuyo día ya pasó y que tienen
 * otra ocurrencia más nueva. La de hoy nunca, aunque ya exista la de mañana.
 */
async function archiveSupersededOccurrences(
  tenantId: string,
  templateId: string,
  todayKey: string,
  tz: string,
): Promise<void> {
  const p = parseDateKey(todayKey);
  if (!p) return;
  const todayStart = zonedToUtc(p.year, p.month, p.day, 0, 0, tz).toISOString();
  await db.execute(sql`
    update tasks t
       set archived_at = now(), updated_at = now()
     where t.tenant_id = ${tenantId}::uuid
       and t.template_id = ${templateId}::uuid
       and t.source = 'ROUTINE'
       and t.archived_at is null
       and t.status <> 'DONE'
       and t.due_at < ${todayStart}::timestamptz
       and exists (
         select 1 from tasks n
          where n.tenant_id = t.tenant_id
            and n.template_id = t.template_id
            and n.due_at > t.due_at
       )
  `);
}

/**
 * Barridos diarios sobre datos "de estado" (no eventos): presupuestos aceptados
 * sin agendar y pacientes inactivos.
 *
 * Estos dos no tienen webhook que los dispare — nadie emite "este presupuesto
 * lleva tres semanas parado". Por eso se recalculan cada día.
 *
 * Dedupe mensual: si el paciente sigue sin agendar, la tarea reaparece el mes
 * siguiente en vez de todos los días.
 */
export async function runDailySweepsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ pendingTreatment: number; inactive: number }> {
  const tz = await getTenantTimezone(tenantId);
  const monthKey = localDateKey(now, tz).slice(0, 7); // YYYY-MM

  // Contactos con alguna cita futura: se excluyen de los dos barridos.
  const futureRows = await db
    .select({ contactId: appointmentsCache.contactId })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        gt(appointmentsCache.startTime, now),
        isNotNull(appointmentsCache.contactId),
      ),
    );
  const hasFuture = new Set(futureRows.map((r) => r.contactId).filter(Boolean) as string[]);

  // ── Presupuestos aceptados sin cita ────────────────────────────────────────
  const pending = await db
    .select({
      ghlContactId: patientsCache.ghlContactId,
      firstName: patientsCache.firstName,
      lastName: patientsCache.lastName,
      phone: patientsCache.phone,
      pendingTreatment: patientsCache.pendingTreatment,
      lastVisitAt: patientsCache.lastVisitAt,
    })
    .from(patientsCache)
    .where(
      and(
        eq(patientsCache.tenantId, tenantId),
        isNotNull(patientsCache.pendingTreatment),
        sql`length(trim(${patientsCache.pendingTreatment})) > 0`,
      ),
    )
    .limit(500);

  // Los mismos pacientes, vistos desde la agenda de la plataforma: lo que el
  // profesional dejó anotado como siguiente paso en la historia clínica. Es la
  // única fuente para una clínica sin CRM, y en la práctica también para las
  // que lo tienen: `patients_cache` no la rellena nadie.
  // Con perfil de atención (Respinens) el "próximo paso" de la nota es
  // clínico ("revisar en 15 días"), no un presupuesto: la tarea "Perseguir
  // presupuesto" sólo hacía ruido (9/11).
  const { getCareProfileSafe } = await import('@/lib/care-profile/queries');
  const pendingOwn = (await getCareProfileSafe(tenantId))
    ? []
    : await patientsWithPendingFollowUp(tenantId).catch((err) => {
        console.warn('[tasks-sweep] seguimientos pendientes de la agenda', err);
        return [];
      });

  let pendingCreated = 0;
  for (const p of pending) {
    if (hasFuture.has(p.ghlContactId)) continue;
    const r = await runTaskAutomation({
      tenantId,
      trigger: 'PENDING_TREATMENT_UNSCHEDULED',
      context: {
        patientName: fullName(p.firstName, p.lastName),
        phone: p.phone,
        treatment: p.pendingTreatment,
        date: p.lastVisitAt ? formatDate(p.lastVisitAt, tz) : null,
        patientGhlContactId: p.ghlContactId,
        dedupeSuffix: `${p.ghlContactId}:${monthKey}`,
      },
    });
    if (r.created) pendingCreated += 1;
  }

  for (const p of pendingOwn) {
    if (hasFuture.has(p.patientKey)) continue;
    const r = await runTaskAutomation({
      tenantId,
      trigger: 'PENDING_TREATMENT_UNSCHEDULED',
      context: {
        patientName: p.name,
        phone: p.phone,
        treatment: p.pending,
        date: p.lastVisitAt ? formatDate(p.lastVisitAt, tz) : null,
        patientGhlContactId: p.patientKey,
        dedupeSuffix: `${p.patientKey}:${monthKey}`,
      },
    });
    if (r.created) pendingCreated += 1;
  }

  // ── Pacientes inactivos ────────────────────────────────────────────────────
  const inactiveMonths = await readInactiveMonths(tenantId);
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - inactiveMonths);

  const inactive = await db
    .select({
      ghlContactId: patientsCache.ghlContactId,
      firstName: patientsCache.firstName,
      lastName: patientsCache.lastName,
      phone: patientsCache.phone,
      lastVisitAt: patientsCache.lastVisitAt,
    })
    .from(patientsCache)
    .where(
      and(
        eq(patientsCache.tenantId, tenantId),
        isNotNull(patientsCache.lastVisitAt),
        lt(patientsCache.lastVisitAt, cutoff),
      ),
    )
    .limit(200);

  const inactiveOwn = await inactivePatients(tenantId, cutoff).catch((err) => {
    console.warn('[tasks-sweep] pacientes inactivos de la agenda', err);
    return [];
  });

  let inactiveCreated = 0;
  for (const p of inactive) {
    if (hasFuture.has(p.ghlContactId)) continue;
    const r = await runTaskAutomation({
      tenantId,
      trigger: 'PATIENT_INACTIVE',
      context: {
        patientName: fullName(p.firstName, p.lastName),
        phone: p.phone,
        date: p.lastVisitAt ? formatDate(p.lastVisitAt, tz) : null,
        patientGhlContactId: p.ghlContactId,
        dedupeSuffix: `${p.ghlContactId}:${monthKey}`,
      },
    });
    if (r.created) inactiveCreated += 1;
  }

  for (const p of inactiveOwn) {
    if (hasFuture.has(p.patientKey)) continue;
    const r = await runTaskAutomation({
      tenantId,
      trigger: 'PATIENT_INACTIVE',
      context: {
        patientName: p.name,
        phone: p.phone,
        date: p.lastVisitAt ? formatDate(p.lastVisitAt, tz) : null,
        patientGhlContactId: p.patientKey,
        dedupeSuffix: `${p.patientKey}:${monthKey}`,
      },
    });
    if (r.created) inactiveCreated += 1;
  }

  return { pendingTreatment: pendingCreated, inactive: inactiveCreated };
}

async function readInactiveMonths(tenantId: string): Promise<number> {
  const { taskAutomationRules } = await import('@/lib/db/schema');
  const [rule] = await db
    .select({ params: taskAutomationRules.params })
    .from(taskAutomationRules)
    .where(
      and(
        eq(taskAutomationRules.tenantId, tenantId),
        eq(taskAutomationRules.trigger, 'PATIENT_INACTIVE'),
        // El barrido usa un único umbral: el de la regla de sistema. Las de a
        // medida sobre este evento heredan esa ventana.
        eq(taskAutomationRules.isSystem, true),
      ),
    )
    .limit(1);
  const raw = (rule?.params as { inactiveMonths?: unknown } | undefined)?.inactiveMonths;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) : 12;
}

export function fullName(first: string | null, last: string | null): string {
  const v = [first, last].filter(Boolean).join(' ').trim();
  return v || 'Paciente sin nombre';
}

export function formatDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: tz,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: tz,
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
