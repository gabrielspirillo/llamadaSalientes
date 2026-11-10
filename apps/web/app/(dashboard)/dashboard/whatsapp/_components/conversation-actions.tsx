'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { CheckCircle2, Flag, Hand, Trash2 } from 'lucide-react';

import {
  closeConversation,
  deleteConversation,
  takeoverConversation,
  toggleUrgent,
} from '../actions';

interface Props {
  conversationId: string;
  status: 'ACTIVE' | 'HANDOFF' | 'CLOSED';
  urgentFlag: boolean;
  /**
   * En móvil la cabecera sólo lleva lo del día a día (atender y cerrar);
   * urgente y eliminar pasan a la hoja de datos del contacto, con su texto.
   */
  only?: 'primary' | 'secondary';
}

export function ConversationActions({ conversationId, status, urgentFlag, only }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<unknown>) => () => startTransition(async () => void (await fn()));

  const onDelete = () =>
    startTransition(async () => {
      if (
        !window.confirm('¿Eliminar esta conversación y todos sus mensajes? No se puede deshacer.')
      )
        return;
      const res = (await deleteConversation({ conversationId })) as {
        success: boolean;
        error?: string;
      };
      if (!res?.success) {
        window.alert(res?.error ?? 'No se pudo eliminar la conversación.');
        return;
      }
      router.push('/dashboard/whatsapp');
      router.refresh();
    });

  // Una sola acción destacada (atender). Urgente y eliminar son iconos: con
  // cuatro botones de colores la cabecera saltaba a dos líneas y cortaba el
  // nombre del paciente.
  if (only === 'secondary') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={urgentFlag ? 'danger' : 'secondary'}
          onClick={run(() => toggleUrgent({ conversationId }))}
          disabled={pending}
        >
          <Flag className="h-4 w-4" fill={urgentFlag ? 'currentColor' : 'none'} />
          {urgentFlag ? 'Quitar urgente' : 'Marcar urgente'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={pending}>
          <Trash2 className="h-4 w-4" /> Eliminar conversación
        </Button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {only !== 'primary' && (
        <IconButton
          label={urgentFlag ? 'Quitar urgente' : 'Marcar urgente'}
          onClick={run(() => toggleUrgent({ conversationId }))}
          disabled={pending}
          className={
            urgentFlag ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700' : ''
          }
        >
          <Flag className="h-4 w-4" fill={urgentFlag ? 'currentColor' : 'none'} />
        </IconButton>
      )}

      {status !== 'HANDOFF' && status !== 'CLOSED' && (
        <Button
          size="sm"
          variant="soft"
          onClick={run(() => takeoverConversation({ conversationId, hours: 2 }))}
          disabled={pending}
          title="Pausa al asistente 2 horas y contestas tú"
        >
          <Hand className="h-4 w-4" />
          <span className="hidden sm:inline">Atender yo</span>
        </Button>
      )}

      {status !== 'CLOSED' && (
        <Button
          size="sm"
          variant="secondary"
          onClick={run(() => closeConversation({ conversationId }))}
          disabled={pending}
          title="Cerrar la conversación"
        >
          <CheckCircle2 className="h-4 w-4" />
          <span className="hidden sm:inline">Cerrar</span>
        </Button>
      )}

      {only !== 'primary' && (
        <IconButton
          label="Eliminar conversación"
          onClick={onDelete}
          disabled={pending}
          className="hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
}
