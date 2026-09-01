import 'server-only';
import { and, eq, isNull, lt, ne } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { imMentions, tasks } from '@/lib/db/schema';
import { IM_EVENT_ROUTING, type ImContextType, type ImEvent } from '@/lib/messaging/constants';
import type { ImAction } from '@/lib/messaging/types';
import { formatDateTime, getTenantTimezone } from '@/lib/tasks/materialize';

/**
 * Puente entre el resto del producto y el módulo Mensajes.
 *
 * Mismo criterio que `lib/tasks/hooks.ts`: TODO es best-effort y NADA lanza.
 * Un webhook de GHL, un job de Retell o el guardado de una tarea no pueden
 * romperse porque no se pudo publicar una tarjeta en el chat. Si la migración
 * `0019_internal_messaging.sql` todavía no está aplicada, esto loguea y sigue.
 *
 * Idempotencia: el `dedupeKey` viaja hasta el índice único parcial de
 * `im_messages`, así que reintentar un webhook no duplica la tarjeta.
 */

export interface PostSystemEventInput {
  tenantId: string;
  event: ImEvent;
  title: string;
  body?: string;
  /** Dónde publicar. Sin esto se usa el canal por defecto de IM_EVENT_ROUTING. */
  channel?: { slug: string } | { contextType: ImContextType; contextId: string; label: string };
  /** Entidad del producto a la que se ancla la tarjeta. */
  context?: { type: ImContextType; id: string; payload: Record<string, unknown> };
  actions?: ImAction[];
  dedupeKey?: string;
  mentionUserIds?: string[];
}

export async function postSystemEvent(input: PostSystemEventInput): Promise<void> {
  try {
    const { ensureContextChannel, ensureSlugChannel } = await import('@/lib/messaging/channels');
    const { sendMessage } = await import('@/lib/messaging/service');

    const routing = IM_EVENT_ROUTING[input.event];

    let channelId: string;
    if (input.channel && 'slug' in input.channel) {
      channelId = (await ensureSlugChannel({ tenantId: input.tenantId, slug: input.channel.slug }))
        .id;
    } else if (input.channel) {
      channelId = (
        await ensureContextChannel({
          tenantId: input.tenantId,
          contextType: input.channel.contextType,
          contextId: input.channel.contextId,
          label: input.channel.label,
        })
      ).id;
    } else {
      channelId = (await ensureSlugChannel({ tenantId: input.tenantId, slug: routing.slug })).id;
    }

    const detail = input.body?.trim() ?? '';
    const dedupeKey =
      input.dedupeKey ?? `evt:${input.event}:${input.context?.id ?? input.tenantId}`;

    const res = await sendMessage({
      tenantId: input.tenantId,
      channelId,
      senderUserId: null,
      senderKind: 'BOT',
      kind: 'EVENT',
      body: detail ? `${input.title}\n${detail}` : input.title,
      actions: input.actions ?? [],
      contextType: input.context?.type ?? null,
      contextId: input.context?.id ?? null,
      contextPayload: {
        ...(input.context?.payload ?? {}),
        title: input.title,
        ...(detail ? { detail } : {}),
        tone: routing.tone,
      },
      eventKey: input.event,
      dedupeKey,
    });

    // Menciones explícitas (las del cuerpo ya las resuelve sendMessage). Solo
    // en el alta real: un reintento no vuelve a golpear la bandeja de nadie.
    if (res.created && input.mentionUserIds && input.mentionUserIds.length > 0) {
      await db
        .insert(imMentions)
        .values(
          [...new Set(input.mentionUserIds)].map((userId) => ({
            tenantId: input.tenantId,
            messageId: res.id,
            channelId,
            userId,
          })),
        )
        .onConflictDoNothing()
        .catch(() => undefined);
    }
  } catch (err) {
    console.warn('[messaging] postSystemEvent falló', {
      event: input.event,
      err: (err as Error).message,
    });
  }
}

// ─── Helpers finos por evento ────────────────────────────────────────────────
// Cada uno arma título, cuerpo y botones. Los call sites quedan en una línea y
// el copy vive acá, en un solo sitio.

/** Botón "convertir en tarea": el endpoint lo resuelve la UI con el id del mensaje. */
const TO_TASK_ACTION: ImAction = {
  id: 'to-task',
  label: 'Crear tarea',
  tone: 'secondary',
  action: 'message.to_task',
};

