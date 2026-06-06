import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappAgentSettings } from '@/lib/db/schema';

export type WhatsappAgentSettings = typeof whatsappAgentSettings.$inferSelect;

export async function getWhatsappAgentSettings(
  tenantId: string,
): Promise<{ persona: string | null; agentName: string | null } | null> {
  const rows = await db
    .select({ persona: whatsappAgentSettings.persona, agentName: whatsappAgentSettings.agentName })
    .from(whatsappAgentSettings)
    .where(eq(whatsappAgentSettings.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertWhatsappAgentSettings(input: {
  tenantId: string;
  persona: string | null;
  agentName: string | null;
}): Promise<void> {
  await db
    .insert(whatsappAgentSettings)
    .values({
      tenantId: input.tenantId,
      persona: input.persona,
      agentName: input.agentName,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: whatsappAgentSettings.tenantId,
      set: { persona: input.persona, agentName: input.agentName, updatedAt: new Date() },
    });
}
