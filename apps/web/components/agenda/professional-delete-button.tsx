'use client';

import {
  deactivateProfessionalAction,
  deleteProfessionalAction,
  professionalDeletionPreviewAction,
  reactivateProfessionalAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button, IconButton } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2, Trash2, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

interface Preview {
  fullName: string;
  appointments: number;
  notes: number;
  canDelete: boolean;
}

/**
 * Quitar a un profesional de la clínica.
 *
 * Son dos cosas distintas y el diálogo lo dice antes de que nadie pulse nada:
 *   - Sin historia (un alta equivocada) → se borra y no queda rastro.
 *   - Con citas o notas → se da de BAJA. Desaparece de la agenda y de lo que
 *     ofrecen los agentes, pero su historia clínica sigue en la ficha de cada
 *     paciente, que es de la clínica y del paciente, no del profesional.
 */
export function DeleteProfessionalButton({
  professionalId,
  fullName,
  active,
}: {
  professionalId: string;
  fullName: string;
  active: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function abrir() {
    setOpen(true);
    setPreview(null);
    setError(null);
    startTransition(async () => {
      const result = await professionalDeletionPreviewAction(professionalId);
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    });
  }

  function ejecutar(accion: 'borrar' | 'baja') {
    setError(null);
    startTransition(async () => {
      const result =
        accion === 'borrar'
          ? await deleteProfessionalAction(professionalId)
          : await deactivateProfessionalAction(professionalId);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function reactivar() {
    setError(null);
    startTransition(async () => {
      const result = await reactivateProfessionalAction(professionalId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  if (!active) {
    return (
      <Button variant="ghost" size="sm" onClick={reactivar} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
        Reactivar
      </Button>
    );
  }

  return (
    <>
      <IconButton label={`Quitar a ${fullName}`} onClick={abrir}>
        <Trash2 className="h-4 w-4" />
      </IconButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quitar a {fullName}</DialogTitle>
            <DialogDescription>
              {preview === null
                ? 'Mirando qué tiene en la clínica…'
                : preview.canDelete
                  ? 'No tiene ninguna cita ni nota clínica: se puede borrar sin dejar rastro.'
                  : 'Tiene historia en la clínica, así que no se borra.'}
            </DialogDescription>
          </DialogHeader>

          {preview && !preview.canDelete && (
            <div className="mt-3 rounded-[14px] bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900">
              <p>
                {preview.appointments > 0 && <>{preview.appointments} cita(s)</>}
                {preview.appointments > 0 && preview.notes > 0 && ' y '}
                {preview.notes > 0 && <>{preview.notes} nota(s) clínica(s)</>}
                {' registradas.'}
              </p>
              <p className="mt-1.5">
                Al darle de baja deja de aparecer en el calendario y los agentes dejan de ofrecerlo,
                pero su historia clínica se conserva en la ficha de cada paciente.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          <DialogFooter className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            {preview?.canDelete ? (
              <Button variant="danger" onClick={() => ejecutar('borrar')} disabled={pending}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Eliminar
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() => ejecutar('baja')}
                disabled={pending || preview === null}
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Dar de baja
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
