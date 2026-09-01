import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { imChannels, imMentions, imUserSettings, users } from '@/lib/db/schema';
import type { QueueJobs } from '@/lib/queue/queues';
import type { StepRunner } from '@/lib/queue/step';
import { isWithinDnd } from '@/lib/messaging/dnd';
import { getTenantTimezone } from '@/lib/tasks/materialize';
import { localParts } from '@/lib/tasks/tz';

/**
 * Escalado de una mención que nadie leyó.
 *
 * Se encola con `delay = escalate_mentions_after_minutes` cuando se crea la
 * mención. Al ejecutar vuelve a mirar el estado: si mientras tanto la leyeron o
 * la resolvieron, no hace nada. Es el último escalón de la escalera de
 * notificación (§9 del plan) y **está apagado por defecto** — la columna
 * arranca en 0 y sin un valor positivo no se encola nada.
 *
 * RGPD: el aviso sale del panel y viaja por WhatsApp a un móvil personal. Por
 * eso NO lleva nombre de paciente, ni teléfono, ni el cuerpo del mensaje: sólo
 * quién menciona y en qué canal. El contenido se lee dentro del panel, que es
 * donde hay control de acceso y auditoría.
 *
 * Best-effort: cualquier fallo se loguea y el job termina bien. Un aviso que no
 * sale no puede dejar el worker caído.
 */

/** Texto del aviso. Sin datos de paciente, a propósito. */
function buildNotice(channelLabel: string): string {
  return `Te mencionaron en ${channelLabel} en el panel. Entrá a Mensajes para verlo.`;
}

export async function processImMentionEscalateJob(
  data: QueueJobs['im-mention-escalate'],
  step: StepRunner,
): Promise<{ status: 'skipped' | 'escalated'; reason?: string; notified?: boolean }> {
  const { tenantId, mentionId } = data;

  const loaded = await step.run('load-mention', async () => {
    const [row] = await db
      .select({
        id: imMentions.id,
        userId: imMentions.userId,
        readAt: imMentions.readAt,
        resolvedAt: imMentions.resolvedAt,
        escalatedAt: imMentions.escalatedAt,
        channelName: imChannels.name,
        channelSlug: imChannels.slug,
        channelKind: imChannels.kind,
        afterMinutes: imUserSettings.escalateMentionsAfterMinutes,
        dndFrom: imUserSettings.dndFrom,
        dndTo: imUserSettings.dndTo,
        clerkUserId: users.clerkUserId,
      })
      .from(imMentions)
      .innerJoin(imChannels, eq(imChannels.id, imMentions.channelId))
      .innerJoin(users, eq(users.id, imMentions.userId))
      .leftJoin(
        imUserSettings,
        and(
          eq(imUserSettings.tenantId, imMentions.tenantId),
          eq(imUserSettings.userId, imMentions.userId),
        ),
      )
      .where(and(eq(imMentions.tenantId, tenantId), eq(imMentions.id, mentionId)))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      escalatedAt: row.escalatedAt ? row.escalatedAt.toISOString() : null,
    };
  });

  if (!loaded) return { status: 'skipped', reason: 'mencion-inexistente' };
  if (loaded.readAt) return { status: 'skipped', reason: 'ya-leida' };
  if (loaded.resolvedAt) return { status: 'skipped', reason: 'ya-resuelta' };
  if (loaded.escalatedAt) return { status: 'skipped', reason: 'ya-escalada' };
  if ((loaded.afterMinutes ?? 0) <= 0) return { status: 'skipped', reason: 'escalado-desactivado' };

  // No molestar. La UI promete que dentro de la franja no se avisa por fuera;
  // si el worker no lo respetara, la promesa sería mentira. Se evalúa en la
  // zona de la clínica, no en la del servidor.
  if (loaded.dndFrom && loaded.dndTo) {
    const tz = await getTenantTimezone(tenantId).catch(() => 'Europe/Madrid');
    const { hour, minute } = localParts(new Date(), tz);
    const nowHHMM = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (isWithinDnd(loaded.dndFrom, loaded.dndTo, nowHHMM)) {
      return { status: 'skipped', reason: 'no-molestar' };
    }
  }

  // Se marca ANTES de intentar el envío: si WhatsApp está caído no queremos que
  // el retry del job dispare un segundo aviso al reconectar.
  await db
    .update(imMentions)
    .set({ escalatedAt: new Date() })
    .where(and(eq(imMentions.tenantId, tenantId), eq(imMentions.id, mentionId)));

  const channelLabel = describeChannel(loaded.channelName, loaded.channelSlug, loaded.channelKind);
  const notified = await notifyByWhatsapp(tenantId, loaded.clerkUserId, channelLabel);

  return { status: 'escalated', notified };
}

function describeChannel(name: string | null, slug: string | null, kind: string | null): string {
  if (kind === 'DM') return 'un mensaje directo';
  if (slug) return `#${slug}`;
  if (name) return `«${name}»`;
  return 'un canal';
}

/**
 * Aviso por WhatsApp reutilizando el connector del tenant (el mismo que usan
 * los recordatorios). Si no hay teléfono del usuario en Clerk o el tenant no
 * tiene WhatsApp conectado, la mención queda igualmente marcada como escalada
 * y no se intenta nada más: no hay otro canal de salida hacia el móvil.
 */
async function notifyByWhatsapp(
  tenantId: string,
  clerkUserId: string,
  channelLabel: string,
): Promise<boolean> {
  try {
    const phone = await lookupUserPhone(clerkUserId);
    if (!phone) {
      console.log('[im-mention-escalate] sin teléfono para el usuario, sólo se marca', {
        tenantId,
      });
      return false;
    }

    const { getConnectorForTenant } = await import('@/lib/whatsapp/factory');
    const connector = await getConnectorForTenant(tenantId);
    if (!connector) {
      console.log('[im-mention-escalate] tenant sin WhatsApp conectado, sólo se marca', {
        tenantId,
      });
      return false;
    }

    await connector.sendText(phone, buildNotice(channelLabel));
    return true;
  } catch (err) {
    console.warn('[im-mention-escalate] no se pudo avisar', {
      tenantId,
      err: (err as Error).message,
    });
    return false;
  }
}

/** Teléfono del miembro. Clerk es la única fuente: `users` no guarda móvil. */
async function lookupUserPhone(clerkUserId: string): Promise<string | null> {
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const cc = await clerkClient();
    const user = await cc.users.getUser(clerkUserId);
    const primary =
      user.phoneNumbers.find((p) => p.id === user.primaryPhoneNumberId) ?? user.phoneNumbers[0];
    const raw = primary?.phoneNumber ?? null;
    if (!raw) return null;
    const trimmed = raw.trim();
    return /^\+\d{6,15}$/.test(trimmed) ? trimmed : null;
  } catch (err) {
    console.warn('[im-mention-escalate] lookup de teléfono falló', {
      err: (err as Error).message,
    });
    return null;
  }
}