function callAction(phone: string | null, label = 'Llamar'): ImAction[] {
  return phone ? [{ id: 'call', label: `${label} ${phone}`, tone: 'soft', href: `tel:${phone}` }] : [];
}

function line(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

function joinLines(parts: Array<string | null>): string {
  return parts.filter(Boolean).join('\n');
}

/** Día de hoy en clave ISO, para deduplicar por jornada. */
function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Llamada perdida o cortada sin resolver. Va a #urgencias. */
export async function postMissedCall(args: {
  tenantId: string;
  callId: string;
  patientName: string;
  phone: string | null;
  intent?: string | null;
  summary?: string | null;
  startedAt?: Date | null;
  /** Transferida a humano y nadie la atendió. Cambia el evento y el copy. */
  transferredUnanswered?: boolean;
}): Promise<void> {
  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  const event: ImEvent = args.transferredUnanswered
    ? 'call.transferred_unanswered'
    : 'call.missed';
  const title = args.transferredUnanswered
    ? `Traspaso sin atender — ${args.patientName}`
    : `Llamada perdida — ${args.patientName}`;

  await postSystemEvent({
    tenantId: args.tenantId,
    event,
    title,
    body: joinLines([
      line('Teléfono', args.phone),
      line('Motivo', args.intent),
      line('Cuándo', args.startedAt ? formatDateTime(args.startedAt, tz) : null),
      args.summary?.trim() ? args.summary.trim().slice(0, 400) : null,
    ]),
    context: {
      type: 'CALL',
      id: args.callId,
      payload: {
        callId: args.callId,
        patientName: args.patientName,
        patientPhone: args.phone,
        intent: args.intent ?? null,
        summary: args.summary ?? null,
        /** La tarjeta monta el reproductor con esta URL si hay grabación. */
        recordingUrl: `/api/calls/${args.callId}/recording`,
      },
    },
    actions: [
      { id: 'open-call', label: 'Ver la llamada', tone: 'primary', href: `/dashboard/calls/${args.callId}` },
      ...callAction(args.phone, 'Devolver la llamada'),
      TO_TASK_ACTION,
    ],
    dedupeKey: `evt:${event}:${args.callId}`,
  });
}

/** Hueco liberado por una cancelación. Va a #agenda. */
export async function postSlotOpen(args: {
  tenantId: string;
  cancelledSlotId: string;
  slotStart: Date | null;
  treatmentName?: string | null;
  /** Paciente que matcheó primero, si lo hubo. */
  candidateName?: string | null;
  candidatePhone?: string | null;
  /** Motivo por el que no se ofreció, cuando no hubo match. */
  skippedReason?: string | null;
}): Promise<void> {
  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  const when = args.slotStart ? formatDateTime(args.slotStart, tz) : 'sin fecha';

  await postSystemEvent({
    tenantId: args.tenantId,
    event: 'waitlist.slot_open',
    title: `Hueco libre — ${when}`,
    body: joinLines([
      line('Tratamiento', args.treatmentName),
      args.candidateName
        ? `Primer candidato de la cola: ${args.candidateName}${args.candidatePhone ? ` (${args.candidatePhone})` : ''}`
        : 'Nadie en la cola encaja con este hueco todavía.',
      args.skippedReason ? `Sin oferta automática: ${args.skippedReason}` : null,
    ]),
    context: {
      type: 'WAITLIST_ENTRY',
      id: args.cancelledSlotId,
      payload: {
        cancelledSlotId: args.cancelledSlotId,
        slotStart: args.slotStart?.toISOString() ?? null,
        treatmentName: args.treatmentName ?? null,
        candidateName: args.candidateName ?? null,
        candidatePhone: args.candidatePhone ?? null,
      },
    },
    actions: [
      { id: 'open-waitlist', label: 'Ver la cola de espera', tone: 'primary', href: '/dashboard/waitlist' },
      ...callAction(args.candidatePhone ?? null, 'Ofrecerlo yo a'),
      TO_TASK_ACTION,
    ],
    dedupeKey: `evt:waitlist.slot_open:${args.cancelledSlotId}`,
  });
}

/** Dijo que sí y la cita no se creó. Lo más caro que se puede perder. */
export async function postWaitlistBookFailed(args: {
  tenantId: string;
  entryId: string;
  patientName: string;
  phone: string | null;
  slotStart: Date | null;
  reason?: string | null;
}): Promise<void> {
  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  await postSystemEvent({
    tenantId: args.tenantId,
    event: 'waitlist.book_failed',
    title: `Aceptó el hueco y NO quedó agendado — ${args.patientName}`,
    body: joinLines([
      '@equipo esto se cierra a mano ahora o se pierde.',
      line('Hueco', args.slotStart ? formatDateTime(args.slotStart, tz) : null),
      line('Teléfono', args.phone),
      line('Error', args.reason),
    ]),
    context: {
      type: 'WAITLIST_ENTRY',
      id: args.entryId,
      payload: {
        waitlistEntryId: args.entryId,
        patientName: args.patientName,
        patientPhone: args.phone,
        slotStart: args.slotStart?.toISOString() ?? null,
      },
    },
    actions: [
      ...callAction(args.phone, 'Llamar a'),
      { id: 'open-waitlist', label: 'Ver la cola de espera', tone: 'secondary', href: '/dashboard/waitlist' },
      TO_TASK_ACTION,
    ],
    dedupeKey: `evt:waitlist.book_failed:${args.entryId}`,
  });
}

/** El agente de WhatsApp soltó la conversación. Va a #urgencias. */
export async function postWhatsappHandoff(args: {
  tenantId: string;
  conversationId: string;
  patientName: string;
  phone: string | null;
  /** Últimas líneas del chat, ya recortadas por el call site. */
  lastLines?: string[];
}): Promise<void> {
  const excerpt = (args.lastLines ?? []).slice(-3).join('\n').slice(0, 500);
  await postSystemEvent({
    tenantId: args.tenantId,
    event: 'wa.handoff',
    title: `WhatsApp pide humano — ${args.patientName}`,
    body: joinLines([line('Teléfono', args.phone), excerpt || null]),
    context: {
      type: 'WA_CONVERSATION',
      id: args.conversationId,
      payload: {
        whatsappConversationId: args.conversationId,
        patientName: args.patientName,
        patientPhone: args.phone,
        excerpt,
      },
    },
    actions: [
      {
        id: 'open-wa',
        label: 'Tomar la conversación',
        tone: 'primary',
        href: `/dashboard/whatsapp/${args.conversationId}`,
      },
      TO_TASK_ACTION,
    ],
    // Una tarjeta por conversación y por día: si sigue caliente mañana, vuelve.
    dedupeKey: `evt:wa.handoff:${args.conversationId}:${dayKey()}`,
  });
}

/** Recordatorio enviado, cita sin confirmar. Va a #agenda. */
export async function postReminderNoResponse(args: {
  tenantId: string;
  reminderId: string;
  patientName: string;
  phone: string | null;
  appointmentStart: Date | null;
  ghlAppointmentId?: string | null;
}): Promise<void> {
  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  await postSystemEvent({
    tenantId: args.tenantId,
    event: 'reminder.no_response',
    title: `Sin confirmar — ${args.patientName}`,
    body: joinLines([
      line('Cita', args.appointmentStart ? formatDateTime(args.appointmentStart, tz) : null),
      line('Teléfono', args.phone),
      'El recordatorio salió y no hubo respuesta.',
    ]),
    context: {
      type: 'APPOINTMENT',
      id: args.ghlAppointmentId ?? args.reminderId,
      payload: {
        reminderId: args.reminderId,
        ghlAppointmentId: args.ghlAppointmentId ?? null,
        patientName: args.patientName,
        patientPhone: args.phone,
        appointmentStart: args.appointmentStart?.toISOString() ?? null,
      },
    },
    actions: [
      ...callAction(args.phone, 'Llamar a'),
      { id: 'open-reminders', label: 'Ver recordatorios', tone: 'secondary', href: '/dashboard/reminders' },
      { id: 'free-slot', label: 'Liberar el hueco', tone: 'soft', href: '/dashboard/waitlist' },
      TO_TASK_ACTION,
    ],
    dedupeKey: `evt:reminder.no_response:${args.reminderId}`,
  });
}

/** Cita cancelada en GHL. Va a #agenda. */
export async function postAppointmentCancelled(args: {
  tenantId: string;
  ghlAppointmentId: string;
  patientName: string;
  phone: string | null;
  startTime: Date | null;
}): Promise<void> {
  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  await postSystemEvent({
    tenantId: args.tenantId,
    event: 'appointment.cancelled',
    title: `Cita cancelada — ${args.patientName}`,
    body: joinLines([
      line('Era', args.startTime ? formatDateTime(args.startTime, tz) : null),
      line('Teléfono', args.phone),
    ]),
    context: {
      type: 'APPOINTMENT',
      id: args.ghlAppointmentId,
      payload: {
        ghlAppointmentId: args.ghlAppointmentId,
        patientName: args.patientName,
        patientPhone: args.phone,
        startTime: args.startTime?.toISOString() ?? null,
      },
    },
    actions: [
      ...callAction(args.phone, 'Reagendar llamando a'),
      { id: 'free-slot', label: 'Liberar el hueco', tone: 'primary', href: '/dashboard/waitlist' },
      TO_TASK_ACTION,
    ],
    dedupeKey: `evt:appointment.cancelled:${args.ghlAppointmentId}`,
  });
}

/** La cita quedó marcada como no-show. Va a #agenda. */
export async function postAppointmentNoShow(args: {
  tenantId: string;
  ghlAppointmentId: string;
  patientName: string;
  phone: string | null;
  startTime: Date | null;
}): Promise<void> {
  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  await postSystemEvent({
    tenantId: args.tenantId,
    event: 'appointment.no_show',
    title: `No se presentó — ${args.patientName}`,
    body: joinLines([
      line('Era', args.startTime ? formatDateTime(args.startTime, tz) : null),
      line('Teléfono', args.phone),
    ]),
    context: {
      type: 'APPOINTMENT',
      id: args.ghlAppointmentId,
      payload: {
        ghlAppointmentId: args.ghlAppointmentId,
        patientName: args.patientName,
        patientPhone: args.phone,
        startTime: args.startTime?.toISOString() ?? null,
      },
    },
    actions: [...callAction(args.phone, 'Llamar a'), TO_TASK_ACTION],
    dedupeKey: `evt:appointment.no_show:${args.ghlAppointmentId}`,
  });
}

/**
 * Tarea asignada. Va por DM cuando sabemos quién asignó; si la asignación la
 * hizo una automatización (sin actor), cae en el canal por defecto.
 */
export async function postTaskAssigned(args: {
  tenantId: string;
  taskId: string;
  title: string;
  assigneeUserIds: string[];
  actorUserId?: string | null;
  actorName?: string | null;
  dueAt?: Date | null;
}): Promise<void> {
  const targets = [...new Set(args.assigneeUserIds)].filter((id) => id && id !== args.actorUserId);
  if (targets.length === 0) return;

  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  const body = joinLines([
    args.actorName ? `Te la asignó ${args.actorName}.` : 'Te asignaron esta tarea.',
    line('Vence', args.dueAt ? formatDateTime(args.dueAt, tz) : null),
  ]);
  const actions: ImAction[] = [
    { id: 'open-task', label: 'Abrir la tarea', tone: 'primary', href: '/dashboard/tasks' },
  ];

  for (const userId of targets) {
    try {
      if (args.actorUserId) {
        const { ensureDmChannel } = await import('@/lib/messaging/channels');
        const { sendMessage } = await import('@/lib/messaging/service');
        const dm = await ensureDmChannel({
          tenantId: args.tenantId,
          userIdA: args.actorUserId,
          userIdB: userId,
        });
        await sendMessage({
          tenantId: args.tenantId,
          channelId: dm.id,
          senderUserId: null,
          senderKind: 'BOT',
          kind: 'EVENT',
          body: `Tarea asignada — ${args.title}\n${body}`,
          actions,
          contextType: 'TASK',
          contextId: args.taskId,
          contextPayload: { taskId: args.taskId, title: args.title, tone: 'blossom' },
          eventKey: 'task.assigned',
          dedupeKey: `evt:task.assigned:${args.taskId}:${userId}`,
        });
      } else {
        await postSystemEvent({
          tenantId: args.tenantId,
          event: 'task.assigned',
          title: `Tarea asignada — ${args.title}`,
          body,
          context: { type: 'TASK', id: args.taskId, payload: { taskId: args.taskId } },
          actions,
          mentionUserIds: [userId],
          dedupeKey: `evt:task.assigned:${args.taskId}:${userId}`,
        });
      }
    } catch (err) {
      console.warn('[messaging] postTaskAssigned falló', { err: (err as Error).message });
    }
  }
}

/**
 * Resumen diario de vencidas. UN mensaje con el recuento, no una tarjeta por
 * tarea: el bot que publica de más se silencia y el módulo muere.
 */
export async function postTaskOverdueDigest(args: {
  tenantId: string;
  /** Máximo de títulos a listar en el cuerpo. */
  limit?: number;
}): Promise<void> {
  try {
    const now = new Date();
    const rows = await db
      .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, args.tenantId),
          isNull(tasks.archivedAt),
          ne(tasks.status, 'DONE'),
          lt(tasks.dueAt, now),
        ),
      )
      .orderBy(tasks.dueAt)
      .limit(50);

    if (rows.length === 0) return;

    const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
    const shown = rows.slice(0, args.limit ?? 8);
    const lines = shown.map(
      (t) => `· ${t.title}${t.dueAt ? ` (vencía ${formatDateTime(t.dueAt, tz)})` : ''}`,
    );
    if (rows.length > shown.length) lines.push(`… y ${rows.length - shown.length} más.`);

    await postSystemEvent({
      tenantId: args.tenantId,
      event: 'task.overdue_digest',
      title: `${rows.length} tarea${rows.length === 1 ? '' : 's'} vencida${rows.length === 1 ? '' : 's'}`,
      body: lines.join('\n'),
      context: {
        type: 'TASK',
        id: `digest:${dayKey()}`,
        payload: { overdue: rows.length, taskIds: shown.map((t) => t.id) },
      },
      actions: [
        { id: 'open-tasks', label: 'Abrir el tablero', tone: 'primary', href: '/dashboard/tasks' },
      ],
      dedupeKey: `evt:task.overdue_digest:${dayKey()}`,
    });
  } catch (err) {
    console.warn('[messaging] postTaskOverdueDigest falló', { err: (err as Error).message });
  }
}

