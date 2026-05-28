import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  agentConfigs,
  appointmentReminders,
  appointmentsCache,
  clinicSettings,
  reminderMessageTemplates,
  reminderRuleSets,
  reminderRules,
  tenants,
  treatments,
  whatsappConnections,
  whatsappContacts,
} from '@/lib/db/schema';
import { getContact, type GhlContact } from '@/lib/ghl/contacts';
import { sendQueueEvent, reminderSendJobId } from '@/lib/queue/client';
import { cancelReminders } from '@/lib/reminders/cancel';
import { applyQuietHours, type WorkingHours } from '@/lib/reminders/quiet-hours';
import { logReminderSkip } from '@/lib/reminders/skip-log';
import { driverScopeForWhatsAppMode } from '@/lib/reminders/template-resolver';
import { buildReminderVars } from '@/lib/reminders/variables';

// ─────────────────────────────────────────────────────────────────────────────
// Materializa los recordatorios programados de una cita.
//
// Disparada por:
//   - webhook GHL AppointmentCreate  → reason='create'
//   - webhook GHL AppointmentUpdate  → reason='update' (cancela pending + re-materializa)
//   - sync manual                    → reason='sync'
//
// Idempotente por unique (tenant_id, ghl_appointment_id, rule_id). Si la
// función corre 2 veces para la misma cita+regla, hace UPDATE (re-schedule)
// en lugar de duplicar.
// ─────────────────────────────────────────────────────────────────────────────

export type MaterializeReason = 'create' | 'update' | 'sync';

export type MaterializeResult = {
  scheduled: number;
  skipped: { reason: string; ruleId?: string | null }[];
};

