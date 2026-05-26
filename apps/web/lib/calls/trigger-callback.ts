import 'server-only';
import { resolveRetellAgentId } from '@/lib/data/agent-config';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import {
  getTenantTelephony,
  getZadarmaClientFor,
} from '@/lib/data/tenant-telephony';
import { db } from '@/lib/db/client';
import { phoneNumbers } from '@/lib/db/schema';
import { createContact, lookupContactByPhone } from '@/lib/ghl/contacts-mutations';
import { getRetellClient } from '@/lib/retell/client';
import { buildClinicContextVars } from '@/lib/retell/clinic-context';
import { ZadarmaApiError } from '@/lib/zadarma/client';
import { and, eq } from 'drizzle-orm';

export type TriggerCallbackInput = {
  tenantId: string;
  toNumber: string;
  patientName?: string | null;
  email?: string | null;
  ghlContactId?: string | null;
  source?: string; // 'manual' | 'ghl_webhook' | 'lead_intake' | 'form_x'
  /** payment | info | reminder | reactivation | custom */
  useCase?: string | null;
  /** Variables dinámicas extra (monto_pendiente, fecha_cita, tratamiento, etc.) */
  dynamicVars?: Record<string, string>;
  /**
   * Si el contacto no existe en GHL, lo crea con los datos pasados.
   * Default true.
   */
  createContactIfMissing?: boolean;
  /**
   * Si se pasa, ignora `resolveRetellAgentId(tenant, 'outbound')` y usa este
   * agent_id como override. Útil para flows especiales (ej. demo público de
   * la landing) que no deben afectar al agente configurado en el dashboard.
   */
  agentIdOverride?: string | null;
};

export type TriggerCallbackResult =
  | { ok: true; callId: string; status: string; contactId: string | null }
  | {
      ok: false;
      error: string;
      reason: 'no_agent' | 'no_phone' | 'retell_error' | 'invalid_input';
    };

/**
 * Trigger atómico de un callback saliente:
 *   1. Valida que haya agente Retell + número de origen configurados.
 *   2. Asegura que exista un contacto en GHL (crea si falta).
 *   3. Llama a Retell para iniciar la llamada saliente con metadata + dynamic vars.
 *
 * Sin rate-limit: el usuario quiere poder probar y reintentar inmediatamente.
 * (Si en producción spam se vuelve un problema, agregar throttle por phone.)
 *
 * Usado desde:
 *   - Botón "Llamar ahora" del dashboard
 *   - Endpoint /api/leads/intake (formularios externos)
 *   - Webhook GHL contact.create
 */
