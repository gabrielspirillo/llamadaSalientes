import 'server-only';
import { db } from '@/lib/db/client';
import { agentConfigs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export type AgentConfig = typeof agentConfigs.$inferSelect;
export type AgentRole = 'inbound' | 'outbound';

const DEFAULT_ROLE: AgentRole = 'inbound';

export async function getAgentConfig(
  tenantId: string,
  role: AgentRole = DEFAULT_ROLE,
): Promise<AgentConfig | null> {
  const rows = await db
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.role, role)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertAgentConfig(input: {
  tenantId: string;
  role?: AgentRole;
  retellAgentId?: string | null;
  retellLlmId?: string | null;
  currentPromptText?: string;
  voiceId?: string;
  tone?: string | null;
  transferNumber?: string | null;
  welcomeMessage?: string | null;
  published?: boolean;
}): Promise<AgentConfig> {
  const role: AgentRole = input.role ?? DEFAULT_ROLE;
  const existing = await getAgentConfig(input.tenantId, role);
  const values = {
    tenantId: input.tenantId,
    role,
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
      .where(and(eq(agentConfigs.tenantId, input.tenantId), eq(agentConfigs.role, role)))
      .returning();
    if (!row) throw new Error('No se pudo actualizar agent_config');
    return row;
  }

  const [row] = await db
    .insert(agentConfigs)
    .values({
      ...values,
      currentPromptText:
        values.currentPromptText ||
        (role === 'outbound'
          ? 'Eres un asistente de clínica dental que realiza llamadas salientes.'
          : 'Eres un asistente de clínica dental.'),
      voiceId: values.voiceId || 'default',
    })
    .returning();
  if (!row) throw new Error('No se pudo crear agent_config');
  return row;
}

/**
 * Resuelve el retellAgentId para un tenant y un rol.
 *
 * Fallback chain:
 *   1. agent_configs.retell_agent_id (rol pedido)
 *   2. env var específica del rol (RETELL_OUTBOUND_DEFAULT_AGENT_ID | RETELL_DEFAULT_AGENT_ID)
 *   3. env var legacy RETELL_DEFAULT_AGENT_ID (compat)
 */
export async function resolveRetellAgentId(
  tenantId: string,
  role: AgentRole = DEFAULT_ROLE,
): Promise<string | null> {
  const config = await getAgentConfig(tenantId, role);
  if (config?.retellAgentId) return config.retellAgentId;

  if (role === 'outbound') {
    return (
      process.env.RETELL_OUTBOUND_DEFAULT_AGENT_ID ?? process.env.RETELL_DEFAULT_AGENT_ID ?? null
    );
  }
  return process.env.RETELL_DEFAULT_AGENT_ID ?? null;
}