export async function materializeReminders(args: {
  tenantId: string;
  ghlAppointmentId: string;
  reason: MaterializeReason;
}): Promise<MaterializeResult> {
  const { tenantId, ghlAppointmentId, reason } = args;
  const result: MaterializeResult = { scheduled: 0, skipped: [] };

  // Si es update, primero cancelar los SCHEDULED para evitar enviar a horario viejo.
  if (reason === 'update') {
    await cancelReminders({ tenantId, ghlAppointmentId, reason: 'rescheduled' });
  }

  // Cargar appointment desde la cache (debe estar populada por el webhook GHL).
  const [appt] = await db
    .select()
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        eq(appointmentsCache.ghlAppointmentId, ghlAppointmentId),
      ),
    )
    .limit(1);

  if (!appt || !appt.startTime) {
    await logReminderSkip({
      tenantId,
      ghlAppointmentId,
      reason: 'past_due',
      details: { reason: 'no_start_time' },
    });
    return { ...result, skipped: [...result.skipped, { reason: 'no_start_time' }] };
  }

  if (appt.startTime.getTime() < Date.now()) {
    await logReminderSkip({
      tenantId,
      ghlAppointmentId,
      reason: 'past_due',
      details: { startTime: appt.startTime.toISOString() },
    });
    return { ...result, skipped: [...result.skipped, { reason: 'past_due' }] };
  }

  // Resolver tenant + clinic settings + treatment.
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) return result;

  const [clinic] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);

  let treatment: typeof treatments.$inferSelect | null = null;
  if (appt.treatmentId) {
    const [t] = await db
      .select()
      .from(treatments)
      .where(eq(treatments.id, appt.treatmentId))
      .limit(1);
    treatment = t ?? null;
  }

  // Resolver rule set efectivo: TREATMENT override > GLOBAL.
  let ruleSet: typeof reminderRuleSets.$inferSelect | null = null;
  if (treatment) {
    const [rs] = await db
      .select()
      .from(reminderRuleSets)
      .where(
        and(
          eq(reminderRuleSets.tenantId, tenantId),
          eq(reminderRuleSets.scope, 'TREATMENT'),
          eq(reminderRuleSets.treatmentId, treatment.id),
          eq(reminderRuleSets.enabled, true),
        ),
      )
      .limit(1);
    if (rs) ruleSet = rs;
  }
  if (!ruleSet) {
    const [global] = await db
      .select()
      .from(reminderRuleSets)
      .where(
        and(
          eq(reminderRuleSets.tenantId, tenantId),
          eq(reminderRuleSets.scope, 'GLOBAL'),
          eq(reminderRuleSets.enabled, true),
        ),
      )
      .limit(1);
    ruleSet = global ?? null;
  }

  if (!ruleSet) {
    await logReminderSkip({ tenantId, ghlAppointmentId, reason: 'no_rules' });
    return { ...result, skipped: [...result.skipped, { reason: 'no_rules' }] };
  }

  // Cargar reglas enabled, ordenadas.
  const rules = await db
    .select()
    .from(reminderRules)
    .where(and(eq(reminderRules.ruleSetId, ruleSet.id), eq(reminderRules.enabled, true)))
    .orderBy(asc(reminderRules.order));

  if (rules.length === 0) {
    await logReminderSkip({ tenantId, ghlAppointmentId, reason: 'no_rules' });
    return { ...result, skipped: [...result.skipped, { reason: 'no_rules' }] };
  }

  // Resolver phone del contacto: GHL API primero, fallback whatsapp_contacts.
  let ghlContact: GhlContact | null = null;
  if (appt.contactId) {
    ghlContact = await getContact(tenantId, appt.contactId);
  }
  let phoneE164 = ghlContact?.phone?.trim() || null;
  if (!phoneE164 && appt.contactId) {
    const [wac] = await db
      .select()
      .from(whatsappContacts)
      .where(
        and(
          eq(whatsappContacts.tenantId, tenantId),
          eq(whatsappContacts.ghlContactId, appt.contactId),
        ),
      )
      .limit(1);
    phoneE164 = wac?.phoneE164 ?? null;
  }

  if (!phoneE164) {
    await logReminderSkip({
      tenantId,
      ghlAppointmentId,
      reason: 'no_phone',
      details: { contactId: appt.contactId },
    });
    return { ...result, skipped: [...result.skipped, { reason: 'no_phone' }] };
  }

  // Detectar canales disponibles para este tenant.
  const [waConn] = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.tenantId, tenantId),
        eq(whatsappConnections.status, 'CONNECTED'),
      ),
    )
    .orderBy(desc(whatsappConnections.updatedAt))
    .limit(1);

  const [outboundAgent] = await db
    .select({ retellAgentId: agentConfigs.retellAgentId })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.role, 'outbound')))
    .limit(1);

  const hasWhatsApp = !!waConn;
  const hasVoiceAgent = !!outboundAgent?.retellAgentId || !!process.env.RETELL_OUTBOUND_DEFAULT_AGENT_ID;

  // Variables para snapshot (sobrevive a cambios en GHL/cache).
  const vars = buildReminderVars({
    appointmentStartTime: appt.startTime,
    appointmentDurationMinutes: treatment?.durationMinutes ?? null,
    treatmentName: treatment?.name ?? null,
    contactFirstName: ghlContact?.firstName ?? null,
    contactLastName: ghlContact?.lastName ?? null,
    contactPhoneE164: phoneE164,
    clinicName: tenant.name,
    clinicAddress: clinic?.address ?? null,
    clinicPhone: clinic?.phones?.[0] ?? null,
    clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
    reminderId: '__placeholder__',
  });

  const timezone = clinic?.timezone ?? 'Europe/Madrid';
  const workingHours = (clinic?.workingHours ?? null) as WorkingHours | null;

  for (const rule of rules) {
    // Calcular scheduledFor base.
    const rawScheduled = new Date(appt.startTime.getTime() - rule.offsetMinutes * 60_000);
    if (rawScheduled.getTime() < Date.now()) {
      await logReminderSkip({
        tenantId,
        ghlAppointmentId,
        ruleId: rule.id,
        reason: 'past_due',
        details: { offsetMinutes: rule.offsetMinutes },
      });
      result.skipped.push({ reason: 'past_due', ruleId: rule.id });
      continue;
    }

    // Aplicar quiet hours.
    const outcome = applyQuietHours({
      scheduledFor: rawScheduled,
      appointmentStart: appt.startTime,
      timeZone: timezone,
      workingHours,
      mode: ruleSet.quietMode,
    });

    if (outcome.kind === 'skip') {
      await logReminderSkip({
        tenantId,
        ghlAppointmentId,
        ruleId: rule.id,
        reason: 'quiet_hours_full_day',
      });
      result.skipped.push({ reason: 'quiet_hours_full_day', ruleId: rule.id });
      continue;
    }

    // Determinar canal final (swap a fallback si primary no disponible).
    let channelPlanned: 'WHATSAPP' | 'VOICE' = rule.primaryChannel;
    if (channelPlanned === 'WHATSAPP' && !hasWhatsApp) {
      if (rule.fallbackChannel === 'VOICE' && hasVoiceAgent) {
        channelPlanned = 'VOICE';
      } else {
        await logReminderSkip({
          tenantId,
          ghlAppointmentId,
          ruleId: rule.id,
          reason: 'no_whatsapp',
        });
        result.skipped.push({ reason: 'no_whatsapp', ruleId: rule.id });
        continue;
      }
    }
    if (channelPlanned === 'VOICE' && !hasVoiceAgent) {
      if (rule.fallbackChannel === 'WHATSAPP' && hasWhatsApp) {
        channelPlanned = 'WHATSAPP';
      } else {
        await logReminderSkip({
          tenantId,
          ghlAppointmentId,
          ruleId: rule.id,
          reason: 'no_voice_agent',
        });
        result.skipped.push({ reason: 'no_voice_agent', ruleId: rule.id });
        continue;
      }
    }

    // Verificar que exista un template para (rule, canal, driverScope) activo.
    const driverScope =
      channelPlanned === 'VOICE'
        ? ('voice_retell' as const)
        : waConn
          ? driverScopeForWhatsAppMode(waConn.mode)
          : ('whatsapp_evolution' as const);

    // Suficiente con que exista AL MENOS UN template enabled del canal para
    // la regla — resolveTemplate hace su propio fallback en send-time
    // (driver exacto → primer template del canal).
    const templates = await db
      .select({ id: reminderMessageTemplates.id })
      .from(reminderMessageTemplates)
      .where(
        and(
          eq(reminderMessageTemplates.ruleId, rule.id),
          eq(reminderMessageTemplates.channel, channelPlanned),
          eq(reminderMessageTemplates.enabled, true),
        ),
      );

    if (templates.length === 0) {
      await logReminderSkip({
        tenantId,
        ghlAppointmentId,
        ruleId: rule.id,
        reason: 'no_template',
        details: { channel: channelPlanned, driverScope },
      });
      result.skipped.push({ reason: 'no_template', ruleId: rule.id });
      continue;
    }

    // INSERT ON CONFLICT (UPSERT) en appointment_reminders.
    const [inserted] = await db
      .insert(appointmentReminders)
      .values({
        tenantId,
        ghlAppointmentId,
        ruleId: rule.id,
        ruleSetId: ruleSet.id,
        scheduledFor: outcome.scheduledFor,
        channelPlanned,
        status: 'SCHEDULED',
        payloadSnapshot: {
          vars,
          appointment: {
            startTime: appt.startTime.toISOString(),
            endTime: appt.endTime?.toISOString() ?? null,
            calendarId: appt.calendarId,
            contactId: appt.contactId,
            treatmentId: appt.treatmentId,
          },
        },
      })
      .onConflictDoUpdate({
        target: [
          appointmentReminders.tenantId,
          appointmentReminders.ghlAppointmentId,
          appointmentReminders.ruleId,
        ],
        set: {
          scheduledFor: outcome.scheduledFor,
          channelPlanned,
          status: 'SCHEDULED',
          failureReason: null,
          sentAt: null,
          channelUsed: null,
          payloadSnapshot: {
            vars,
            appointment: {
              startTime: appt.startTime.toISOString(),
              endTime: appt.endTime?.toISOString() ?? null,
              calendarId: appt.calendarId,
              contactId: appt.contactId,
              treatmentId: appt.treatmentId,
            },
          },
          updatedAt: new Date(),
        },
      })
      .returning({ id: appointmentReminders.id });

    if (!inserted) continue;

    // Persistir el bullJobId calculado (rem-send-<id>) y encolar.
    const jobId = reminderSendJobId(inserted.id);
    await db
      .update(appointmentReminders)
      .set({ bullJobId: jobId, updatedAt: new Date() })
      .where(eq(appointmentReminders.id, inserted.id));

    await sendQueueEvent(
      'reminder-send',
      { tenantId, reminderId: inserted.id },
      { delayMs: Math.max(0, outcome.scheduledFor.getTime() - Date.now()) },
    );

    result.scheduled++;
  }

  return result;
}
