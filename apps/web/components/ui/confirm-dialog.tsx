'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { AlertTriangle, Loader2 } from 'lucide-react';
import * as React from 'react';

/**
 * Confirmación con el estilo del panel, en lugar de `window.confirm` /
 * `window.prompt` (que el navegador pinta con su propia caja, fuera del
 * diseño). Controlado: quien lo usa decide cuándo se abre.
 *
 * Con `reason`, pide un motivo en un campo de texto (obligatorio si
 * `reason.required`). `onConfirm` recibe ese motivo; si devuelve una promesa,
 * el botón muestra que está trabajando y el diálogo se cierra al terminar,
 * salvo que devuelva un mensaje de error, que se enseña dentro.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'danger',
  reason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Puntos que se enseñan en una caja: qué pasa exactamente al confirmar. */
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  reason?: { label: string; placeholder?: string; required?: boolean };
  onConfirm: (reason: string) => string | null | undefined | Promise<string | null | undefined>;
}) {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const fieldId = React.useId();

  React.useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function confirm() {
    if (reason?.required && text.trim().length < 3) {
      setError('Escribe el motivo (al menos 3 letras).');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await onConfirm(text.trim());
      if (typeof result === 'string' && result) {
        setError(result);
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader className="mb-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-700',
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 pt-0.5">
              <DialogTitle className="text-[18px]">{title}</DialogTitle>
              {description && <DialogDescription className="mt-1">{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>

        {details && details.length > 0 && (
          <ul className="mb-4 space-y-1.5 rounded-[14px] bg-zinc-50 p-3.5 text-[13px] leading-relaxed text-zinc-700">
            {details.map((d) => (
              <li key={d} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400"
                />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )}

        {reason && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>
              {reason.label}
              {!reason.required && <span className="font-normal text-zinc-500"> (opcional)</span>}
            </Label>
            <Textarea
              id={fieldId}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
              placeholder={reason.placeholder}
              className="min-h-[88px] placeholder:text-zinc-400/80"
              maxLength={300}
              autoFocus
              aria-invalid={Boolean(error)}
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 text-[13px] font-medium text-rose-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={confirm}
            disabled={pending}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
