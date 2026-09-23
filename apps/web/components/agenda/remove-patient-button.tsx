'use client';

import {
  type RemovalPreview,
  patientRemovalPreviewAction,
  removePatientAction,
} from '@/app/(dashboard)/dashboard/agenda/patient-removal-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * Quitar de la lista a alguien sin historia: un alta de prueba o un error.
 * Sólo se ofrece en filas sin citas ni notas y sólo a administradores; el
 * servidor vuelve a comprobarlo antes de borrar.
 */
export function RemovePatientButton({ patientKey, name }: { patientKey: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<RemovalPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function abrir() {
    setOpen(true);
    setPreview(null);
    setError(null);
    startTransition(async () => {
      const result = await patientRemovalPreviewAction(patientKey);
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    });
  }

  function quitar() {
    setError(null);
    startTransition(async () => {
      const result = await removePatientAction(patientKey);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={abrir}
        title="Quitar de la lista (sólo sin historia)"
        aria-label={`Quitar a ${name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quitar a {name}</DialogTitle>
            <DialogDescription>
              Se borra sin dejar rastro. Sólo se permite cuando no hay citas ni notas: con historia
              no se borra nada desde aquí.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 grid gap-2 text-[13px] text-zinc-700">
            {pending && !preview && (
              <span className="inline-flex items-center gap-2 text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Comprobando…
              </span>
            )}
            {preview && (
              <>
                <p>
                  {preview.kind === 'PATIENT' ? 'Paciente' : 'Contacto'} · {preview.appointments}{' '}
                  cita(s) · {preview.notes} nota(s)
                </p>
                {preview.warning && (
                  <p className="flex items-start gap-2 rounded-[14px] bg-amber-50 p-3 text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {preview.warning}
                  </p>
                )}
                {!preview.canDelete && (
                  <p className="text-zinc-500">Tiene historia: no se puede quitar.</p>
                )}
              </>
            )}
            {error && (
              <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={quitar}
              disabled={pending || !preview || !preview.canDelete}
            >
              {pending && preview ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Quitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
