import 'server-only';
import { db } from '@/lib/db/client';
import { agentConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export type AgentConfig = typeof agentConfigs.$inferSelect;

export async function getAgentConfig(tenantId: string): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertAgentConfig(input: {
  tenantId: string;
  retellAgentId?: string | null;
  retellLlmId?: string | null;
  currentPromptText?: string;
  voiceId?: string;
  tone?: string | null;
  transferNumber?: string | null;
  welcomeMessage?: string | null;
  published?: boolean;
}): Promise<AgentConfig> {
  const existing = await getAgentConfig(input.tenantId);
  const values = {
    tenantId: input.tenantId,
    retellAgentId: input.retellAgentId ?? existing?.retellAgentId ?? null,
    retellLlmId: input.retellLlmId ?? existing?.retellLlmId ?? null,
    currentPromptText: input.currentPromptText ?? existing?.currentPromptText ?? '',
    voiceId: input.voiceId ?? existing?.voiceId ?? '',
    tone: input.tone ?? existing?.tone ?? 'cercano',
    transferNumber: input.transferNumber ?? existing?.transferNumber ?? null,
    welcomeMessage: input.welcomeMessage ?? existing?.welcomeMessage ?? null,
    published: input.published ?? existing?.published ?? false,
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db
      .update(agentConfigs)
      .set(values)
      .where(eq(agentConfigs.tenantId, input.tenantId))
      .returning();
    return row!;
  }

  const [row] = await db
    .insert(agentConfigs)
    .values({
      ...values,
      currentPromptText: values.currentPromptText || 'Eres un asistente de clínica dental.',
      voiceId: values.voiceId || 'default',
    })
    .returning();
  return row!;
}

/**
 * Resuelve el retellAgentId del tenant. Cae al env RETELL_DEFAULT_AGENT_ID
 * en dev hasta que el usuario configure el suyo.
 */
export async function resolveRetellAgentId(tenantId: string): Promise<string | null> {
  const config = await getAgentConfig(tenantId);
  if (config?.retellAgentId) return config.retellAgentId;
  return process.env.RETELL_DEFAULT_AGENT_ID ?? null;
}
