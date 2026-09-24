'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { checkWhatsappLink, requestWhatsappQr } from '../connect-actions';

/**
 * Alta de WhatsApp desde la propia bandeja, para el dueño o el administrador
 * de la clínica: un botón, el código y dónde escanearlo. Nada del proveedor
 * que hay detrás — quien lo usa no tiene por qué saber qué servidor emite ese
 * código, y el detalle técnico sigue estando en la pantalla de Futura.
 */
export function ConnectWhatsappButton({
  size = 'sm',
  variant = 'primary',
  label = 'Conectar WhatsApp',
}: {
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <QrCode className="h-4 w-4" /> {label}
      </Button>
      <ConnectWhatsappDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

const STEPS = [
  'Abre WhatsApp en el móvil de la clínica.',
  'Toca los tres puntos (Android) o Ajustes (iPhone).',
  'Entra en «Dispositivos vinculados».',
  'Pulsa «Vincular un dispositivo» y apunta la cámara a este código.',
];

function ConnectWhatsappDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [qr, setQr] = React.useState<string | null>(null);
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await requestWhatsappQr();
    setLoading(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setQr(res.data.qrBase64);
    setPairingCode(res.data.pairingCode);
    setConnected(res.data.connected);
  }, []);

  // El código se pide al abrir, no al montar: así no gastamos una sesión del
  // proveedor cada vez que alguien entra a la bandeja.
  React.useEffect(() => {
    if (!open) return;
    setQr(null);
    setPairingCode(null);
    setConnected(false);
    void load();
  }, [open, load]);

  // Mientras el código está en pantalla nadie va a pulsar "comprobar": el
  // móvil escanea y esto tiene que darse cuenta solo.
  React.useEffect(() => {
    if (!open || connected || (!qr && !pairingCode)) return;
    const id = setInterval(async () => {
      const res = await checkWhatsappLink();
      if (res.success && res.data.connected) {
        setConnected(true);
        setQr(null);
        setPairingCode(null);
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(id);
  }, [open, connected, qr, pairingCode, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v && connected) router.refresh();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
          <DialogDescription>
            Vincula el WhatsApp de la clínica para que tu asistente pueda atender los mensajes.
          </DialogDescription>
        </DialogHeader>

        {connected ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-[15px] font-semibold text-zinc-900">WhatsApp conectado</p>
            <p className="text-sm text-zinc-500">
              Ya puedes recibir y responder mensajes desde esta bandeja.
            </p>
            <Button className="mt-2" size="sm" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <ol className="space-y-2">
              {STEPS.map((step, i) => (
                <li key={step} className="flex gap-2.5 text-sm text-zinc-600">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-700">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <div className="flex min-h-[248px] flex-col items-center justify-center rounded-[18px] border border-(--color-border) bg-(--color-canvas) p-4 text-center">
              {loading && !qr ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                  <p className="mt-2 text-sm text-zinc-500">Generando el código…</p>
                </>
              ) : qr ? (
                <Image
                  src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                  alt="Código para vincular WhatsApp"
                  width={224}
                  height={224}
                  className="rounded-xl bg-white p-2"
                  unoptimized
                />
              ) : pairingCode ? (
                <div className="space-y-1">
                  <Smartphone className="mx-auto h-6 w-6 text-zinc-400" />
                  <p className="text-sm text-zinc-500">Introduce este código en tu WhatsApp:</p>
                  <code className="text-xl font-bold tracking-[0.2em] text-zinc-900">
                    {pairingCode}
                  </code>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  {error ?? 'Pulsa «Generar otro código» para empezar.'}
                </p>
              )}
            </div>

            {qr && pairingCode && (
              <p className="text-center text-[13px] text-zinc-500">
                ¿No puedes escanear? Introduce este código en tu WhatsApp:{' '}
                <code className="font-mono font-semibold text-zinc-800">{pairingCode}</code>
              </p>
            )}

            {error && qr && <p className="text-center text-[13px] text-rose-600">{error}</p>}

            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-zinc-400">
                El código caduca al minuto. Si caduca, genera otro.
              </p>
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Generar otro código
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
