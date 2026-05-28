import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  clinicSettings,
  tenants,
  treatments,
  waitlistMessageTemplates,
  whatsappConnections,
} from '@/lib/db/schema';
import { driverScopeForWhatsAppMode } from '@/lib/reminders/template-resolver';
import { resolveActiveConnection } from '@/lib/reminders/send-whatsapp';
import {
  defaultWaitlistButtons,
  resolveWaitlistTemplate,
} from '@/lib/waitlist/template-resolver';
import { buildWaitlistVars, interpolateWaitlist } from '@/lib/waitlist/variables';
import { WaitlistForbiddenError, requireWaitlistRole } from '@/lib/waitlist/auth';
import type { WaitlistTemplateRow } from '@/lib/waitlist/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  channel: z.enum(['WHATSAPP', 'VOICE']).default('WHATSAPP'),
  treatmentId: z.string().uuid().nullable().optional(),
});

// POST /api/waitlist/preview — renderiza el template activo con vars demo.
// Útil para probar el copy desde la pantalla de settings sin enviar nada.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { tenantId } = await requireWaitlistRole('viewer');
    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    // Resolver driver scope.
    let driverScope: string;
    if (parsed.data.channel === 'VOICE') {
      driverScope = 'voice_retell';
    } else {
      const conn = await resolveActiveConnection(tenantId);
      if (!conn) {
        return NextResponse.json(
          { error: 'No hay conexión WhatsApp activa para el tenant' },
          { status: 400 },
        );
      }
      driverScope = driverScopeForWhatsAppMode(conn.mode);
    }

    const templates = await db
      .select()
      .from(waitlistMessageTemplates)
      .where(
        and(
          eq(waitlistMessageTemplates.tenantId, tenantId),
          eq(waitlistMessageTemplates.channel, parsed.data.channel),
        ),
      );

    const template = resolveWaitlistTemplate(
      templates as WaitlistTemplateRow[],
      parsed.data.channel,
      driverScope as never,
    );
    if (!template) {
      return NextResponse.json(
        { ok: false, error: 'no_template', driverScope },
        { status: 404 },
      );
    }

    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const [clinic] = await db
      .select({ timezone: clinicSettings.timezone, address: clinicSettings.address, phones: clinicSettings.phones })
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

    const demoOfferId = '00000000-0000-0000-0000-000000000000';
    const vars = buildWaitlistVars({
      oldAppointmentStartTime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      newSlotStartTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      newSlotDurationMinutes: durationMinutes,
      treatmentName: treatmentName ?? 'limpieza',
      contactFirstName: 'María',
      contactLastName: 'Pérez',
      contactPhoneE164: '+34600000000',
      clinicName: tenant?.name ?? 'la clínica',
      clinicAddress: clinic?.address ?? null,
      clinicPhone: (clinic?.phones as string[] | null)?.[0] ?? null,
      clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
      offerId: demoOfferId,
    });

    const renderedText = template.freeText ? interpolateWaitlist(template.freeText, vars) : null;
    const buttons =
      template.buttons.length > 0 ? template.buttons : defaultWaitlistButtons(demoOfferId);

    return NextResponse.json({
      ok: true,
      channel: parsed.data.channel,
      driverScope,
      templateName: template.templateName ?? null,
      voicePromptOverride: template.voicePromptOverride ?? null,
      renderedText,
      buttons,
      vars,
    });
  } catch (err) {
    if (err instanceof WaitlistForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[api/waitlist/preview]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
