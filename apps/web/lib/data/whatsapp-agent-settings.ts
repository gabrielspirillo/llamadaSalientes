import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappAgentSettings } from '@/lib/db/schema';

export type WhatsappAgentSettings = typeof whatsappAgentSettings.$inferSelect;

/**
 * Qué hace el asistente de WhatsApp cuando alguien pregunta por una cita.
 *
 * - BOOKING: cierra el círculo él mismo (consulta huecos y reserva). Es el
 *   comportamiento de siempre y el defecto.
 * - DERIVE: no agenda. Recopila la consulta, se la manda por WhatsApp al
 *   profesional que corresponde y le dice al paciente que le van a escribir.
 *   Lo pidió un centro que quiere que sea el profesional quien decida.
 */
export const WHATSAPP_AGENT_MODES = ['BOOKING', 'DERIVE'] as const;
export type WhatsappAgentMode = (typeof WHATSAPP_AGENT_MODES)[number];

export function isWhatsappAgentMode(value: unknown): value is WhatsappAgentMode {
  return typeof value === 'string' && (WHATSAPP_AGENT_MODES as readonly string[]).includes(value);
}

export interface WhatsappAgentRuntimeSettings {
  persona: string | null;
  agentName: string | null;
  mode: WhatsappAgentMode;
  /** Destinatario de respaldo en modo DERIVE. E.164. */
  deriveFallbackPhone: string | null;
}

export async function getWhatsappAgentSettings(
  tenantId: string,
): Promise<WhatsappAgentRuntimeSettings | null> {
  const rows = await db
    .select({
      persona: whatsappAgentSettings.persona,
      agentName: whatsappAgentSettings.agentName,
      agentMode: whatsappAgentSettings.agentMode,
      deriveFallbackPhone: whatsappAgentSettings.deriveFallbackPhone,
    })
    .from(whatsappAgentSettings)
    .where(eq(whatsappAgentSettings.tenantId, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    persona: row.persona,
    agentName: row.agentName,
    // Una fila vieja (o un valor que alguien metió a mano) no puede dejar al
    // asistente en un modo que no existe: ante la duda, el de siempre.
    mode: isWhatsappAgentMode(row.agentMode) ? row.agentMode : 'BOOKING',
    deriveFallbackPhone: row.deriveFallbackPhone,
  };
}

/**
 * Personalización de tono/nombre. No toca el modo: son dos ajustes distintos
 * y los edita gente distinta (la clínica el tono, Futura el modo).
 */
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

/**
 * Cambia el modo del asistente de una clínica. Sólo lo toca Futura desde su
 * panel: es una decisión de producto por cliente, no un ajuste de la clínica.
 */
export async function setWhatsappAgentMode(input: {
  tenantId: string;
  mode: WhatsappAgentMode;
  deriveFallbackPhone: string | null;
}): Promise<void> {
  await db
    .insert(whatsappAgentSettings)
    .values({
      tenantId: input.tenantId,
      agentMode: input.mode,
      deriveFallbackPhone: input.deriveFallbackPhone,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: whatsappAgentSettings.tenantId,
      set: {
        agentMode: input.mode,
        deriveFallbackPhone: input.deriveFallbackPhone,
        updatedAt: new Date(),
      },
    });
}
