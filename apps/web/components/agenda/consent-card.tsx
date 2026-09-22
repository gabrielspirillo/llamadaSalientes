'use client';

import { sendConsentAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Label } from '@/components/ui/input';
import { AlertTriangle, Check, Copy, FileSignature, Loader2, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface ConsentListItem {
  id: string;
  status: 'SENT' | 'SIGNED' | 'CANCELLED' | 'ERROR';
  recipientName: string;
  recipientPhone: string;
  sentAt: string | null;
  signedAt: string | null;
  signingUrl: string | null;
  hasPdf: boolean;
  error: string | null;
}

const STATUS_LABEL: Record<ConsentListItem['status'], string> = {
  SENT: 'Pendiente de firma',
  SIGNED: 'Firmado',
  CANCELLED: 'Cancelado',
  ERROR: 'Error',
};

const STATUS_TONE: Record<ConsentListItem['status'], 'warn' | 'success' | 'neutral' | 'danger'> = {
  SENT: 'warn',
  SIGNED: 'success',
  CANCELLED: 'neutral',
  ERROR: 'danger',
};

/**
 * El consentimiento informado del paciente: los ya mandados, con su estado, y
 * el botón que lo manda con un clic al WhatsApp del tutor.
 *
 * Sólo se pinta en las clínicas con firma digital configurada. El PDF firmado
 * se abre por una ruta que firma la URL en cada lectura.
 */
export function ConsentCard({
  patientId,
  patientName,
  consents,
  defaults,
  canWrite,
}: {
  patientId: string;
  patientName: string;
  consents: ConsentListItem[];
  defaults: { name: string; phone: string; email: string };
  canWrite: boolean;
}) {
  const fmt = React.useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    [],
  );
  const pending = consents.find((c) => c.status === 'SENT');
  const signed = consents.find((c) => c.status === 'SIGNED');

  return (
    <Card>
      <CardTopbar
        icon={<FileSignature className="h-4 w-4" />}
        title="Consentimiento informado"
        subtitle={
          signed
            ? `Firmado el ${signed.signedAt ? fmt.format(new Date(signed.signedAt)) : '—'}`
            : pending
              ? 'Enviado, pendiente de firma'
              : 'Todavía no se ha enviado'
        }
        tone="sky"
        action={
          canWrite ? (
            <SendConsentDialog
              patientId={patientId}
              patientName={patientName}
              defaults={defaults}
            />
          ) : undefined
        }
      />
      <CardContent>
        {consents.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="h-5 w-5" />}
            title="Sin consentimiento"
            description="Con un clic se manda al WhatsApp del tutor, que lo lee y lo firma desde el móvil."
          />
        ) : (
          <ul className="space-y-2.5">
            {consents.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[--color-border] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-zinc-800">
                    {c.recipientName} · {c.recipientPhone}
                  </p>
                  <p className="text-[12px] text-zinc-500">
                    {c.status === 'SIGNED' && c.signedAt
                      ? `Firmado el ${fmt.format(new Date(c.signedAt))}`
                      : c.sentAt
                        ? `Enviado el ${fmt.format(new Date(c.sentAt))}`
                        : '—'}
                    {c.error ? ` · ${c.error}` : ''}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                {c.hasPdf && (
                  <Button asChild size="sm" variant="secondary">
                    <a href={`/api/consents/${c.id}/pdf`} target="_blank" rel="noreferrer">
                      Ver PDF
                    </a>
                  </Button>
                )}
                {c.status === 'SENT' && c.signingUrl && <CopyLink url={c.signingUrl} />}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      title="Copiar el enlace de firma por si hay que reenviarlo a mano"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copiado' : 'Copiar enlace'}
    </Button>
  );
}

/**
 * Los datos del tutor que van impresos en el PDF. Vienen rellenos de la ficha
 * (quien está a cargo y su móvil); lo que falte (DNI, dirección) se pide aquí,
 * no en la ficha: es lo que exige el documento, no la agenda.
 */
function SendConsentDialog({
  patientId,
  patientName,
  defaults,
}: {
  patientId: string;
  patientName: string;
  defaults: { name: string; phone: string; email: string };
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{
    signingUrl: string;
    whatsappSent: boolean;
    warning?: string;
  } | null>(null);

  const [name, setName] = React.useState(defaults.name);
  const [phone, setPhone] = React.useState(defaults.phone);
  const [email, setEmail] = React.useState(defaults.email);
  const [dni, setDni] = React.useState('');
  const [address, setAddress] = React.useState('');

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await sendConsentAction(patientId, { name, phone, email, dni, address });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(result.data);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setDone(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Send className="h-4 w-4" /> Enviar consentimiento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Consentimiento de {patientName}</DialogTitle>
          <DialogDescription>
            Se genera el PDF con los datos ya rellenos y se manda el enlace de firma al WhatsApp del
            tutor. Lo firma desde el móvil.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="mt-4 grid gap-3">
            <p className="flex items-start gap-2 rounded-[14px] bg-emerald-50 p-3 text-[13px] text-emerald-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              {done.whatsappSent
                ? 'Enviado. En cuanto firme, el PDF aparece aquí.'
                : 'Documento creado. El WhatsApp no salió: copia el enlace y mándaselo a mano.'}
            </p>
            {done.warning && (
              <p className="flex items-start gap-2 rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {done.warning}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Input readOnly value={done.signingUrl} className="text-[12px]" />
              <CopyLink url={done.signingUrl} />
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cs-name">Nombre y apellidos del tutor</Label>
              <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cs-phone">WhatsApp del tutor</Label>
                <Input
                  id="cs-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+34 600 000 000"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cs-dni">DNI/NIE</Label>
                <Input id="cs-dni" value={dni} onChange={(e) => setDni(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cs-address">Dirección</Label>
              <Input id="cs-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cs-email">Email (opcional)</Label>
              <Input
                id="cs-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && (
              <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {done ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!done && (
            <Button onClick={submit} disabled={pending || !name.trim() || !phone.trim()}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Enviar por WhatsApp
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
