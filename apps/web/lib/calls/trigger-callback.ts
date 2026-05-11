import 'server-only';
import { db } from '@/lib/db/client';
import { calls, phoneNumbers, tenants } from '@/lib/db/schema';
import { resolveRetellAgentId } from '@/lib/data/agent-config';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { createContact, lookupContactByPhone } from '@/lib/ghl/contacts-mutations';
import { getRetellClient } from '@/lib/retell/client';
import { and, desc, eq, gte } from 'drizzle-orm';

export type TriggerCallbackInput = {
  tenantId: string;
  toNumber: string;
  patientName?: string | null;
  email?: string | null;
  ghlContactId?: string | null;
  source?: string; // 'manual' | 'ghl_webhook' | 'lead_intake' | 'form_x'
  /**
   * Si el contacto no existe en GHL, lo crea con los datos pasados.
   * Default true.
   */
  createContactIfMissing?: boolean;
};

export type TriggerCallbackResult =
  | { ok: true; callId: string; status: string; contactId: string | null }
  | { ok: false; error: string; reason: 'rate_limit' | 'no_agent' | 'no_phone' | 'retell_error' | 'invalid_input' };

const RATE_LIMIT_WINDOW_MS = 30 * 60_000; // 30 min entre callbacks al mismo número

/**
 * Trigger atómico de un callback saliente:
 *   1. Valida que haya agente Retell + número de origen configurados.
 *   2. Aplica rate-limit por número (30 min entre llamadas al mismo phone).
 *   3. Asegura que exista un contacto en GHL (crea si falta).
 *   4. Llama a Retell para iniciar la llamada saliente con metadata + dynamic vars.
 *
 * Usado desde:
 *   - Botón "Llamar ahora" del dashboard
 *   - Endpoint /api/leads/intake (formularios externos)
 *   - Webhook GHL contact.create
 */
