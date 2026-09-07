'use client';

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
import { Input, Label } from '@/components/ui/input';
import {
  ALLOWED_LOGO_LABEL,
  ALLOWED_LOGO_MIMES,
  LOGO_ACCEPT,
  MAX_LOGO_BYTES,
  normalizeMime,
} from '@/lib/branding';
import { ImageOff, Loader2, Palette, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { removeClinicLogoAction, renameClinicAction } from './actions';

/**
 * Marca de una clínica: nombre + logo. Sólo lo ve y lo usa Futura.
 *
 * El logo va por `fetch` a su endpoint (es un archivo, no cabe en una Server
 * Action cómodamente) y el nombre por Server Action. Se hacen en ese orden y
 * sólo lo que cambió: si únicamente se tocó el nombre no se sube nada, y si
 * únicamente se cambió el logo no se renombra la organización en Clerk.
 */
export function BrandingDialog({
  tenantId,
  name,
  logoUrl,
}: {
  tenantId: string;
  name: string;
  logoUrl: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Palette className="h-4 w-4" />
          Marca
        </Button>
      </DialogTrigger>
      <DialogContent>
        {/* Remontar el formulario al abrir descarta el borrador de la vez
            anterior: si alguien eligió un logo y cerró sin guardar, no debe
            seguir ahí la próxima vez que abra. */}
        {open && (
          <BrandingForm
            key={`${tenantId}:${name}:${logoUrl ?? ''}`}
            tenantId={tenantId}
            name={name}
            logoUrl={logoUrl}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type LogoDraft =
  /** No se tocó el logo. */
  | { kind: 'keep' }
  /** Se eligió un archivo nuevo, todavía sin subir. */
  | { kind: 'file'; file: File; preview: string }
  /** Se pidió quitar el logo y volver a la marca FUTURA. */
  | { kind: 'remove' };

function BrandingForm({
  tenantId,
  name,
  logoUrl,
  onDone,
}: {
  tenantId: string;
  name: string;
  logoUrl: string | null;
  onDone: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [logo, setLogo] = useState<LogoDraft>({ kind: 'keep' });
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // La preview es un object URL: si no se revoca, cada archivo elegido deja un
  // blob retenido en memoria mientras viva la pestaña.
  useEffect(() => {
    if (logo.kind !== 'file') return;
    const url = logo.preview;
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const trimmedName = draftName.trim().replace(/\s+/g, ' ');
  const nameChanged = trimmedName !== name;
  const logoChanged = logo.kind !== 'keep';
  const nothingToDo = !nameChanged && !logoChanged;

  function pickFile(file: File | null) {
    setError(null);
    if (!file) return;
    // Se comprueba acá para avisar al instante; el servidor lo vuelve a
    // comprobar, que es donde manda.
    if (!ALLOWED_LOGO_MIMES.has(normalizeMime(file.type))) {
      setError(`Formato no permitido. Usa ${ALLOWED_LOGO_LABEL}.`);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(
        `El logo es demasiado grande. Máximo ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB.`,
      );
      return;
    }
    setLogo({ kind: 'file', file, preview: URL.createObjectURL(file) });
  }

  function save() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      // 1) El logo primero: es lo que puede fallar por red o almacenamiento.
      if (logo.kind === 'file') {
        const body = new FormData();
        body.set('tenantId', tenantId);
        body.set('file', logo.file);
        let res: Response;
        try {
          res = await fetch('/api/futura/branding/logo', { method: 'POST', body });
        } catch {
          setError('No se pudo contactar con el servidor. Revisa la conexión.');
          return;
        }
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          setError(detail?.error ?? 'No se pudo subir el logo.');
          return;
        }
      } else if (logo.kind === 'remove') {
        const r = await removeClinicLogoAction(tenantId);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }

      // 2) El nombre, sólo si cambió.
      if (nameChanged) {
        const r = await renameClinicAction(tenantId, draftName);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        if (r.warning) {
          // El cambio se guardó: se avisa y no se cierra, para que se lea.
          setWarning(r.warning);
          return;
        }
      }

      // El endpoint del logo no revalida nada (no es una Server Action), así
      // que el refresco lo pide el cliente. Las acciones sí revalidan, pero
      // pedirlo dos veces no cuesta nada y cubre los dos caminos.
      router.refresh();
      onDone();
    });
  }

  const shownLogo = logo.kind === 'file' ? logo.preview : logo.kind === 'remove' ? null : logoUrl;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Marca de la clínica</DialogTitle>
        <DialogDescription>
          El nombre y el logo con los que esta clínica ve la plataforma. Si no tiene logo propio,
          verá la marca FUTURA.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor={`branding-name-${tenantId}`}>Nombre</Label>
          <Input
            id={`branding-name-${tenantId}`}
            value={draftName}
            maxLength={80}
            disabled={pending}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Clínica Dental Ejemplo"
          />
          <p className="text-[12px] text-zinc-500">
            Se actualiza también en Clerk, que es de donde sale el selector de organizaciones.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[--color-border] bg-white">
              {shownLogo ? (
                // <img> a pelo: el logo vive en un bucket cuyo dominio es
                // configurable por entorno, y next/image exige declarar cada
                // host en next.config. No merece un despliegue por cliente.
                <img src={shownLogo} alt="" className="h-full w-full object-contain p-1.5" />
              ) : (
                <ImageOff className="h-5 w-5 text-zinc-300" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <input
                ref={fileRef}
                type="file"
                accept={LOGO_ACCEPT}
                className="sr-only"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  Elegir archivo
                </Button>
                {shownLogo && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (fileRef.current) fileRef.current.value = '';
                      setLogo({ kind: 'remove' });
                    }}
                  >
                    Quitar
                  </Button>
                )}
              </div>
              <p className="text-[12px] text-zinc-500">
                {ALLOWED_LOGO_LABEL}, hasta {Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB. Se ve
                mejor con fondo transparente.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-[13px] font-medium text-rose-600">
            {error}
          </p>
        )}
        {warning && (
          <p role="alert" className="text-[13px] font-medium text-amber-700">
            {warning}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDone}>
          Cancelar
        </Button>
        <Button type="button" size="sm" disabled={pending || nothingToDo} onClick={save}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </>
  );
}
