'use client';

import {
  refreshConsentAction,
  sendConsentAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
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
import { formatPhoneDisplay } from '@/lib/patients/names';
import {
  AlertTriangle,
  Check,
  Copy,
  FileSignature,
  FileText,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';
import Link from 'next/link';
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
  /** El WhatsApp salió de verdad (hay id de mensaje del proveedor). */
  whatsappSent: boolean;
  error: string | null;
}

export interface ConsentRecipientDefaults {
  name: string;
  phone: string;
  email: string;
  /** "Mamá", "Papá"…: quién es para el niño. */
  relation: string | null;
}

/**
 * El consentimiento informado del paciente: los ya mandados con su estado
 * real (creado, enviado por WhatsApp, firmado) y las acciones que tocan en
 * cada momento. Con uno pendiente, lo primero es comprobar la firma o copiar
 * el enlace; mandar otro pasa a segundo plano.
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
  defaults: ConsentRecipientDefaults;
  canWrite: boolean;
}) {
  const fmt = React.useMemo(
    () =>
      new Intl.DateTimeFormat('es-ES', {
        day: 'numeric',
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
    <Card id="consentimiento">
      <CardTopbar
        icon={<FileSignature className="h-4 w-4" />}
        title="Consentimiento informado"
        subtitle={
          signed
            ? `Firmado el ${signed.signedAt ? fmt.format(new Date(signed.signedAt)) : '—'}`
            : pending
              ? pending.whatsappSent
                ? 'Enviado, pendiente de firma'
                : 'Creado, sin enviar todavía'
              : 'Todavía no se ha enviado'
        }
        tone="sky"
      />
      <CardContent className="grid gap-3">
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {pending ? (
              <>
                <RefreshConsent patientId={patientId} consentId={pending.id} primary />
                {pending.signingUrl && <CopyLink url={pending.signingUrl} />}
                <SendConsentDialog
                  patientId={patientId}
                  patientName={patientName}
                  defaults={defaults}
                  variant="ghost"
                  label="Enviar otro"
                />
              </>
            ) : (
              <SendConsentDialog
                patientId={patientId}
                patientName={patientName}
                defaults={defaults}
                variant="primary"
                label={signed ? 'Enviar uno nuevo' : 'Enviar consentimiento'}
              />
            )}
          </div>
        )}

        {consents.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="h-5 w-5" />}
            title="Sin consentimiento"
            description="Con un clic se manda al WhatsApp del tutor, que lo lee y lo firma desde el móvil."
            className="py-8"
          />
        ) : (
          <ul className="grid gap-2.5">
            {consents.map((c) => (
              <ConsentRow key={c.id} consent={c} fmt={fmt} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConsentRow({ consent: c, fmt }: { consent: ConsentListItem; fmt: Intl.DateTimeFormat }) {
  const noWhatsapp = c.error?.includes('Sin WhatsApp conectado') ?? false;
  const badge: { tone: 'warn' | 'success' | 'neutral' | 'danger'; label: string } =
    c.status === 'SIGNED'
      ? { tone: 'success', label: 'Firmado' }
      : c.status === 'SENT'
        ? c.whatsappSent
          ? { tone: 'warn', label: 'Pendiente de firma' }
          : { tone: 'warn', label: 'Sin enviar' }
        : c.status === 'CANCELLED'
          ? { tone: 'neutral', label: 'Cancelado' }
          : { tone: 'danger', label: 'Error' };

  return (
    <li className="grid gap-2 rounded-[14px] border border-(--color-border) p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-800">
            {c.recipientName} · {formatPhoneDisplay(c.recipientPhone)}
          </p>
          <p className="text-[12px] text-zinc-600">
            {c.status === 'SIGNED' && c.signedAt
              ? `Firmado el ${fmt.format(new Date(c.signedAt))}`
              : c.whatsappSent && c.sentAt
                ? `Enviado por WhatsApp el ${fmt.format(new Date(c.sentAt))}`
                : c.sentAt
                  ? `Documento creado el ${fmt.format(new Date(c.sentAt))}`
                  : '—'}
          </p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      {c.status === 'SENT' && !c.whatsappSent && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] bg-amber-50 px-2.5 py-2 text-[12px] text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            El WhatsApp no salió{c.error ? `: ${c.error.replace(/^WhatsApp: /, '')}` : ''}.
            Copia el enlace y mándaselo a mano
            {noWhatsapp ? ' o conecta el WhatsApp de la clínica' : ''}.
          </span>
          {noWhatsapp && (
            <Link
              href="/dashboard/whatsapp/integrations"
              prefetch={false}
              className="font-semibold underline underline-offset-2"
            >
              Conectar WhatsApp
            </Link>
          )}
        </p>
      )}
      {(c.hasPdf || (c.status === 'SENT' && c.signingUrl)) && (
        <div className="flex flex-wrap gap-2">
          {c.hasPdf && (
            <Button asChild size="sm" variant="secondary">
              <a href={`/api/consents/${c.id}/pdf`} target="_blank" rel="noreferrer">
                <FileText className="h-4 w-4" /> Ver PDF firmado
              </a>
            </Button>
          )}
          {c.status === 'SENT' && c.signingUrl && <CopyLink url={c.signingUrl} />}
        </div>
      )}
    </li>
  );
}

/**
 * "¿Ya firmó?": pregunta a Documenso y, si está completado, cierra el
 * consentimiento aquí mismo. Es lo que salva el caso de un webhook perdido, y
 * si algo falla al cerrar, el motivo se ve aquí y no en un registro.
 */
function RefreshConsent({
  patientId,
  consentId,
  primary = false,
}: {
  patientId: string;
  consentId: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  function run() {
    setNote(null);
    startTransition(async () => {
      const result = await refreshConsentAction(patientId, consentId);
      if (!result.ok) {
        setNote({ tone: 'error', text: result.error });
        return;
      }
      if (result.data.signed) {
        setNote({ tone: 'ok', text: 'Firmado. Ya está el PDF.' });
        router.refresh();
      } else {
        setNote({
          tone: 'warn',
          text: `Todavía sin firmar (estado en Documenso: ${result.data.status}).`,
        });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={primary ? 'primary' : 'secondary'} onClick={run} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Comprobar firma
      </Button>
      {note && (
        <span
          className={
            note.tone === 'ok'
              ? 'text-[12px] font-semibold text-emerald-700'
              : note.tone === 'warn'
                ? 'text-[12px] text-amber-800'
                : 'text-[12px] text-rose-700'
          }
        >
          {note.text}
        </span>
      )}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
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
 * Los datos del tutor que van impresos en el PDF. Vienen rellenos con el
 * titular del teléfono de la ficha; lo que falte (DNI, dirección) se pide
 * aquí, no en la ficha: es lo que exige el documento, no la agenda.
 */
function SendConsentDialog({
  patientId,
  patientName,
  defaults,
  variant,
  label,
}: {
  patientId: string;
  patientName: string;
  defaults: ConsentRecipientDefaults;
  variant: 'primary' | 'ghost';
  label: string;
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
        <Button size="sm" variant={variant}>
          <Send className="h-4 w-4" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Consentimiento de {patientName}</DialogTitle>
          <DialogDescription>
            Se genera el PDF con los datos ya rellenos y se manda el enlace de firma al WhatsApp del
            tutor
            {defaults.name
              ? `: ${defaults.name}${defaults.relation ? ` (${defaults.relation})` : ''}, titular del teléfono`
              : ''}
            . Lo firma desde el móvil.
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
