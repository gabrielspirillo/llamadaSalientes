'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { AlertTriangle, Archive, ArchiveRestore, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { archiveClinicAction, deleteClinicAction, restoreClinicAction } from './actions';

/** Archivar: reversible. Se confirma en un diálogo que dice qué deja de pasar. */
export function ArchiveClinicButton({ tenantId, name }: { tenantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4" /> Archivar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archivar {name}</DialogTitle>
            <DialogDescription>
              No se borra nada y se puede restaurar cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-[14px] text-zinc-600">
            <li>· Nadie de la clínica podrá entrar al panel.</li>
            <li>· El asistente de WhatsApp deja de contestar.</li>
            <li>· Se cancelan los recordatorios y las ofertas de huecos pendientes.</li>
            <li>· No corren sus rutinas ni sus avisos automáticos.</li>
          </ul>
          <p className="rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-800">
            Las llamadas de voz las atiende Retell con su propio número: si la clínica tiene uno,
            desvíalo o apágalo allí.
          </p>
          {error && <p className="text-[13px] text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await archiveClinicAction(tenantId);
                  if (r.ok) {
                    setOpen(false);
                    router.refresh();
                  } else setError(r.error);
                })
              }
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              Archivar clínica
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RestoreClinicButton({ tenantId }: { tenantId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await restoreClinicAction(tenantId);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArchiveRestore className="h-4 w-4" />
        )}
        Restaurar
      </Button>
      {error && <span className="text-[12px] text-rose-600">{error}</span>}
    </div>
  );
}

/** Eliminar: para siempre. Pide escribir el nombre exacto (se comprueba en el servidor). */
export function DeleteClinicButton({ tenantId, name }: { tenantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const router = useRouter();
  const matches = typed.trim() === name.trim();
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-rose-600"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" /> Eliminar
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setTyped('');
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar {name} para siempre</DialogTitle>
            <DialogDescription>Esto no se puede deshacer.</DialogDescription>
          </DialogHeader>
          <p className="flex gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Se borran sus pacientes, citas, historias clínicas, consentimientos, facturas,
            conversaciones, tareas y su organización con todos sus usuarios.
          </p>
          {warning ? (
            <>
              <p className="rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-800">{warning}</p>
              <div className="flex justify-end">
                <Button onClick={() => setOpen(false)}>Entendido</Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor={`del-${tenantId}`}>
                  Escribe <strong>{name}</strong> para confirmar
                </Label>
                <Input
                  id={`del-${tenantId}`}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="mt-1.5"
                />
              </div>
              {error && <p className="text-[13px] text-rose-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  disabled={pending || !matches}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await deleteClinicAction(tenantId, typed);
                      if (!r.ok) {
                        setError(r.error);
                        return;
                      }
                      router.refresh();
                      if (r.warning) setWarning(r.warning);
                      else setOpen(false);
                    })
                  }
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Eliminar para siempre
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