export async function triggerCallback(
  input: TriggerCallbackInput,
): Promise<TriggerCallbackResult> {
  const phone = normalizePhone(input.toNumber);
  if (!phone) {
    return { ok: false, error: 'Número de teléfono inválido', reason: 'invalid_input' };
  }

  // 1. Rate limit: no llamar al mismo phone si ya hubo una en los últimos 30 min
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await db
    .select({ id: calls.id, startedAt: calls.startedAt })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, input.tenantId),
        eq(calls.toNumber, phone),
        gte(calls.startedAt, since),
      ),
    )
    .orderBy(desc(calls.startedAt))
    .limit(1);

  if (recent[0]) {
    return {
      ok: false,
      error: `Ya se llamó a ${phone} en los últimos 30 minutos. Esperá un poco.`,
      reason: 'rate_limit',
    };
  }

  // 2. Resolver agente + número de origen
  const agentId = await resolveRetellAgentId(input.tenantId);
  if (!agentId) {
    return { ok: false, error: 'No hay agente Retell configurado para este tenant.', reason: 'no_agent' };
  }

  const [phoneRow] = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, input.tenantId), eq(phoneNumbers.active, true)))
    .limit(1);

  if (!phoneRow) {
    return { ok: false, error: 'No hay número de teléfono configurado para este tenant.', reason: 'no_phone' };
  }

  // 3. Asegurar contacto en GHL si tenemos integración
  let ghlContactId = input.ghlContactId ?? null;
  const ghl = await getGhlIntegration(input.tenantId);
  if (ghl && !ghlContactId && input.createContactIfMissing !== false) {
    const existing = await lookupContactByPhone(input.tenantId, phone);
    if (existing) {
      ghlContactId = existing.id;
    } else if (input.patientName || input.email) {
      const parts = (input.patientName ?? '').trim().split(/\s+/);
      const first = parts[0] ?? '';
      const last = parts.slice(1).join(' ');
      const created = await createContact(input.tenantId, {
        firstName: first || 'Contacto',
        lastName: last,
        phone,
        email: input.email ?? undefined,
      });
      ghlContactId = created?.id ?? null;
    }
  }

  // 4. Resolver nombre de la clínica para dynamic vars
  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  const clinicName = tenantRow?.name ?? 'la clínica';

  // 5. Llamar a Retell
  console.log('[triggerCallback] createPhoneCall', {
    from: phoneRow.e164,
    to: phone,
    agentId,
    tenantId: input.tenantId,
    name: input.patientName,
  });

  let createdCall: { call_id: string; call_status?: string } | null = null;
  try {
    const retell = getRetellClient();
    createdCall = await retell.call.createPhoneCall({
      from_number: phoneRow.e164,
      to_number: phone,
      override_agent_id: agentId,
      metadata: {
        tenant_id: input.tenantId,
        ghl_contact_id: ghlContactId,
        patient_name: input.patientName ?? null,
        source: input.source ?? 'manual',
        direction: 'outbound',
      },
      retell_llm_dynamic_variables: {
        patient_name: input.patientName ?? 'paciente',
        clinic_name: clinicName,
        current_date: new Date().toISOString().slice(0, 10),
        direction: 'outbound',
        lead_source: input.source ?? 'manual',
      },
    });
    console.log('[triggerCallback] Retell ACK:', {
      callId: createdCall.call_id,
      status: createdCall.call_status,
    });
  } catch (err) {
    console.error('[triggerCallback] Retell createPhoneCall fallo:', err);
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, error: `Retell rechazó la llamada: ${msg}`, reason: 'retell_error' };
  }

  // 6. Follow-up: esperá 3 segundos y verificá que la llamada esté progresando.
  // Si está en "error" o "not_connected", Twilio/Retell rechazó el dial-out.
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const retell = getRetellClient();
    const status = await retell.call.retrieve(createdCall.call_id);
    const callStatus = (status as { call_status?: string }).call_status;
    const disconnectionReason = (status as { disconnection_reason?: string }).disconnection_reason;
    console.log('[triggerCallback] follow-up:', { callStatus, disconnectionReason });

    if (callStatus === 'error') {
      return {
        ok: false,
        error: `Retell marcó la llamada como error: ${disconnectionReason ?? 'razón desconocida'}. Revisá los logs de Retell y Twilio.`,
        reason: 'retell_error',
      };
    }
    if (callStatus === 'not_connected') {
      // Diagnóstico fino según la disconnection_reason que devuelve Retell
      let hint = '';
      switch (disconnectionReason) {
        case 'telephony_provider_permission_denied':
          hint = `Twilio bloqueó la llamada por geo-permisos. Activá el país de destino en Twilio Console → Voice → Settings → Geo Permissions. País detectado: ${phone.startsWith('+54') ? 'Argentina' : phone.startsWith('+34') ? 'España' : phone.startsWith('+52') ? 'México' : 'desconocido'}.`;
          break;
        case 'dial_busy':
          hint = 'El número está ocupado. Probá de nuevo en unos minutos.';
          break;
        case 'dial_failed':
          hint = 'Twilio no pudo discar. Verificá que el número de destino sea válido y que tu cuenta Twilio tenga saldo.';
          break;
        case 'dial_no_answer':
          hint = 'El paciente no atendió.';
          break;
        case 'invalid_destination':
          hint = `El número de destino (${phone}) no es válido. Revisá el formato E.164.`;
          break;
        case 'voicemail':
          hint = 'Saltó al buzón de voz.';
          break;
        default:
          hint = `Razón Retell/Twilio: ${disconnectionReason ?? 'desconocida'}.`;
      }
      return {
        ok: false,
        error: hint,
        reason: 'retell_error',
      };
    }
    // 'registered', 'ongoing', 'ended' → en algún punto del happy path
    return {
      ok: true,
      callId: createdCall.call_id,
      status: callStatus ?? 'registered',
      contactId: ghlContactId,
    };
  } catch (err) {
    console.error('[triggerCallback] follow-up retrieve fallo:', err);
    // Si no podemos verificar, asumimos que está OK (no bloqueamos al usuario)
    return {
      ok: true,
      callId: createdCall.call_id,
      status: createdCall.call_status ?? 'registered',
      contactId: ghlContactId,
    };
  }
}

/**
 * Normaliza un teléfono al formato E.164 (+ + dígitos).
 * Acepta strings con espacios, paréntesis, guiones. Si no empieza con +,
 * intenta agregar uno (asumiendo que ya está en formato internacional).
 */
function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s()-]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) {
    return /^\+\d{7,15}$/.test(cleaned) ? cleaned : null;
  }
  // Solo dígitos → asumimos que falta el "+"
  if (/^\d{7,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}
