import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  clinicSettings,
  reminderMessageTemplates,
  reminderRules,
  tenants,
  treatments,
  whatsappConnections,
} from '@/lib/db/schema';
import { getContact } from '@/lib/ghl/contacts';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';
import {
  defaultReminderButtons,
  driverScopeForWhatsAppMode,
  type ReminderTemplateRow,
  resolveTemplate,
} from '@/lib/reminders/template-resolver';
import { buildReminderVars, interpolate } from '@/lib/reminders/variables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  ruleId: z.string().uuid(),
  sampleGhlAppointmentId: z.string().min(1).optional(),
});

// POST /api/reminders/preview
// Devuelve el contenido renderizado del reminder para una regla + cita opcional.

export async function POST(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('viewer');
  } catch (err) {
    return errResp(err);
  }
  const { tenantId } = auth;

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', issues: parsed.error.issues }, { status: 400 });
  }

  // 1. Cargar regla.
  const [rule] = await db
    .select()
    .from(reminderRules)
    .where(and(eq(reminderRules.id, parsed.data.ruleId), eq(reminderRules.tenantId, tenantId)))
    .limit(1);
  if (!rule) return NextResponse.json({ error: 'Regla no encontrada' }, { status: 404 });

  // 2. Detectar driver activo.
  const [waConn] = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.status, 'CONNECTED')),
    )
    .limit(1);

  const driverScope =
    rule.primaryChannel === 'VOICE'
      ? 'voice_retell'
      : waConn
        ? driverScopeForWhatsAppMode(waConn.mode)
        : 'whatsapp_evolution';

  // 3. Templates.
  const templates = await db
    .select()
    .from(reminderMessageTemplates)
    .where(eq(reminderMessageTemplates.ruleId, rule.id));

  const template = resolveTemplate(
    templates as ReminderTemplateRow[],
    rule.primaryChannel,
    driverScope,
  );
  if (!template) {
    return NextResponse.json({
      channel: rule.primaryChannel,
      driverScope,
      rendered: null,
      error: 'No hay template configurado para esta regla y driver.',
    });
  }

  // 4. Cargar tenant + clinic.
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [clinic] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);

  // 5. Vars: sample o cita real.
  let vars;
  if (parsed.data.sampleGhlAppointmentId) {
    const [appt] = await db
      .select()
      .from(appointmentsCache)
      .where(
        and(
          eq(appointmentsCache.tenantId, tenantId),
          eq(appointmentsCache.ghlAppointmentId, parsed.data.sampleGhlAppointmentId),
        ),
      )
      .limit(1);
    if (!appt || !appt.startTime) {
      return NextResponse.json({ error: 'Cita de muestra no encontrada' }, { status: 404 });
    }
    let treatment: typeof treatments.$inferSelect | null = null;
    if (appt.treatmentId) {
      const [t] = await db
        .select()
        .from(treatments)
        .where(eq(treatments.id, appt.treatmentId))
        .limit(1);
      treatment = t ?? null;
    }
    const ghlContact = appt.contactId ? await getContact(tenantId, appt.contactId) : null;
    vars = buildReminderVars({
      appointmentStartTime: appt.startTime,
      appointmentDurationMinutes: treatment?.durationMinutes ?? null,
      treatmentName: treatment?.name ?? null,
      contactFirstName: ghlContact?.firstName ?? null,
      contactLastName: ghlContact?.lastName ?? null,
      contactPhoneE164: ghlContact?.phone ?? null,
      clinicName: tenant?.name ?? 'la clínica',
      clinicAddress: clinic?.address ?? null,
      clinicPhone: clinic?.phones?.[0] ?? null,
      clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
      reminderId: 'preview',
    });
  } else {
    // Datos de muestra demo.
    vars = buildReminderVars({
      appointmentStartTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      appointmentDurationMinutes: 45,
      treatmentName: 'Limpieza dental',
      contactFirstName: 'María',
      contactLastName: 'García',
      contactPhoneE164: '+34911234567',
      clinicName: tenant?.name ?? 'la clínica',
      clinicAddress: clinic?.address ?? null,
      clinicPhone: clinic?.phones?.[0] ?? null,
      clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
      reminderId: 'preview',
    });
  }

  // 6. Renderizar.
  const buttons = template.buttons.length > 0 ? template.buttons : defaultReminderButtons('preview');

  let renderedText: string;
  if (rule.primaryChannel === 'VOICE') {
    renderedText =
      template.voicePromptOverride ??
      `Hola ${vars.contact.firstName || vars.contact.fullName}, te recuerdo tu cita de ${vars.appointment.treatment} ${vars.appointment.dateTime}.`;
  } else if (driverScope === 'whatsapp_evolution') {
    renderedText = template.freeText
      ? interpolate(template.freeText, vars)
      : `Hola ${vars.contact.firstName}, tu cita de ${vars.appointment.treatment} es ${vars.appointment.dateTime}.`;
  } else {
    // Cloud / Twilio templates: render aproximado con params mapeados.
    const params = template.templateParamsMap.map((p) => {
      if ('source' in p) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cur: any = vars;
        for (const seg of p.source.split('.')) {
          const camel = seg.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
          if (cur == null || typeof cur !== 'object') {
            cur = '';
            break;
          }
          cur = cur[camel] ?? cur[seg];
        }
        return cur == null ? '' : String(cur);
      }
      if ('literal' in p) return p.literal;
      return '';
    });
    renderedText = `[Plantilla Meta: ${template.templateName ?? '(sin nombre)'}]\n${params.join(' · ')}`;
  }

  return NextResponse.json({
    channel: rule.primaryChannel,
    driverScope,
    templateName: template.templateName,
    renderedText,
    buttons,
  });
}

function errResp(err: unknown): NextResponse {
  if (err instanceof ReminderForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
