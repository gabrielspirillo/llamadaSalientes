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
import { AlertTriangle, Check, FileSignature, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveEsignIntegrationAction } from './actions';

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * La instancia de Documenso de una clínica. Sólo lo ve Futura.
 *
 * Tres datos: la URL, el token de API (se crea en Documenso → Ajustes → API
 * Tokens) y el secreto del webhook, que se genera aquí y se pega en Documenso
 * → Ajustes → Webhooks junto con la URL que se muestra. Al guardar se prueba
 * la conexión: un token mal copiado se ve ahora, no cuando Raquel pulse
 * "Enviar consentimiento".
 */
export function EsignDialog({
  tenantId,
  configured,
  baseUrl,
  webhookUrl,
}: {
  tenantId: string;
  configured: boolean;
  baseUrl: string | null;
  webhookUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [url, setUrl] = useState(baseUrl ?? '');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveEsignIntegrationAction(tenantId, {
        baseUrl: url,
        apiToken: token,
        webhookSecret: secret,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <FileSignature className="h-4 w-4" /> {configured ? 'Firma digital' : 'Firma digital'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Firma digital (Documenso)</DialogTitle>
          <DialogDescription>
            {configured
              ? 'Configurada. Guardar aquí reemplaza el token y el secreto.'
              : 'La instancia de Documenso de esta clínica. Con esto, la ficha del paciente gana el botón "Enviar consentimiento".'}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="es-url">URL de Documenso</Label>
            <Input
              id="es-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://consentimiento.respinens.es"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="es-token">Token de API</Label>
            <Input
              id="es-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="api_…"
              autoComplete="off"
            />
            <p className="text-[12px] text-zinc-500">
              En Documenso: Ajustes → API Tokens → crear uno sin caducidad.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="es-secret">Secreto del webhook</Label>
            <div className="flex gap-2">
              <Input
                id="es-secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
              />
              <Button type="button" variant="secondary" onClick={() => setSecret(randomSecret())}>
                <RefreshCw className="h-4 w-4" /> Generar
              </Button>
            </div>
            <p className="text-[12px] text-zinc-500">
              En Documenso: Ajustes → Webhooks → nuevo, con el evento{' '}
              <span className="font-mono">DOCUMENT_COMPLETED</span>, este secreto y esta URL:
            </p>
            <Input readOnly value={webhookUrl} className="font-mono text-[12px]" />
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
          {saved && (
            <p className="flex items-start gap-2 rounded-[14px] bg-emerald-50 p-3 text-[13px] text-emerald-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0" /> Guardado y conexión comprobada.
            </p>
          )}
        </div>

        <DialogFooter className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cerrar
          </Button>
          <Button
            onClick={submit}
            disabled={pending || !url.trim() || !token.trim() || !secret.trim()}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Probar y guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
