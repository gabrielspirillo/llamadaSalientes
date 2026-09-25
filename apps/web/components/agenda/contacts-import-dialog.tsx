'use client';

import {
  importContactsBatchAction,
  previewContactsImportAction,
} from '@/app/(dashboard)/dashboard/agenda/pacientes/import-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ImportPreview } from '@/lib/patients/import-service';
import { AlertTriangle, Check, CircleHelp, Flag, Loader2, ShieldAlert, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

type Step =
  | { kind: 'pick' }
  | { kind: 'preview'; data: ImportPreview }
  | { kind: 'running'; done: number; total: number; created: number }
  | {
      kind: 'done';
      created: number;
      skippedExisting: number;
      errors: { row: number; child: string; error: string }[];
    };

/**
 * Importar el CSV de Google Contactos: se elige el archivo, el servidor lo lee
 * y enseña qué va a crear (sin escribir nada), y al confirmar lo da de alta por
 * lotes. El navegador sólo guarda el texto del archivo; los registros los
 * interpreta siempre el servidor.
 */
export function ContactsImportDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [step, setStep] = React.useState<Step>({ kind: 'pick' });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const inputId = React.useId();

  function reset() {
    setCsv(null);
    setFileName('');
    setStep({ kind: 'pick' });
    setError(null);
    setPending(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPending(true);
    try {
      const text = await file.text();
      const res = await previewContactsImportAction(text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCsv(text);
      setFileName(file.name);
      setStep({ kind: 'preview', data: res.data });
    } catch {
      setError('No se pudo leer el archivo.');
    } finally {
      setPending(false);
    }
  }

  async function runImport(total: number) {
    if (!csv) return;
    setError(null);
    let offset: number | null = 0;
    let created = 0;
    let skippedExisting = 0;
    const errors: { row: number; child: string; error: string }[] = [];
    setStep({ kind: 'running', done: 0, total, created: 0 });
    while (offset !== null) {
      const res = await importContactsBatchAction(csv, offset);
      if (!res.ok) {
        // Lo ya creado se queda: volver a importar el mismo archivo se lo salta.
        setError(`${res.error} Lo importado hasta aquí se conserva; puedes volver a intentarlo.`);
        setStep({ kind: 'done', created, skippedExisting, errors });
        router.refresh();
        return;
      }
      created += res.data.created;
      skippedExisting += res.data.skippedExisting;
      errors.push(...res.data.errors);
      offset = res.data.nextOffset;
      const done = offset ?? res.data.total;
      setStep({ kind: 'running', done, total: res.data.total, created });
    }
    setStep({ kind: 'done', created, skippedExisting, errors });
    router.refresh();
  }

  const running = step.kind === 'running';

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (running) return; // No se cierra a mitad de un alta.
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Upload className="h-4 w-4" /> Importar contactos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar contactos de Google</DialogTitle>
          <DialogDescription>
            Crea una ficha por cada niño a partir del CSV de Google Contactos. Lee los nombres como
            los escribís: «Mamá Lucas Pérez (Ana)».
          </DialogDescription>
        </DialogHeader>

        {step.kind === 'pick' && (
          <div className="mt-4 grid gap-3">
            <label
              htmlFor={inputId}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-(--color-border) bg-(--color-canvas) px-4 py-8 text-center hover:border-brand-300"
            >
              {pending ? (
                <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
              ) : (
                <Upload className="h-6 w-6 text-brand-600" />
              )}
              <span className="text-[14px] font-semibold text-zinc-800">
                {pending ? 'Leyendo el archivo…' : 'Elegir el archivo .csv'}
              </span>
              <span className="text-[12px] text-zinc-600">
                contacts.google.com → Exportar → «CSV de Google». Todavía no se guarda nada.
              </span>
            </label>
            <input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={pending}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <ul className="grid gap-1 text-[12px] text-zinc-600">
              <li className="flex items-center gap-1.5">
                <CircleHelp className="h-3.5 w-3.5 text-sky-600" /> 🤔 en el nombre → familia que
                duda
              </li>
              <li className="flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5 fill-rose-600 text-rose-600" /> cada 🚩 → una bandera
                roja anterior
              </li>
              <li className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /> 😡 o «NO DAR» → no dar cita
                (los asistentes no reservan)
              </li>
              <li>
                El resto de emojis se ignora; el nombre original queda en la nota de cada paciente.
              </li>
            </ul>
          </div>
        )}

        {step.kind === 'preview' && <PreviewView data={step.data} fileName={fileName} />}

        {step.kind === 'running' && (
          <div className="mt-6 grid gap-3">
            <p className="flex items-center gap-2 text-[14px] font-semibold text-zinc-800">
              <Loader2 className="h-4 w-4 animate-spin" /> Creando fichas… {step.done} de{' '}
              {step.total}
            </p>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
                style={{ width: `${Math.round((step.done / Math.max(1, step.total)) * 100)}%` }}
              />
            </div>
            <p className="text-[12px] text-zinc-600">No cierres esta ventana hasta que termine.</p>
          </div>
        )}

        {step.kind === 'done' && (
          <div className="mt-4 grid gap-3">
            <p className="flex items-center gap-2 text-[15px] font-bold text-emerald-700">
              <Check className="h-5 w-5" /> {step.created}{' '}
              {step.created === 1 ? 'paciente creado' : 'pacientes creados'}
            </p>
            {step.skippedExisting > 0 && (
              <p className="text-[13px] text-zinc-600">
                {step.skippedExisting} ya estaban dados de alta y no se tocaron.
              </p>
            )}
            {step.errors.length > 0 && (
              <details className="rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-900">
                <summary className="cursor-pointer font-semibold">
                  {step.errors.length} no se pudieron crear
                </summary>
                <ul className="mt-2 grid gap-1">
                  {step.errors.slice(0, 100).map((e) => (
                    <li key={`${e.row}-${e.child}`}>
                      Fila {e.row} · {e.child}: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <DialogFooter className="mt-5">
          {step.kind === 'preview' && (
            <>
              <Button variant="ghost" onClick={reset}>
                Elegir otro archivo
              </Button>
              <Button
                disabled={step.data.toCreate === 0}
                onClick={() => runImport(step.data.children)}
              >
                <Upload className="h-4 w-4" /> Importar {step.data.toCreate}{' '}
                {step.data.toCreate === 1 ? 'paciente' : 'pacientes'}
              </Button>
            </>
          )}
          {step.kind === 'done' && (
            <Button
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewView({ data, fileName }: { data: ImportPreview; fileName: string }) {
  const stats: { label: string; value: number; tone?: 'danger' | 'info' | 'warn' }[] = [
    { label: 'Fichas nuevas', value: data.toCreate },
    { label: 'Ya estaban', value: data.alreadyThere },
    { label: 'Dudan', value: data.hesitant, tone: 'info' },
    { label: 'Con banderas', value: data.withRedFlags, tone: 'danger' },
    { label: 'No dar cita', value: data.noBooking, tone: 'warn' },
  ];
  return (
    <div className="mt-4 grid gap-4">
      <p className="text-[13px] text-zinc-600">
        <span className="font-semibold text-zinc-800">{fileName}</span>: {data.totalRows} contactos
        → {data.children} niños ({data.skipped.length} filas no son familias).
        {data.withoutPhone > 0 && ` ${data.withoutPhone} sin teléfono válido.`}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[14px] border border-(--color-border) px-3 py-2">
            <p className="text-[11px] font-semibold text-zinc-600">{s.label}</p>
            <p className="text-[20px] font-extrabold text-zinc-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
          Así se leyó (muestra)
        </p>
        <div className="max-h-72 overflow-auto rounded-[14px] border border-(--color-border)">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-2.5 py-1.5 font-semibold">Niño</th>
                <th className="px-2.5 py-1.5 font-semibold">Tutor</th>
                <th className="px-2.5 py-1.5 font-semibold">Teléfono</th>
                <th className="px-2.5 py-1.5 font-semibold">Marcas</th>
              </tr>
            </thead>
            <tbody>
              {data.sample.map((r) => (
                <tr key={`${r.row}-${r.child}`} className="border-t border-(--color-border-subtle)">
                  <td className="px-2.5 py-1.5 font-semibold text-zinc-900">
                    {r.child}
                    {r.exists && (
                      <Badge size="sm" className="ml-1.5">
                        ya está
                      </Badge>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-zinc-700">{r.guardian || '—'}</td>
                  <td className="px-2.5 py-1.5 text-zinc-700">{r.phone ?? '—'}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="inline-flex flex-wrap gap-1">
                      {r.priorRedFlags > 0 && (
                        <Badge tone="danger" size="sm">
                          <Flag className="h-3 w-3 fill-current" /> {r.priorRedFlags}
                        </Badge>
                      )}
                      {r.hesitant && (
                        <Badge tone="info" size="sm">
                          Duda
                        </Badge>
                      )}
                      {r.noBooking && (
                        <Badge tone="warn" size="sm">
                          No dar cita
                        </Badge>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.skipped.length > 0 && (
        <details className="rounded-[14px] bg-zinc-50 p-3 text-[12px] text-zinc-700">
          <summary className="cursor-pointer font-semibold">
            {data.skipped.length} filas que no se importan (proveedores, consultas sin niño…)
          </summary>
          <ul className="mt-2 grid max-h-48 gap-0.5 overflow-auto">
            {data.skipped.map((s) => (
              <li key={s.row}>
                Fila {s.row} · {s.name} — {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
