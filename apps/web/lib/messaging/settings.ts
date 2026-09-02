import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { imUserSettings } from '@/lib/db/schema';

// La lógica de la franja vive en un módulo puro para poder probarse sin entorno.
export { isWithinDnd } from '@/lib/messaging/dnd';

/* ============================================================================
   Preferencias de aviso por persona.

   La tabla `im_user_settings` se leía en tres sitios (el escalado de menciones,
   la presencia y el barrido de retención) y NADIE escribía nunca en ella. Con
   lo cual `escalate_mentions_after_minutes` se quedaba en 0 para siempre y el
   aviso fuera del panel no podía dispararse jamás.
   ========================================================================== */

export interface MessagingSettings {
  sound: boolean;
  desktopPush: boolean;
  /** 'HH:MM' en la zona de la clínica. Ambos null = sin franja de silencio. */
  dndFrom: string | null;
  dndTo: string | null;
  /** 0 = no escalar. Es el defecto a propósito: mal calibrado, esto es spam. */
  escalateMentionsAfterMinutes: number;
  statusEmoji: string | null;
  statusText: string | null;
  statusUntil: string | null;
}

export const DEFAULT_SETTINGS: MessagingSettings = {
  sound: true,
  desktopPush: true,
  dndFrom: null,
  dndTo: null,
  escalateMentionsAfterMinutes: 0,
  statusEmoji: null,
  statusText: null,
  statusUntil: null,
};

/** Nunca lanza: sin fila, o sin la migración aplicada, se devuelven los defectos. */
export async function loadSettings(tenantId: string, userId: string): Promise<MessagingSettings> {
  try {
    const [row] = await db
      .select()
      .from(imUserSettings)
      .where(and(eq(imUserSettings.tenantId, tenantId), eq(imUserSettings.userId, userId)))
      .limit(1);
    if (!row) return DEFAULT_SETTINGS;
    return {
      sound: row.sound,
      desktopPush: row.desktopPush,
      dndFrom: row.dndFrom,
      dndTo: row.dndTo,
      escalateMentionsAfterMinutes: row.escalateMentionsAfterMinutes,
      statusEmoji: row.statusEmoji,
      statusText: row.statusText,
      statusUntil: row.statusUntil ? row.statusUntil.toISOString() : null,
    };
  } catch (err) {
    console.warn('[messaging-settings] no se pudieron leer las preferencias', {
      err: (err as Error).message,
    });
    return DEFAULT_SETTINGS;
  }
}

export type SettingsPatch = Partial<Omit<MessagingSettings, 'statusUntil'>> & {
  statusUntil?: string | null;
};

/** Upsert por (tenant, user). Devuelve el estado ya guardado. */
export async function saveSettings(
  tenantId: string,
  userId: string,
  patch: SettingsPatch,
): Promise<MessagingSettings> {
  const values: Record<string, unknown> = {};
  if (patch.sound !== undefined) values.sound = patch.sound;
  if (patch.desktopPush !== undefined) values.desktopPush = patch.desktopPush;
  if (patch.dndFrom !== undefined) values.dndFrom = patch.dndFrom;
  if (patch.dndTo !== undefined) values.dndTo = patch.dndTo;
  if (patch.escalateMentionsAfterMinutes !== undefined) {
    values.escalateMentionsAfterMinutes = patch.escalateMentionsAfterMinutes;
  }
  if (patch.statusEmoji !== undefined) values.statusEmoji = patch.statusEmoji;
  if (patch.statusText !== undefined) values.statusText = patch.statusText;
  if (patch.statusUntil !== undefined) {
    values.statusUntil = patch.statusUntil ? new Date(patch.statusUntil) : null;
  }
  values.updatedAt = new Date();

  await db
    .insert(imUserSettings)
    .values({ tenantId, userId, ...values })
    .onConflictDoUpdate({
      target: [imUserSettings.tenantId, imUserSettings.userId],
      set: values,
    });

  return loadSettings(tenantId, userId);
}
