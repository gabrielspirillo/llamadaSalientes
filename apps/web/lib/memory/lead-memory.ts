import 'server-only';

import { and, desc, eq, or } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  calls,
  leadMemory,
  tenants,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { summarizeLeadMemory } from '@/lib/openai/client';

/**
 * Memoria unificada por lead, cross-canal (WhatsApp + llamadas in/out).
 *
 * - `updateLeadMemory(tenant, phone)`: junta la actividad reciente de los
 *   módulos ACTIVOS del tenant (WhatsApp si `whatsapp`, llamadas si `inbound`
 *   o `outbound`), hace UNA llamada de resumen y hace upsert del perfil. Es
 *   best-effort: nunca lanza (no debe romper el flujo del agente / del worker).
 * - `getLeadMemory(tenant, phone)`: lectura para inyectar al agente.
 *
 * Llave universal: (tenant_id, phone_e164). Agnóstico al proveedor de WhatsApp
 * porque Cloud/Twilio/Evolution ya normalizan en whatsapp_messages.
 */

interface EnabledModules {
  whatsapp: boolean;
  outbound: boolean;
  inbound: boolean;
}

const MAX_WA_MESSAGES = 20;
const MAX_CALLS = 10;

async function getEnabledModules(tenantId: string): Promise<EnabledModules> {
  const rows = await db
    .select({ modules: tenants.enabledModules })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0]?.modules ?? { whatsapp: false, outbound: false, inbound: false };
}

export type LeadMemoryRow = typeof leadMemory.$inferSelect;

export async function getLeadMemory(
  tenantId: string,
  phoneE164: string,
): Promise<LeadMemoryRow | null> {
  const rows = await db
    .select()
    .from(leadMemory)
    .where(and(eq(leadMemory.tenantId, tenantId), eq(leadMemory.phoneE164, phoneE164)))
    .limit(1);
  return rows[0] ?? null;
}

/** Junta el material reciente del lead, gated por los módulos activos. */
async function gatherMaterial(
  tenantId: string,
  phoneE164: string,
  modules: EnabledModules,
): Promise<{ material: string; ghlContactId: string | null }> {
  const blocks: string[] = [];
  let ghlContactId: string | null = null;

  if (modules.whatsapp) {
    const contactRows = await db
      .select()
      .from(whatsappContacts)
      .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.phoneE164, phoneE164)))
      .limit(1);
    const contact = contactRows[0];
    if (contact) {
      ghlContactId = contact.ghlContactId ?? ghlContactId;
      const msgs = await db
        .select({
          direction: whatsappMessages.direction,
          contentText: whatsappMessages.contentText,
          transcription: whatsappMessages.transcription,
          createdAt: whatsappMessages.createdAt,
        })
        .from(whatsappMessages)
        .innerJoin(
          whatsappConversations,
          eq(whatsappConversations.id, whatsappMessages.conversationId),
        )
        .where(
          and(
            eq(whatsappConversations.contactId, contact.id),
            eq(whatsappMessages.internalNote, false),
          ),
        )
        .orderBy(desc(whatsappMessages.createdAt))
        .limit(MAX_WA_MESSAGES);
      if (msgs.length) {
        const lines = msgs
          .reverse()
          .map((m) => `[${m.direction}] ${m.contentText ?? m.transcription ?? '(media)'}`)
          .join('\n');
        blocks.push(`WhatsApp (mensajes recientes):\n${lines}`);
      }
    }
  }

  if (modules.inbound || modules.outbound) {
    const callRows = await db
      .select({
        summary: calls.summary,
        intent: calls.intent,
        sentiment: calls.sentiment,
        startedAt: calls.startedAt,
        ghlContactId: calls.ghlContactId,
      })
      .from(calls)
      .where(
        and(
          eq(calls.tenantId, tenantId),
          or(eq(calls.fromNumber, phoneE164), eq(calls.toNumber, phoneE164)),
        ),
      )
      .orderBy(desc(calls.startedAt))
      .limit(MAX_CALLS);
    if (callRows.length) {
      ghlContactId =
        ghlContactId ?? callRows.find((c) => c.ghlContactId)?.ghlContactId ?? null;
      const lines = callRows
        .map((c) => {
          const when = c.startedAt ? c.startedAt.toISOString().slice(0, 10) : 's/f';
          return `- ${when} · intent=${c.intent ?? '?'} · sentimiento=${c.sentiment ?? '?'}: ${c.summary ?? 'sin resumen'}`;
        })
        .join('\n');
      blocks.push(`Llamadas (resúmenes recientes):\n${lines}`);
    }
  }

  return { material: blocks.join('\n\n'), ghlContactId };
}

/**
 * Regenera la memoria del lead a partir de su actividad reciente. Best-effort:
 * loguea y sale ante cualquier error (no debe romper el worker ni el agente).
 */
export async function updateLeadMemory(tenantId: string, phoneE164: string): Promise<void> {
  try {
    const modules = await getEnabledModules(tenantId);
    if (!modules.whatsapp && !modules.inbound && !modules.outbound) return;

    const { material, ghlContactId } = await gatherMaterial(tenantId, phoneE164, modules);
    if (!material.trim()) return; // nada que recordar todavía

    const prior = await getLeadMemory(tenantId, phoneE164);
    const result = await summarizeLeadMemory({
      priorProfile: prior?.profileSummary ?? null,
      material,
    });

    const resolvedGhl = ghlContactId ?? prior?.ghlContactId ?? null;
    await db
      .insert(leadMemory)
      .values({
        tenantId,
        phoneE164,
        ghlContactId: resolvedGhl,
        profileSummary: result.profileSummary,
        facts: result.facts,
        lastInteractionAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [leadMemory.tenantId, leadMemory.phoneE164],
        set: {
          ghlContactId: resolvedGhl,
          profileSummary: result.profileSummary,
          facts: result.facts,
          lastInteractionAt: new Date(),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn('[lead-memory] update falló', {
      tenantId,
      phoneE164,
      err: (err as Error).message,
    });
  }
}
