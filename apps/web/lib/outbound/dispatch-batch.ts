import 'server-only';
import { resolveRetellAgentId } from '@/lib/data/agent-config';
import { type OutboundCampaign, setCampaignStatus } from '@/lib/data/outbound-campaigns';
import { db } from '@/lib/db/client';
import { outboundTargets, phoneNumbers, tenants } from '@/lib/db/schema';
import { getRetellClient } from '@/lib/retell/client';
import { and, eq } from 'drizzle-orm';

export type DispatchResult =
  | { ok: true; batchCallId: string; taskCount: number }
  | { ok: false; reason: 'no_agent' | 'no_phone' | 'no_targets' | 'retell_error'; error: string };

/**
 * Dispara una campaña: arma las tasks desde outbound_targets pendientes y manda
 * un único createBatchCall a Retell. Retell encola sin pegarle al límite de
 * concurrencia.
 *
 * Idempotencia básica: si la campaña ya tiene retell_batch_call_id, no la
 * volvemos a disparar (devuelve ok=false con reason retell_error).
 */
export async function dispatchCampaign(
  tenantId: string,
  campaign: OutboundCampaign,
): Promise<DispatchResult> {
  if (campaign.retellBatchCallId) {
    return {
      ok: false,
      reason: 'retell_error',
      error: 'Esta campaña ya fue disparada a Retell.',
    };
  }

  const agentId = await resolveRetellAgentId(tenantId, 'outbound');
  if (!agentId) {
    return {
      ok: false,
      reason: 'no_agent',
      error:
        'No hay agente outbound configurado. Corré scripts/setup-outbound-agent.ts o seteá RETELL_OUTBOUND_DEFAULT_AGENT_ID.',
    };
  }

  // Resolver número origen
  let fromNumber: string | null = null;
  if (campaign.fromPhoneId) {
    const [row] = await db
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.id, campaign.fromPhoneId), eq(phoneNumbers.tenantId, tenantId)))
      .limit(1);
    fromNumber = row?.e164 ?? null;
  }
  if (!fromNumber) {
    const [row] = await db
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.active, true)))
      .limit(1);
    fromNumber = row?.e164 ?? null;
  }
  if (!fromNumber) {
    return {
      ok: false,
      reason: 'no_phone',
      error: 'No hay número Twilio activo para este tenant.',
    };
  }

  // Targets pendientes
  const targets = await db
    .select()
    .from(outboundTargets)
    .where(
      and(
        eq(outboundTargets.tenantId, tenantId),
        eq(outboundTargets.campaignId, campaign.id),
        eq(outboundTargets.status, 'pending'),
      ),
    );

  if (targets.length === 0) {
    return {
      ok: false,
      reason: 'no_targets',
      error: 'La campaña no tiene destinatarios pendientes.',
    };
  }

  // Nombre de la clínica para inyectar como dynamic var por defecto
  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const clinicName = tenantRow?.name ?? 'la clínica';
  const today = new Date().toISOString().slice(0, 10);

  const shared = (campaign.sharedDynamicVars ?? {}) as Record<string, string>;

  const tasks = targets.map((t) => {
    const targetVars = (t.dynamicVars ?? {}) as Record<string, string>;
    return {
      to_number: t.toNumber,
      retell_llm_dynamic_variables: {
        clinic_name: clinicName,
        current_date: today,
        direction: 'outbound',
        use_case: campaign.useCase,
        patient_name: t.patientName ?? targetVars.patient_name ?? 'paciente',
        campaign_name: campaign.name,
        ...shared,
        ...targetVars,
      },
      metadata: {
        tenant_id: tenantId,
        campaign_id: campaign.id,
        target_id: t.id,
        ghl_contact_id: t.ghlContactId ?? null,
        patient_name: t.patientName ?? null,
        source: 'campaign',
        direction: 'outbound',
        use_case: campaign.useCase,
      },
    } as const;
  });

  const callTimeWindow =
    campaign.callWindowStart != null && campaign.callWindowEnd != null
      ? {
          start_hour: campaign.callWindowStart,
          end_hour: campaign.callWindowEnd,
          time_zone: campaign.timezone ?? 'America/Mexico_City',
        }
      : undefined;

  console.log('[dispatchCampaign] createBatchCall', {
    tenantId,
    campaignId: campaign.id,
    from: fromNumber,
    taskCount: tasks.length,
    agentId,
  });

  let batchCallId: string;
  try {
    const retell = getRetellClient();
    // Cast a any porque los tipos del SDK no siempre exponen override_agent_id
    // a nivel batch — Retell igual lo respeta. El uso de override_agent_id en
    // batch está documentado en https://docs.retellai.com/api-references/create-batch-call
    // biome-ignore lint/suspicious/noExplicitAny: SDK params
    const payload: any = {
      from_number: fromNumber,
      name: campaign.name,
      tasks,
      override_agent_id: agentId,
    };
    if (campaign.scheduledAt) {
      payload.scheduled_timestamp = campaign.scheduledAt.getTime();
    }
    if (callTimeWindow) {
      payload.call_time_window = callTimeWindow;
    }
    // biome-ignore lint/suspicious/noExplicitAny: SDK signature
    const response: any = await (retell as any).batchCall.createBatchCall(payload);
    batchCallId = response.batch_call_id ?? response.batchCallId ?? '';
    if (!batchCallId) throw new Error('Retell no devolvió batch_call_id');
  } catch (err) {
    console.error('[dispatchCampaign] Retell error:', err);
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    await setCampaignStatus(tenantId, campaign.id, { status: 'failed' });
    return { ok: false, reason: 'retell_error', error: msg };
  }

  // Marcar campaña y targets como queued / dispatching
  await setCampaignStatus(tenantId, campaign.id, {
    status: 'running',
    retellBatchCallId: batchCallId,
    overrideAgentId: agentId,
    dispatchedAt: new Date(),
  });

  await db
    .update(outboundTargets)
    .set({ status: 'queued' })
    .where(
      and(
        eq(outboundTargets.tenantId, tenantId),
        eq(outboundTargets.campaignId, campaign.id),
        eq(outboundTargets.status, 'pending'),
      ),
    );

  return { ok: true, batchCallId, taskCount: tasks.length };
}
