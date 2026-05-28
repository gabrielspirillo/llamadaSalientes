import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  clinicSettings,
  reminderRules,
  tenants,
  treatments,
} from '@/lib/db/schema';
import { getContact } from '@/lib/ghl/contacts';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';
import { sendVoiceReminder } from '@/lib/reminders/send-voice';
import { sendWhatsAppReminder } from '@/lib/reminders/send-whatsapp';
import { buildReminderVars } from '@/lib/reminders/variables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  ruleId: z.string().uuid(),
  toPhoneE164: z.string().regex(/^\+\d{7,15}$/, 'Teléfono debe estar en formato E.164 (+...)'),
  sampleGhlAppointmentId: z.string().min(1).optional(),
});

// POST /api/reminders/test-send (admin)
// Envía un reminder real al número indicado, usando datos demo o de una cita.
// No persiste en appointment_reminders — es solo para validar template/canal.

export async function POST(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('admin');
  } catch (err) {
    return errResp(err);
  }
  const { tenantId } = auth;

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', issues: parsed.error.issues }, { status: 400 });
  }

  const [rule] = await db
    .select()
    .from(reminderRules)
    .where(and(eq(reminderRules.id, parsed.data.ruleId), eq(reminderRules.tenantId, tenantId)))
    .limit(1);
  if (!rule) return NextResponse.json({ error: 'Regla no encontrada' }, { status: 404 });

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const [clinic] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);

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
      contactFirstName: ghlContact?.firstName ?? '[TEST]',
      contactLastName: ghlContact?.lastName ?? null,
      contactPhoneE164: parsed.data.toPhoneE164,
      clinicName: tenant?.name ?? 'la clínica',
      clinicAddress: clinic?.address ?? null,
      clinicPhone: clinic?.phones?.[0] ?? null,
      clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
      reminderId: `test-${Date.now()}`,
    });
  } else {
    vars = buildReminderVars({
      appointmentStartTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      appointmentDurationMinutes: 45,
      treatmentName: '[TEST] Limpieza dental',
      contactFirstName: '[TEST] María',
      contactLastName: null,
      contactPhoneE164: parsed.data.toPhoneE164,
      clinicName: tenant?.name ?? 'la clínica',
      clinicAddress: clinic?.address ?? null,
      clinicPhone: clinic?.phones?.[0] ?? null,
      clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
      reminderId: `test-${Date.now()}`,
    });
  }

  // Para test-send NO insertamos appointment_reminders — usamos un id ad-hoc.
  // El sender espera tener un reminder real en BD, así que para no romper, en
  // test-send delegamos a una versión más liviana. Hacemos un INSERT temporal
  // sólo si hace falta — más simple es llamar a los connectors directamente.

  if (rule.primaryChannel === 'WHATSAPP') {
    // Truco: crear un fake reminderId. El sender necesita un reminder real
    // para resolver el template (lee por rule_id). Aquí pasamos un id ficticio
    // y el sender va a fallar al cargar el reminder. Mejor inyectamos el
    // ruleId directamente — pero el sender no soporta eso. Solución pragmática:
    // hacer un INSERT temporal y borrar después.
    // Por simplicidad v1: devolver mensaje informando que test-send requiere
    // una regla con plantilla pre-configurada (el flujo principal igual la
    // requiere) y que usaremos un reminder transitorio.
    return NextResponse.json({
      ok: false,
      error:
        'Test-send WhatsApp todavía no implementado v1. Usá un reminder real desde el pipeline para probar.',
    }, { status: 501 });
  }

  if (rule.primaryChannel === 'VOICE') {
    const result = await sendVoiceReminder({
      tenantId,
      reminderId: `test-${Date.now()}`,
      toPhoneE164: parsed.data.toPhoneE164,
      vars,
      contactDisplayName: vars.contact.fullName,
      appointmentContactId: null,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 502 });
    }
    return NextResponse.json({ ok: true, callId: result.callId });
  }

  return NextResponse.json({ error: 'Canal no soportado' }, { status: 400 });
}

function errResp(err: unknown): NextResponse {
  if (err instanceof ReminderForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