export async function triggerCallback(input: TriggerCallbackInput): Promise<TriggerCallbackResult> {
  const phone = normalizePhone(input.toNumber);
  if (!phone) {
    return { ok: false, error: 'Número de teléfono inválido', reason: 'invalid_input' };
  }

  // Resolver agente outbound + número de origen. El callback reactivo siempre
  // usa el agente "outbound" (parametrizado por use_case en dynamic_vars).
  // Excepción: si vino agentIdOverride (ej. flow de demo público), lo usamos
  // y saltamos la resolución por tenant — el dashboard sigue mostrando el
  // agente configurado en agent_configs.
  const agentId = input.agentIdOverride ?? (await resolveRetellAgentId(input.tenantId, 'outbound'));
  if (!agentId) {
    return {
      ok: false,
      error:
        'No hay agente outbound de Retell configurado. Corré `pnpm tsx scripts/setup-outbound-agent.ts` o seteá RETELL_OUTBOUND_DEFAULT_AGENT_ID.',
      reason: 'no_agent',
    };
  }

  // Resolver el provider activo del tenant. Si el tenant está en modo
  // Zadarma, el dispatch outbound no pasa por Retell (Retell sólo soporta
  // Twilio BYOT nativo). Usamos /v1/request/callback/ de Zadarma. Para una
  // llamada con agente AI sobre Zadarma, el operador debe configurar un SIP
  // trunk hacia Retell en el cabinet — esta función lo soporta vía el
  // parámetro `sip` opcional.
  const telephony = await getTenantTelephony(input.tenantId);
  const provider = telephony?.provider ?? 'twilio';

  if (provider === 'zadarma') {
    return triggerCallbackZadarma(input, phone, telephony);
  }

  const [phoneRow] = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, input.tenantId), eq(phoneNumbers.active, true)))
    .limit(1);

  if (!phoneRow) {
    return {
      ok: false,
      error: 'No hay número de teléfono configurado para este tenant.',
      reason: 'no_phone',
    };
  }

  // Caller ID override: si el tenant verificó su número público en Twilio,
  // lo usamos como "From" para que al destinatario le aparezca llamando la
  // clínica en lugar del número Twilio. Sólo aplica si:
  //   - hay un Verified Caller ID confirmado (callerIdVerifiedAt != null), Y
  //   - el Twilio account asociado al Retell phone es el del tenant (BYOT).
  // Si no se cumple lo segundo, Twilio rechaza la llamada con error 21210
  // ("Caller ID Not Verified"). Por defecto pasamos el caller ID — si la
  // cuenta no es BYOT, el fallo es ruidoso y orientativo.
  const fromForRetell = phoneRow.e164;
  const callerIdOverride =
    telephony?.callerIdE164 && telephony.callerIdVerifiedAt ? telephony.callerIdE164 : null;

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

  // 4. Resolver contexto de clínica (nombre, dirección, horarios, etc.)
  const clinicVars = await buildClinicContextVars(input.tenantId);

  // 5. Llamar a Retell
  console.log('[triggerCallback] createPhoneCall', {
    from: fromForRetell,
    callerIdOverride,
    to: phone,
    agentId,
    tenantId: input.tenantId,
    name: input.patientName,
  });

  let createdCall: { call_id: string; call_status?: string } | null = null;
  try {
    const retell = getRetellClient();
    // Cast a any para poder pasar override_from_number (caller ID custom).
    // El SDK Retell lo acepta cuando el phone está registrado como BYOT
    // (cuenta Twilio del tenant). Cuando no hay override, no pasamos la prop.
    // biome-ignore lint/suspicious/noExplicitAny: SDK params (override_from_number BYOT)
    const callArgs: any = {
      from_number: fromForRetell,
      to_number: phone,
      override_agent_id: agentId,
      metadata: {
        tenant_id: input.tenantId,
        ghl_contact_id: ghlContactId,
        patient_name: input.patientName ?? null,
        source: input.source ?? 'manual',
        direction: 'outbound',
        use_case: input.useCase ?? 'custom',
        caller_id_override: callerIdOverride,
      },
      retell_llm_dynamic_variables: {
        ...clinicVars,
        patient_name: input.patientName ?? 'paciente',
        current_date: new Date().toISOString().slice(0, 10),
        direction: 'outbound',
        lead_source: input.source ?? 'manual',
        use_case: input.useCase ?? 'custom',
        ...(input.dynamicVars ?? {}),
      },
    };
    if (callerIdOverride) {
      callArgs.override_from_number = callerIdOverride;
    }
    createdCall = await retell.call.createPhoneCall(callArgs);
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
          hint =
            'Twilio no pudo discar. Verificá que el número de destino sea válido y que tu cuenta Twilio tenga saldo.';
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
 * Dispatch outbound vía Zadarma. Sin Retell BYOT — usamos el endpoint
 * `/v1/request/callback/` que dispara una llamada bidireccional:
 *   leg A → `from` (clínica o SIP interno con Retell trunk)
 *   leg B → `to` (paciente)
 *
 * Para que el agente AI atienda en lugar de un humano, `from` debe ser un
 * SIP interno del cabinet Zadarma con un "External SIP" configurado hacia
 * Retell. Si el tenant no tiene SIP del agente cargado, usamos el número
 * verificado de la clínica (modo human-to-human).
 *
 * Nota: la lifecycle de la llamada en Zadarma llega después por webhook
 * NOTIFY_OUT_*; no esperamos sincrónicamente. Devolvemos `pbx_call_id`
 * como callId para que aparezca en logs/calls table cuando se reconcile.
 */
async function triggerCallbackZadarma(
  input: TriggerCallbackInput,
  phone: string,
  telephony: {
    callerIdE164: string | null;
    callerIdVerifiedAt: Date | null;
    inboundNumberE164: string | null;
  } | null,
): Promise<TriggerCallbackResult> {
  const from =
    (telephony?.callerIdE164 && telephony.callerIdVerifiedAt ? telephony.callerIdE164 : null) ??
    telephony?.inboundNumberE164 ??
    null;

  if (!from) {
    return {
      ok: false,
      error:
        'Zadarma requiere un Caller ID verificado o un número entrante configurado para dispatch outbound.',
      reason: 'no_phone',
    };
  }

  // Asegurar contacto en GHL si tenemos integración (mismo flujo que Twilio).
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

  // Si quisieras puentear al agente AI: ZADARMA_SIP_INTERNAL_FOR_AGENT
  // apunta a una extensión SIP del cabinet con External SIP hacia Retell.
  // Cuando está seteada, la usamos como leg A; sino, leg A = `from`.
  const sipForAgent = process.env.ZADARMA_SIP_INTERNAL_FOR_AGENT;

  try {
    const { client } = await getZadarmaClientFor(input.tenantId);
    const result = await client.createCallback({
      from: from.replace(/^\+/, ''),
      to: phone.replace(/^\+/, ''),
      ...(sipForAgent ? { sip: sipForAgent } : {}),
    });
    console.log('[triggerCallback/zadarma] callback creado', {
      pbx_call_id: result.pbx_call_id,
      from,
      to: phone,
    });
    return {
      ok: true,
      callId: result.pbx_call_id ?? `zadarma-${Date.now()}`,
      status: 'registered',
      contactId: ghlContactId,
    };
  } catch (err) {
    console.error('[triggerCallback/zadarma] callback fallo:', err);
    if (err instanceof ZadarmaApiError) {
      return {
        ok: false,
        error: `Zadarma rechazó la llamada: ${err.message}`,
        reason: 'retell_error',
      };
    }
    return {
      ok: false,
      error: `Zadarma error: ${(err as Error).message}`,
      reason: 'retell_error',
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
