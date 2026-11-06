import 'server-only';

import { type ReviewResult, reviewRun } from '@/lib/agent-review/flags';
import { db } from '@/lib/db/client';
import {
  tenants,
  whatsappAgentRuns,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import type { ToolCallTrace } from '@/lib/whatsapp/agent/types';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

export interface ReviewedRun {
  id: string;
  at: Date;
  tenantId: string;
  tenantName: string;
  conversationId: string;
  contactName: string | null;
  contactPhone: string | null;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  handoff: boolean;
  urgent: boolean;
  userText: string | null;
  responseText: string | null;
  tools: ToolCallTrace[];
  errorText: string | null;
  intentReasoning: string | null;
  review: ReviewResult;
}

/**
 * Las últimas respuestas del asistente de todas las clínicas (menos Futura),
 * cada una con su revisión automática. Para el panel de Futura; no es por
 * clínica porque quien lo mira es quien arregla el asistente, no la clínica.
 */
export async function listReviewedRuns(opts: {
  hours: number;
  excludeTenantId: string;
  tenantId?: string | null;
  limit?: number;
}): Promise<ReviewedRun[]> {
  const since = new Date(Date.now() - opts.hours * 3_600_000);
  const inbound = alias(whatsappMessages, 'inbound');
  const outbound = alias(whatsappMessages, 'outbound');
  const rows = await db
    .select({
      id: whatsappAgentRuns.id,
      at: whatsappAgentRuns.createdAt,
      tenantId: whatsappAgentRuns.tenantId,
      tenantName: tenants.name,
      conversationId: whatsappAgentRuns.conversationId,
      contactName: whatsappContacts.name,
      contactPhone: whatsappContacts.phoneE164,
      model: whatsappAgentRuns.model,
      latencyMs: whatsappAgentRuns.latencyMs,
      tokensIn: whatsappAgentRuns.tokensIn,
      tokensOut: whatsappAgentRuns.tokensOut,
      handoff: whatsappAgentRuns.handoff,
      urgent: whatsappAgentRuns.urgent,
      fallbackUsed: whatsappAgentRuns.fallbackUsed,
      userText: inbound.contentText,
      responseText: outbound.contentText,
      tools: whatsappAgentRuns.toolsCalled,
      errorText: whatsappAgentRuns.errorText,
      intentReasoning: whatsappAgentRuns.intentReasoning,
    })
    .from(whatsappAgentRuns)
    .innerJoin(tenants, eq(tenants.id, whatsappAgentRuns.tenantId))
    .innerJoin(
      whatsappConversations,
      eq(whatsappConversations.id, whatsappAgentRuns.conversationId),
    )
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .leftJoin(inbound, eq(inbound.id, whatsappAgentRuns.triggerMessageId))
    .leftJoin(outbound, eq(outbound.id, whatsappAgentRuns.responseMessageId))
    .where(
      and(
        gte(whatsappAgentRuns.createdAt, since),
        ne(whatsappAgentRuns.tenantId, opts.excludeTenantId),
        ...(opts.tenantId ? [eq(whatsappAgentRuns.tenantId, opts.tenantId)] : []),
      ),
    )
    .orderBy(desc(whatsappAgentRuns.createdAt))
    .limit(opts.limit ?? 400);

  return rows.map((r) => {
    const tools = Array.isArray(r.tools) ? (r.tools as ToolCallTrace[]) : [];
    return {
      ...r,
      tools,
      review: reviewRun({
        userText: r.userText,
        responseText: r.responseText,
        tools: tools.map((t) => ({ name: t.name, ok: t.ok, result: t.result, error: t.error })),
        errorText: r.errorText,
        intentReasoning: r.intentReasoning,
        latencyMs: r.latencyMs,
        handoff: r.handoff,
        fallbackUsed: r.fallbackUsed,
      }),
    };
  });
}
