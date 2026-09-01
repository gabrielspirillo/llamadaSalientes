import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { postSystemNote } from '@/lib/messaging/bot';
import { loadMessage } from '@/lib/messaging/queries';
import { createTask } from '@/lib/tasks/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

const schema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  assigneeUserIds: z.array(z.string().uuid()).max(20).optional(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
});

/**
 * Convierte un mensaje en tarea.
 *
 * La tarea HEREDA el contexto del mensaje: si la tarjeta hablaba de un
 * paciente, una llamada o una conversación de WhatsApp, la tarea nace ya
 * enganchada a eso. Eso es lo que evita el "creá una tarea y volvé a pegar los
 * datos a mano", que es donde se pierde la mitad de la información.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('operator');
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new MessagingNotFoundError('Mensaje');

    const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {});
    if (!parsed.success) return badRequest(parsed.error.issues);

    const message = await loadMessage(auth.tenantId, id, auth.userId);
    if (!message) throw new MessagingNotFoundError('Mensaje');
    // Nunca se confía en el id del cliente: hay que ser miembro del canal.
    await requireChannelMember(auth, message.channelId);

    const payload = (message.contextPayload ?? {}) as Record<string, unknown>;
    const str = (key: string): string | null => {
      const v = payload[key];
      return typeof v === 'string' && v.trim() ? v : null;
    };

    // Herencia de contexto según a qué entidad estaba anclado el mensaje.
    const inherited: {
      patientGhlContactId?: string | null;
      patientName?: string | null;
      patientPhone?: string | null;
      callId?: string | null;
      whatsappConversationId?: string | null;
      ghlAppointmentId?: string | null;
      waitlistEntryId?: string | null;
    } = {
      patientGhlContactId: str('patientGhlContactId') ?? str('ghlContactId'),
      patientName: str('patientName'),
      patientPhone: str('patientPhone') ?? str('phone'),
    };

    switch (message.contextType) {
      case 'CALL':
        inherited.callId = str('callId') ?? message.contextId;
        break;
      case 'WA_CONVERSATION':
        inherited.whatsappConversationId = str('whatsappConversationId') ?? message.contextId;
        break;
      case 'APPOINTMENT':
        inherited.ghlAppointmentId = str('ghlAppointmentId') ?? message.contextId;
        break;
      case 'WAITLIST_ENTRY':
        inherited.waitlistEntryId = str('waitlistEntryId');
        break;
      case 'PATIENT':
        inherited.patientGhlContactId = inherited.patientGhlContactId ?? message.contextId;
        break;
      default:
        break;
    }

    // El título por defecto sale del propio mensaje: la primera línea, cortada.
    const fallbackTitle =
      str('title') ??
      (message.body ?? '').trim().split('\n')[0]?.trim().slice(0, 200) ??
      '';
    const title = parsed.data.title ?? (fallbackTitle || 'Tarea desde un mensaje');

    const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;

    const created = await createTask({
      tenantId: auth.tenantId,
      title,
      description: (message.body ?? '').trim().slice(0, 4000) || null,
      source: 'MANUAL',
      createdByUserId: auth.userId,
      assigneeUserIds: parsed.data.assigneeUserIds ?? [],
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
      imChannelId: message.channelId,
      imMessageId: message.id,
      activityNote: 'Creada desde un mensaje del chat interno',
      ...inherited,
    });

    if (!created.id) {
      return NextResponse.json({ error: 'No se pudo crear la tarea' }, { status: 409 });
    }

    // Confirmación en el mismo hilo: quien pasó por acá tiene que ver que la
    // conversación ya se convirtió en trabajo con dueño.
    await postSystemNote({
      tenantId: auth.tenantId,
      channelId: message.channelId,
      body: `Se creó la tarea "${title}".`,
      actions: [
        { id: 'open-task', label: 'Abrir tarea', tone: 'primary', href: '/dashboard/tasks' },
      ],
      contextType: 'TASK',
      contextId: created.id,
      contextPayload: { taskId: created.id, fromMessageId: message.id, title },
      dedupeKey: `msg-to-task:${message.id}`,
    });

    return NextResponse.json({ taskId: created.id }, { status: 201 });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
