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
} from '@/lib/db/schema';
import { getContact } from '@/lib/ghl/contacts';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';
import { sendVoiceReminder } from '@/lib/reminders/send-voice';
import {
  resolveActiveConnection,
  sendWhatsAppDirect,
} from '@/lib/reminders/send-whatsapp';
import {
  driverScopeForWhatsAppMode,
  resolveTemplate,
  type ReminderTemplateRow,
} from '@/lib/reminders/template-resolver';
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

  // Para test-send NO insertamos appointment_reminders — usamos un id ad-hoc
  // en los botones. La función sendWhatsAppDirect acepta template + conn ya
  // resueltos sin necesidad de buscar un reminder en BD.
  const testReminderId = `test-${Date.now()}`;

  if (rule.primaryChannel === 'WHATSAPP') {
    const conn = await resolveActiveConnection(tenantId);
    if (!conn) {
      return NextResponse.json(
        { ok: false, error: 'No hay conexión de WhatsApp activa para este tenant.' },
        { status: 400 },
      );
    }
    const driverScope = driverScopeForWhatsAppMode(conn.mode);
    const templates = await db
      .select()
      .from(reminderMessageTemplates)
      .where(eq(reminderMessageTemplates.ruleId, rule.id));
    const template = resolveTemplate(
      templates as ReminderTemplateRow[],
      'WHATSAPP',
      driverScope,
    );
    if (!template) {
      return NextResponse.json(
        { ok: false, error: 'No hay plantilla configurada para esta regla y driver activo.' },
        { status: 400 },
      );
    }

    const result = await sendWhatsAppDirect({
      tenantId,
      conn,
      template,
      vars,
      toPhoneE164: parsed.data.toPhoneE164,
      contactDisplayName: vars.contact.fullName,
      reminderId: testReminderId,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      externalMessageId: result.externalMessageId,
      conversationId: result.conversationId,
      kind: result.kind,
    });
  }

  if (rule.primaryChannel === 'VOICE') {
    const result = await sendVoiceReminder({
      tenantId,
      reminderId: testReminderId,
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
  console.error('[reminders-api] auth error', err);
  return NextResponse.json(
    { error: (err as Error)?.message ?? 'Unauthorized' },
    { status: 401 },
  );
}