/**
 * Espeja un comentario de tarea en su hilo `CONTEXT`. La conversación humana
 * vive en el chat; `task_comments` queda como registro de actividad.
 */
export async function postTaskThreadComment(args: {
  tenantId: string;
  taskId: string;
  taskTitle: string;
  authorUserId: string | null;
  body: string;
}): Promise<void> {
  try {
    const { ensureContextChannel } = await import('@/lib/messaging/channels');
    const { sendMessage } = await import('@/lib/messaging/service');

    const channel = await ensureContextChannel({
      tenantId: args.tenantId,
      contextType: 'TASK',
      contextId: args.taskId,
      label: args.taskTitle.slice(0, 160),
      createdByUserId: args.authorUserId,
      memberUserIds: args.authorUserId ? [args.authorUserId] : [],
    });

    await sendMessage({
      tenantId: args.tenantId,
      channelId: channel.id,
      senderUserId: args.authorUserId,
      senderKind: args.authorUserId ? 'USER' : 'SYSTEM',
      kind: 'TEXT',
      body: args.body,
      contextType: 'TASK',
      contextId: args.taskId,
      contextPayload: { taskId: args.taskId },
    });
  } catch (err) {
    console.warn('[messaging] postTaskThreadComment falló', { err: (err as Error).message });
  }
}

/** Aviso plano en un canal ya resuelto. Lo usa `to-task` para confirmar. */
export async function postSystemNote(args: {
  tenantId: string;
  channelId: string;
  body: string;
  actions?: ImAction[];
  contextType?: ImContextType | null;
  contextId?: string | null;
  contextPayload?: Record<string, unknown>;
  dedupeKey?: string;
}): Promise<void> {
  try {
    const { sendMessage } = await import('@/lib/messaging/service');
    await sendMessage({
      tenantId: args.tenantId,
      channelId: args.channelId,
      senderUserId: null,
      senderKind: 'SYSTEM',
      kind: 'SYSTEM',
      body: args.body,
      actions: args.actions ?? [],
      contextType: args.contextType ?? null,
      contextId: args.contextId ?? null,
      contextPayload: args.contextPayload ?? {},
      dedupeKey: args.dedupeKey ?? null,
    });
  } catch (err) {
    console.warn('[messaging] postSystemNote falló', { err: (err as Error).message });
  }
}
