'use client';

import {
  deleteLessonAction,
  toggleLessonAction,
} from '@/app/(dashboard)/dashboard/entrenamiento/actions';
import { Button } from '@/components/ui/button';
import type { LessonStatus } from '@/lib/agent-training/model';
import { Loader2, Pause, Play, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

/** Pausar y borrar. El borrado pide confirmación porque no se deshace. */
export function LessonActions({ id, status }: { id: string; status: LessonStatus }) {
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {error && <span className="mr-1 text-[12px] text-rose-600">{error}</span>}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await toggleLessonAction(id);
            if (!r.ok) setError(r.error);
          })
        }
        title={status === 'ACTIVE' ? 'Pausar: el asistente deja de tenerlo en cuenta' : 'Reactivar'}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : status === 'ACTIVE' ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">{status === 'ACTIVE' ? 'Pausar' : 'Reactivar'}</span>
      </Button>
      {confirmando ? (
        <>
          <Button
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await deleteLessonAction(id);
                if (!r.ok) {
                  setError(r.error);
                  setConfirmando(false);
                }
              })
            }
          >
            Confirmar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)}>
            No
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmando(true)}
          title="Borrar"
          aria-label="Borrar enseñanza"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
