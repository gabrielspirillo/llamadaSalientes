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
import { Input, Label } from '@/components/ui/input';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

const CONFIRM_WORD = 'BORRAR';

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Quitar a un paciente o contacto de la lista, tenga o no historia. Antes de
 * borrar enseña todo lo que se va con él; si hay historia (citas, notas,
 * cobros, consentimientos o mensajes) hay que escribir BORRAR. Sólo
 * administradores; el servidor lo vuelve a comprobar.
 */
export function RemovePatientButton({
  patientKey,
  name,
  label,
  redirectTo,
}: {
  patientKey: string;
  name: string;
  /** Con texto, el botón lo enseña (en la ficha); sin él, sólo el icono (en la lista). */
  label?: string;
  /** Adónde ir después de borrar (desde la ficha, a la lista). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<RemovalPreview | null>(null);
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function abrir() {
    setOpen(true);
    setPreview(null);
    setConfirm('');
    setError(null);
    startTransition(async () => {
      const result = await patientRemovalPreviewAction(patientKey);
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    });
  }

  const hasHistory =
    preview !== null &&
    preview.appointments + preview.notes + preview.charges + preview.consents + preview.messages >
      0;
  const canConfirm =
    preview !== null && (!hasHistory || confirm.trim().toUpperCase() === CONFIRM_WORD);

  function quitar() {
    setError(null);
    startTransition(async () => {
      const result = await removePatientAction(patientKey);
      if (result.ok) {
        setOpen(false);
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const losses = preview
    ? [
        preview.appointments > 0 &&
          `${plural(preview.appointments, 'cita', 'citas')}${
            preview.futureAppointments > 0
              ? ` (${plural(preview.futureAppointments, 'pendiente', 'pendientes')}: se cancelan sus recordatorios)`
              : ''
          }`,
        preview.notes > 0 && plural(preview.notes, 'nota clínica', 'notas clínicas'),
        preview.charges > 0 && plural(preview.charges, 'cobro', 'cobros'),
        preview.consents > 0 && plural(preview.consents, 'consentimiento', 'consentimientos'),
        preview.messages > 0 && `${plural(preview.messages, 'mensaje', 'mensajes')} de WhatsApp`,
      ].filter((s): s is string => Boolean(s))
    : [];

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={abrir}
        title="Quitar de la clínica"
        aria-label={`Quitar a ${name}`}
        className={label ? 'text-rose-700 hover:text-rose-800' : undefined}
      >
        <Trash2 className="h-4 w-4" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quitar a {preview?.name ?? name}</DialogTitle>
            <DialogDescription>Se borra de la clínica y no se puede deshacer.</DialogDescription>
          </DialogHeader>

          <div className="mt-3 grid gap-3 text-[14px] text-zinc-700">
            {pending && !preview && !error && (
              <span className="inline-flex items-center gap-2 text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Comprobando qué tiene…
              </span>
            )}
            {preview && !hasHistory && (
              <p>No tiene citas, notas ni mensajes. Se borra sin dejar rastro.</p>
            )}
            {preview && hasHistory && (
              <>
                <div className="rounded-[14px] bg-rose-50 p-3 text-rose-800">
                  <p className="flex items-start gap-2 font-semibold">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> También se borra:
                  </p>
                  <ul className="mt-1.5 list-disc pl-9">
                    {losses.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
                {preview.invoices > 0 && (
                  <p className="text-[13px] text-zinc-600">
                    {plural(
                      preview.invoices,
                      'factura emitida se conserva',
                      'facturas emitidas se conservan',
                    )}{' '}
                    en Finanzas: son documentos legales y no se borran.
                  </p>
                )}
                <p className="text-[13px] text-zinc-600">
                  Si es la misma persona que otra ficha, usa <strong>Unir</strong> en vez de quitar:
                  así no se pierde la historia.
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor={`confirm-${patientKey}`}>
                    Escribe <strong>{CONFIRM_WORD}</strong> para confirmar
                  </Label>
                  <Input
                    id={`confirm-${patientKey}`}
                    value={confirm}
                    autoComplete="off"
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={pending}
                  />
                </div>
              </>
            )}
            {error && (
              <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={quitar} disabled={pending || !canConfirm}>
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
