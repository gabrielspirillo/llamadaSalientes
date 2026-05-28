import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  clinicSettings,
  tenants,
  treatments,
  waitlistMessageTemplates,
} from '@/lib/db/schema';
import { driverScopeForWhatsAppMode } from '@/lib/reminders/template-resolver';
import { resolveActiveConnection } from '@/lib/reminders/send-whatsapp';
import {
  WaitlistForbiddenError,
  requireWaitlistRole,
} from '@/lib/waitlist/auth';
import {
  sendWaitlistWhatsAppDirect,
  deriveContactDisplayNameFromWaitlistVars,
} from '@/lib/waitlist/send-whatsapp';
import { sendWaitlistVoice } from '@/lib/waitlist/send-voice';
import { resolveWaitlistTemplate } from '@/lib/waitlist/template-resolver';
import type { WaitlistTemplateRow } from '@/lib/waitlist/types';
import { buildWaitlistVars } from '@/lib/waitlist/variables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  channel: z.enum(['WHATSAPP', 'VOICE']),
  toPhoneE164: z.string().regex(/^\+\d{7,15}$/, 'Teléfono debe estar en formato E.164 (+...)'),
  treatmentId: z.string().uuid().nullable().optional(),
});

// POST /api/waitlist/test-send — manda una oferta REAL al teléfono indicado
// usando datos demo (no persiste waitlist_offers). Sirve para que el operador
// valide el copy en su propio teléfono antes de activar el módulo.
//
// Si el canal es VOICE, el agente outbound recibe use_case='waitlist_offer' y
// un offerId con prefijo `test-` que no resuelve en DB: si el paciente "acepta"
// en la prueba, el sistema responde "no encontré esa oferta" — no se cancela
// nada y no se agenda nada real.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('admin');
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const [clinic] = await db
      .select({
        timezone: clinicSettings.timezone,
        address: clinicSettings.address,
        phones: clinicSettings.phones,
      })
      .from(clinicSettings)
      .where(eq(clinicSettings.tenantId, tenantId))
      .limit(1);

    let durationMinutes: number | null = null;
    let treatmentName: string | null = null;
    if (parsed.data.treatmentId) {
      const [tx] = await db
        .select({ durationMinutes: treatments.durationMinutes, name: treatments.name })
        .from(treatments)
        .where(eq(treatments.id, parsed.data.treatmentId))
        .limit(1);
      durationMinutes = tx?.durationMinutes ?? null;
      treatmentName = tx?.name ?? null;
    }

    const demoOfferId = `test-${Date.now()}`;
    const vars = buildWaitlistVars({
      oldAppointmentStartTime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      newSlotStartTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      newSlotDurationMinutes: durationMinutes,
      treatmentName: treatmentName ?? 'limpieza',
      contactFirstName: 'María',
      contactLastName: 'Pérez',
      contactPhoneE164: parsed.data.toPhoneE164,
      clinicName: tenant?.name ?? 'la clínica',
      clinicAddress: clinic?.address ?? null,
      clinicPhone: (clinic?.phones as string[] | null)?.[0] ?? null,
      clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
      offerId: demoOfferId,
    });

    if (parsed.data.channel === 'WHATSAPP') {
      const conn = await resolveActiveConnection(tenantId);
      if (!conn) {
        return NextResponse.json(
          { ok: false, error: 'no_whatsapp_connection' },
          { status: 400 },
        );
      }
      const driverScope = driverScopeForWhatsAppMode(conn.mode);
      const templates = await db
        .select()
        .from(waitlistMessageTemplates)
        .where(
          and(
            eq(waitlistMessageTemplates.tenantId, tenantId),
            eq(waitlistMessageTemplates.channel, 'WHATSAPP'),
          ),
        );
      const template = resolveWaitlistTemplate(
        templates as WaitlistTemplateRow[],
        'WHATSAPP',
        driverScope,
      );
      if (!template) {
        return NextResponse.json(
          {
            ok: false,
            error: 'no_template',
            hint: 'Guardá una plantilla WhatsApp antes de probar el envío.',
          },
          { status: 400 },
        );
      }

      const res = await sendWaitlistWhatsAppDirect({
        tenantId,
        conn,
        template,
        vars,
        toPhoneE164: parsed.data.toPhoneE164,
        contactDisplayName: deriveContactDisplayNameFromWaitlistVars(vars),
        offerId: demoOfferId,
      });
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: res.reason }, { status: 502 });
      }
      return NextResponse.json({
        ok: true,
        channel: 'WHATSAPP',
        kind: res.kind,
        externalMessageId: res.externalMessageId,
        conversationId: res.conversationId,
      });
    }

    // VOICE
    const templates = await db
      .select()
      .from(waitlistMessageTemplates)
      .where(
        and(
          eq(waitlistMessageTemplates.tenantId, tenantId),
          eq(waitlistMessageTemplates.channel, 'VOICE'),
        ),
      );
    const template = resolveWaitlistTemplate(
      templates as WaitlistTemplateRow[],
      'VOICE',
      'voice_retell',
    );
    if (!template) {
      return NextResponse.json(
        {
          ok: false,
          error: 'no_template',
          hint: 'Guardá una plantilla de Voz antes de probar la llamada.',
        },
        { status: 400 },
      );
    }

    const res = await sendWaitlistVoice({
      tenantId,
      offerId: demoOfferId,
      toPhoneE164: parsed.data.toPhoneE164,
      vars,
      contactDisplayName: deriveContactDisplayNameFromWaitlistVars(vars),
      ghlContactId: null,
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.reason }, { status: 502 });
    }
    return NextResponse.json({ ok: true, channel: 'VOICE', callId: res.callId });
  } catch (err) {
    if (err instanceof WaitlistForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/waitlist/test-send]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
