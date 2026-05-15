import 'server-only';
import { db } from '@/lib/db/client';
import { outboundCampaigns, outboundTargets, phoneNumbers } from '@/lib/db/schema';
import { and, count, desc, eq, sql } from 'drizzle-orm';

export type OutboundCampaign = typeof outboundCampaigns.$inferSelect;
export type OutboundTarget = typeof outboundTargets.$inferSelect;

export const USE_CASES = ['payment', 'info', 'reminder', 'reactivation', 'custom'] as const;
export type UseCase = (typeof USE_CASES)[number];

export const USE_CASE_LABEL: Record<UseCase, string> = {
  payment: 'Cobranza',
  info: 'Información',
  reminder: 'Recordatorio de cita',
  reactivation: 'Reactivación',
  custom: 'Personalizada',
};

export async function listCampaigns(tenantId: string): Promise<
  Array<
    OutboundCampaign & {
      totalTargets: number;
      completedTargets: number;
    }
  >
> {
  const campaigns = await db
    .select()
    .from(outboundCampaigns)
    .where(eq(outboundCampaigns.tenantId, tenantId))
    .orderBy(desc(outboundCampaigns.createdAt));

  if (campaigns.length === 0) return [];

  const stats = await db
    .select({
      campaignId: outboundTargets.campaignId,
      total: count(),
      completed: sql<number>`count(*) filter (where ${outboundTargets.status} in ('ended','voicemail'))`,
    })
    .from(outboundTargets)
    .where(eq(outboundTargets.tenantId, tenantId))
    .groupBy(outboundTargets.campaignId);

  const statsByCampaign = new Map(stats.map((s) => [s.campaignId, s]));
  return campaigns.map((c) => {
    const s = statsByCampaign.get(c.id);
    return {
      ...c,
      totalTargets: Number(s?.total ?? 0),
      completedTargets: Number(s?.completed ?? 0),
    };
  });
}

export async function getCampaign(
  tenantId: string,
  campaignId: string,
): Promise<OutboundCampaign | null> {
  const [row] = await db
    .select()
    .from(outboundCampaigns)
    .where(and(eq(outboundCampaigns.id, campaignId), eq(outboundCampaigns.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

export async function getCampaignTargets(
  tenantId: string,
  campaignId: string,
): Promise<OutboundTarget[]> {
  return db
    .select()
    .from(outboundTargets)
    .where(and(eq(outboundTargets.tenantId, tenantId), eq(outboundTargets.campaignId, campaignId)))
    .orderBy(desc(outboundTargets.createdAt));
}

export type CreateCampaignInput = {
  tenantId: string;
  createdBy: string | null;
  name: string;
  useCase: UseCase;
  fromPhoneId?: string | null;
  scheduledAt?: Date | null;
  callWindowStart?: number | null;
  callWindowEnd?: number | null;
  timezone?: string | null;
  maxRetries?: number;
  retryDelayMinutes?: number;
  sharedDynamicVars?: Record<string, string>;
  notes?: string | null;
  targets: Array<{
    toNumber: string;
    patientName?: string | null;
    email?: string | null;
    ghlContactId?: string | null;
    dynamicVars?: Record<string, string>;
  }>;
};

export async function createCampaignWithTargets(
  input: CreateCampaignInput,
): Promise<{ campaignId: string; targetCount: number }> {
  // Resolver número origen: si no viene, agarro el primer phoneNumber activo del tenant.
  let fromPhoneId = input.fromPhoneId ?? null;
  if (!fromPhoneId) {
    const [phone] = await db
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, input.tenantId), eq(phoneNumbers.active, true)))
      .limit(1);
    fromPhoneId = phone?.id ?? null;
  }

  const [campaign] = await db
    .insert(outboundCampaigns)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      useCase: input.useCase,
      status: 'draft',
      fromPhoneId,
      scheduledAt: input.scheduledAt ?? null,
      callWindowStart: input.callWindowStart ?? null,
      callWindowEnd: input.callWindowEnd ?? null,
      timezone: input.timezone ?? null,
      maxRetries: input.maxRetries ?? 0,
      retryDelayMinutes: input.retryDelayMinutes ?? 60,
      sharedDynamicVars: input.sharedDynamicVars ?? {},
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: outboundCampaigns.id });

  if (!campaign) throw new Error('No se pudo crear la campaña');
  const campaignId = campaign.id;

  if (input.targets.length > 0) {
    const rows = input.targets.map((t) => ({
      campaignId,
      tenantId: input.tenantId,
      toNumber: t.toNumber,
      patientName: t.patientName ?? null,
      email: t.email ?? null,
      ghlContactId: t.ghlContactId ?? null,
      dynamicVars: t.dynamicVars ?? {},
      status: 'pending' as const,
    }));
    // Batch insert en chunks de 500 (evita queries gigantes)
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(outboundTargets).values(rows.slice(i, i + CHUNK));
    }
  }

  return { campaignId, targetCount: input.targets.length };
}

export async function setCampaignStatus(
  tenantId: string,
  campaignId: string,
  patch: Partial<{
    status: string;
    retellBatchCallId: string | null;
    overrideAgentId: string | null;
    dispatchedAt: Date | null;
    completedAt: Date | null;
  }>,
): Promise<void> {
  await db
    .update(outboundCampaigns)
    .set(patch)
    .where(and(eq(outboundCampaigns.id, campaignId), eq(outboundCampaigns.tenantId, tenantId)));
}

export async function updateTargetByRetellCallId(
  retellCallId: string,
  patch: Partial<{
    status: string;
    lastDisconnectionReason: string | null;
    lastError: string | null;
    lastAttemptAt: Date;
  }>,
): Promise<void> {
  await db.update(outboundTargets).set(patch).where(eq(outboundTargets.retellCallId, retellCallId));
}
