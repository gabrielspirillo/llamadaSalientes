'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import type { TelephonyProvider } from '@/lib/telephony/provider';
import {
  CheckCircle2,
  Copy,
  Loader2,
  PhoneIncoming,
  PhoneOutgoing,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type TelephonyState = {
  provider: TelephonyProvider;
  twilioConfigured: boolean;
  twilioAccountSid: string | null;
  zadarmaConfigured: boolean;
  zadarmaUserKey: string | null;
  zadarmaWebhookSecretSet: boolean;
  callerIdE164: string | null;
  callerIdVerifiedAt: string | null;
  inboundNumberE164: string | null;
  inboundConfiguredAt: string | null;
  inboundRoute: 'agent' | 'forward';
  inboundForwardNumber: string | null;
};

type IncomingNumber = {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string | null;
  smsUrl: string | null;
};

export type WebhookUrls = {
  twilio: { voice: string; sms: string };
  zadarma: { webhook: string };
};

export function TelephonySettings({
  initial,
  webhookUrls,
}: {
  initial: TelephonyState;
  webhookUrls: WebhookUrls;
}) {
  const [state, setState] = useState<TelephonyState>(initial);
  const isConfigured =
    state.provider === 'twilio' ? state.twilioConfigured : state.zadarmaConfigured;

  return (
    <div className="space-y-4 sm:space-y-6">
      <ProviderTabs state={state} onChange={setState} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <CredentialsCard state={state} onChange={setState} />
        <CallerIdCard state={state} onChange={setState} isConfigured={isConfigured} />
        <InboundCard
          state={state}
          onChange={setState}
          isConfigured={isConfigured}
        />
        <HelpCard state={state} webhookUrls={webhookUrls} />
      </div>
    </div>
  );
}

// ─── Tabs por provider ───────────────────────────────────────────────────────

function ProviderTabs({
  state,
  onChange,
}: {
  state: TelephonyState;
  onChange: (s: TelephonyState) => void;
}) {
  const setProvider = (provider: TelephonyProvider) => {
    if (provider === state.provider) return;
    onChange({ ...state, provider });
  };

  const providers: { id: TelephonyProvider; label: string; sub: string; configured: boolean }[] = [
    {
      id: 'twilio',
      label: 'Twilio',
      sub: 'Mejor para US/Canadá y WhatsApp BSP. Caller ID verificado por DTMF.',
      configured: state.twilioConfigured,
    },
    {
      id: 'zadarma',
      label: 'Zadarma',
      sub: 'Mejor para LATAM/Europa. DIDs económicos. Verificación de caller ID via cabinet.',
      configured: state.zadarmaConfigured,
    },
  ];

  return (
    <Card>
      <div className="p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3 px-1">
          <ShieldCheck className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium">Provider de telefonía</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {providers.map((p) => {
            const active = state.provider === p.id;
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`text-left rounded-xl border p-3 transition ${
                  active
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white hover:border-zinc-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.label}</span>
                  {p.configured && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      Configurado
                    </span>
                  )}
                  {active && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white">
                      Activo
                    </span>
                  )}
                </div>
                <p
                  className={`text-xs mt-1 ${active ? 'text-zinc-300' : 'text-zinc-500'}`}
                >
                  {p.sub}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── Credenciales ────────────────────────────────────────────────────────────

function CredentialsCard({
  state,
  onChange,
}: {
  state: TelephonyState;
  onChange: (s: TelephonyState) => void;
}) {
  if (state.provider === 'twilio') {
    return <TwilioCredentialsForm state={state} onChange={onChange} />;
  }
  return <ZadarmaCredentialsForm state={state} onChange={onChange} />;
}

function TwilioCredentialsForm({
  state,
  onChange,
}: {
  state: TelephonyState;
  onChange: (s: TelephonyState) => void;
}) {
  const [sid, setSid] = useState(state.twilioAccountSid ?? '');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/telephony/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'twilio', accountSid: sid, authToken: token }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setMsg({ kind: 'ok', text: 'Credenciales guardadas y validadas con Twilio.' });
      setToken('');
      onChange({ ...state, twilioConfigured: true, twilioAccountSid: sid, provider: 'twilio' });
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-zinc-500" />
          <h3 className="text-base font-semibold tracking-tight">Credenciales Twilio</h3>
          {state.twilioConfigured && (
            <span className="ml-auto text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
              Configurado
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          Pegá las credenciales del subaccount Twilio de la clínica. El Auth Token se cifra
          (AES-256-GCM) antes de guardarse. Validamos contra Twilio antes de persistir.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="sid">Account SID</Label>
            <Input
              id="sid"
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="mt-2 font-mono"
            />
          </div>
          <div>
            <Label htmlFor="token">Auth Token</Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                state.twilioConfigured ? '••••••••••••  (dejar vacío para no cambiar)' : ''
              }
              className="mt-2 font-mono"
            />
          </div>
        </div>
        <Banner msg={msg} />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={loading || !sid || !token} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar y validar
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ZadarmaCredentialsForm({
  state,
  onChange,
}: {
  state: TelephonyState;
  onChange: (s: TelephonyState) => void;
}) {
  const [userKey, setUserKey] = useState(state.zadarmaUserKey ?? '');
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/telephony/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'zadarma',
          userKey,
          secret,
          webhookSecret: webhookSecret || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setMsg({ kind: 'ok', text: 'Credenciales guardadas y validadas con Zadarma.' });
      setSecret('');
      setWebhookSecret('');
      onChange({
        ...state,
        zadarmaConfigured: true,
        zadarmaUserKey: userKey,
        zadarmaWebhookSecretSet: !!webhookSecret || state.zadarmaWebhookSecretSet,
        provider: 'zadarma',
      });
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-zinc-500" />
          <h3 className="text-base font-semibold tracking-tight">Credenciales Zadarma</h3>
          {state.zadarmaConfigured && (
            <span className="ml-auto text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
              Configurado
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          Generá las claves en cabinet.zadarma.com → Settings → API. El Secret y el
          Webhook Secret se cifran (AES-256-GCM) antes de guardarse. Validamos con un
          ping a /v1/info/balance/ antes de persistir.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="zd-key">User Key</Label>
            <Input
              id="zd-key"
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              placeholder="3a8c…"
              className="mt-2 font-mono"
            />
          </div>
          <div>
            <Label htmlFor="zd-secret">Secret</Label>
            <Input
              id="zd-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                state.zadarmaConfigured ? '••••••••••••  (dejar vacío para no cambiar)' : ''
              }
              className="mt-2 font-mono"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="zd-webhook">
              Webhook Secret <span className="text-xs text-zinc-400">(opcional)</span>
            </Label>
            <Input
              id="zd-webhook"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={
                state.zadarmaWebhookSecretSet ? '•••• (ya configurado)' : 'Sólo si lo configuraste en cabinet'
              }
              className="mt-2 font-mono"
            />
            <p className="text-xs text-zinc-500 mt-1">
              Si no lo configurás, verificamos las firmas NOTIFY_* con el Secret del API.
            </p>
          </div>
        </div>
        <Banner msg={msg} />
        <div className="flex justify-end">
          <Button
            onClick={submit}
            disabled={loading || !userKey || !secret}
            size="sm"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar y validar
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Caller ID saliente ──────────────────────────────────────────────────────

function CallerIdCard({
  state,
  onChange,
  isConfigured,
}: {
  state: TelephonyState;
  onChange: (s: TelephonyState) => void;
  isConfigured: boolean;
}) {
  const [phone, setPhone] = useState(state.callerIdE164 ?? '');
  const [validationCode, setValidationCode] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  async function startVerification() {
    setVerifying(true);
    setMsg(null);
    setValidationCode(null);
    try {
      const res = await fetch('/api/telephony/caller-id/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.alreadyVerified) {
        setMsg({
          kind: 'ok',
          text:
            state.provider === 'zadarma'
              ? 'Número detectado en tu cuenta Zadarma y verificado.'
              : 'Este número ya estaba verificado en Twilio.',
        });
        onChange({
          ...state,
          callerIdE164: j.phoneNumber,
          callerIdVerifiedAt: new Date().toISOString(),
        });
        return;
      }
      // Twilio: tenemos validation_code + polling.
      setValidationCode(j.validationCode);
      setMsg({
        kind: 'ok',
        text:
          'Twilio te va a llamar. Cuando escuches la voz, ingresá los 6 dígitos en el teclado del teléfono.',
      });
      startPolling();
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setVerifying(false);
    }
  }

  function startPolling() {
    setPolling(true);
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 3;
      try {
        const res = await fetch('/api/telephony/caller-id/status');
        const j = await res.json();
        if (j.verified) {
          setValidationCode(null);
          setMsg({ kind: 'ok', text: 'Caller ID verificado correctamente.' });
          onChange({
            ...state,
            callerIdE164: j.phoneNumber,
            callerIdVerifiedAt: new Date().toISOString(),
          });
          stopPoll();
        } else if (elapsed >= 240) {
          setMsg({
            kind: 'error',
            text: 'Pasaron 4 minutos sin confirmación. Probá de nuevo o revisá el panel del provider.',
          });
          stopPoll();
        }
      } catch {
        // Silent — el siguiente tick reintenta.
      }
    }, 3000);
  }

  async function unlink() {
    if (!confirm('¿Quitar el Caller ID actual? Las próximas llamadas usarán el número del provider.')) {
      return;
    }
    const res = await fetch('/api/telephony/caller-id', { method: 'DELETE' });
    if (res.ok) {
      onChange({ ...state, callerIdE164: null, callerIdVerifiedAt: null });
      setMsg({ kind: 'ok', text: 'Caller ID desvinculado.' });
      setPhone('');
    }
  }

  const verified = !!state.callerIdVerifiedAt;
  const isZadarma = state.provider === 'zadarma';

  return (
    <Card>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <PhoneOutgoing className="h-5 w-5 text-zinc-500" />
          <h3 className="text-base font-semibold tracking-tight">Caller ID saliente</h3>
          {verified && <CheckCircle2 className="h-4 w-4 text-emerald-600 ml-auto" />}
        </div>
        <p className="text-sm text-zinc-500">
          Número público de la clínica que verá el destinatario en las llamadas salientes.{' '}
          {isZadarma
            ? 'En Zadarma se verifica desde cabinet.zadarma.com → My numbers; acá sólo confirmamos.'
            : 'Twilio lo verifica por DTMF con un código de 6 dígitos.'}
        </p>

        {verified ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <div className="font-medium text-emerald-900">{state.callerIdE164}</div>
            <div className="text-emerald-700 text-xs mt-0.5">
              Verificado{' '}
              {state.callerIdVerifiedAt
                ? new Date(state.callerIdVerifiedAt).toLocaleString('es-MX')
                : ''}
            </div>
            <button
              type="button"
              onClick={unlink}
              className="mt-2 text-xs text-red-700 underline hover:text-red-800"
            >
              Desvincular
            </button>
          </div>
        ) : (
          <>
            <div>
              <Label htmlFor="callerId">Número de la clínica (E.164)</Label>
              <Input
                id="callerId"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+5491139530968"
                className="mt-2 font-mono"
                disabled={polling || verifying}
              />
            </div>

            {validationCode && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-center">
                <div className="text-xs text-amber-800 uppercase tracking-wide">
                  Código a ingresar en el teléfono
                </div>
                <div className="text-4xl font-bold tracking-[0.4em] text-amber-900 mt-2">
                  {validationCode}
                </div>
                <div className="text-xs text-amber-700 mt-2">
                  Cuando suene el teléfono de la clínica, atendé y tipeá estos 6 dígitos.
                </div>
              </div>
            )}

            {polling && (
              <div className="flex items-center gap-2 text-sm text-zinc-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Esperando confirmación…
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={startVerification}
                size="sm"
                disabled={!isConfigured || !phone || verifying || polling}
              >
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {polling
                  ? 'Esperando…'
                  : isZadarma
                  ? 'Confirmar número'
                  : 'Verificar número'}
              </Button>
            </div>
          </>
        )}

        <Banner msg={msg} />
      </div>
    </Card>
  );
}

// ─── Número entrante ─────────────────────────────────────────────────────────

function InboundCard({
  state,
  onChange,
  isConfigured,
}: {
  state: TelephonyState;
  onChange: (s: TelephonyState) => void;
  isConfigured: boolean;
}) {
  const [numbers, setNumbers] = useState<IncomingNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<string>('');
  const [route, setRoute] = useState<'agent' | 'forward'>(state.inboundRoute);
  const [forwardNumber, setForwardNumber] = useState(state.inboundForwardNumber ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loadNumbers = useCallback(async () => {
    if (!isConfigured) return;
    setLoading(true);
    try {
      const res = await fetch('/api/telephony/inbound/numbers');
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setNumbers(j.numbers ?? []);
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [isConfigured]);

  useEffect(() => {
    loadNumbers();
  }, [loadNumbers, state.provider]);

  async function configure() {
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/telephony/inbound/configure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sid: selected,
          route,
          forwardNumber: route === 'forward' ? forwardNumber : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      onChange({
        ...state,
        inboundNumberE164: j.inboundNumberE164,
        inboundConfiguredAt: new Date().toISOString(),
        inboundRoute: route,
        inboundForwardNumber: route === 'forward' ? forwardNumber : null,
      });
      setMsg({
        kind: 'ok',
        text: 'Número configurado. Ya podés indicarle a la clínica que active el desvío.',
      });
      await loadNumbers();
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  const isZadarma = state.provider === 'zadarma';

  return (
    <Card>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <PhoneIncoming className="h-5 w-5 text-zinc-500" />
          <h3 className="text-base font-semibold tracking-tight">Número entrante</h3>
          {state.inboundNumberE164 && (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 ml-auto" />
          )}
        </div>
        <p className="text-sm text-zinc-500">
          {isZadarma
            ? 'Elegí qué DID Zadarma recibe las llamadas. Configuramos la URL de notificación de la cuenta automáticamente (Zadarma sólo permite una por cuenta).'
            : 'Elegí qué número Twilio recibe las llamadas que la clínica desvía desde su operador. Configuramos sus webhooks de voz/SMS automáticamente.'}
        </p>

        {!isConfigured ? (
          <div className="text-sm text-zinc-500 italic">
            Cargá las credenciales primero para listar los números disponibles.
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Listando números…
          </div>
        ) : numbers.length === 0 ? (
          <div className="text-sm text-zinc-500 italic">
            {isZadarma
              ? 'No hay DIDs comprados en esta cuenta Zadarma. Comprá uno desde cabinet.zadarma.com → My numbers.'
              : 'No hay IncomingPhoneNumbers en esta cuenta Twilio. Comprá uno primero desde Twilio Console.'}
          </div>
        ) : (
          <>
            <div>
              <Label>Número a usar</Label>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="mt-2 flex h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm"
              >
                <option value="">Seleccionar…</option>
                {numbers.map((n) => (
                  <option key={n.sid} value={n.sid}>
                    {n.phoneNumber} — {n.friendlyName || 'sin nombre'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Cómo enrutar las entrantes</Label>
              <div className="mt-2 space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    checked={route === 'agent'}
                    onChange={() => setRoute('agent')}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">Agente Retell</span>
                    <span className="text-zinc-500 block text-xs">
                      Atiende el agente AI; transfiere a humano si lo pide el paciente.
                      {isZadarma && ' (Requiere SIP trunk Zadarma → Retell configurado en el cabinet.)'}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    checked={route === 'forward'}
                    onChange={() => setRoute('forward')}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">Reenviar a humano</span>
                    <span className="text-zinc-500 block text-xs">
                      La llamada se enruta directo a un número humano (sin agente AI).
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {route === 'forward' && (
              <div>
                <Label htmlFor="fwd">Número humano (E.164)</Label>
                <Input
                  id="fwd"
                  value={forwardNumber}
                  onChange={(e) => setForwardNumber(e.target.value)}
                  placeholder="+5491139530968"
                  className="mt-2 font-mono"
                />
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={configure}
                size="sm"
                disabled={
                  submitting ||
                  !selected ||
                  (route === 'forward' && !forwardNumber)
                }
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Configurar webhooks
              </Button>
            </div>
          </>
        )}

        {state.inboundNumberE164 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div>
              <span className="font-medium">{state.inboundNumberE164}</span> está recibiendo
              llamadas como{' '}
              <span className="font-medium">
                {state.inboundRoute === 'agent' ? 'Agente Retell' : 'Forward a humano'}
              </span>
              .
            </div>
            <div className="text-xs text-emerald-700 mt-1">
              {isZadarma
                ? 'Las entrantes llegan vía webhook NOTIFY_START y se redirigen según esta config.'
                : 'Pedile a la clínica que active el desvío desde su operador hacia este número.'}
            </div>
          </div>
        )}

        <Banner msg={msg} />
      </div>
    </Card>
  );
}

// ─── Ayuda + webhook URLs ────────────────────────────────────────────────────

function HelpCard({
  state,
  webhookUrls,
}: {
  state: TelephonyState;
  webhookUrls: WebhookUrls;
}) {
  const isZadarma = state.provider === 'zadarma';
  return (
    <Card>
      <div className="p-4 sm:p-6 space-y-3">
        <h3 className="text-base font-semibold tracking-tight">Cómo funciona</h3>
        <ul className="text-sm text-zinc-600 space-y-2 list-disc pl-5">
          {isZadarma ? (
            <>
              <li>
                <span className="font-medium">Salientes:</span> Zadarma dispara la llamada vía
                /v1/request/callback/. El paciente ve el caller ID configurado (DID o número
                personal verificado en el cabinet).
              </li>
              <li>
                <span className="font-medium">Entrantes:</span> Zadarma envía un POST
                NOTIFY_START a nuestro webhook; respondemos con `{'{ redirect: ... }'}` para
                enrutar al agente Retell (SIP) o a un humano.
              </li>
              <li>
                <span className="font-medium">Agente AI:</span> requiere un trunk SIP externo
                en cabinet.zadarma.com → Settings → External SIP, apuntando a Retell. Setear{' '}
                <code className="bg-zinc-100 px-1 rounded">ZADARMA_SIP_INTERNAL_FOR_AGENT</code>{' '}
                en env para usar esa extensión como leg A del callback.
              </li>
            </>
          ) : (
            <>
              <li>
                <span className="font-medium">Salientes:</span> Twilio coloca la llamada y muestra
                el Caller ID verificado como número del que llama. Requiere subaccount Twilio del
                tenant registrado en Retell (BYOT).
              </li>
              <li>
                <span className="font-medium">Entrantes:</span> la clínica configura "desvío de
                llamadas" en su operador hacia el número Twilio elegido aquí; el webhook recibe
                la llamada y la enruta al agente o a un humano.
              </li>
              <li>
                <span className="font-medium">Number porting</span> (largo plazo): podés portar
                el número de la clínica directo a Twilio para evitar el desvío.
              </li>
            </>
          )}
        </ul>
        <div className="pt-2 border-t border-zinc-100 space-y-2">
          <div className="text-xs text-zinc-500">
            Webhook URLs configuradas automáticamente:
          </div>
          {isZadarma ? (
            <CopyRow label="Notification URL" value={webhookUrls.zadarma.webhook} />
          ) : (
            <>
              <CopyRow label="VoiceUrl" value={webhookUrls.twilio.voice} />
              <CopyRow label="SmsUrl" value={webhookUrls.twilio.sms} />
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="text-xs font-mono text-zinc-900 truncate">{value}</div>
      </div>
      <button
        type="button"
        className="text-zinc-500 hover:text-zinc-900"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copiar"
      >
        {copied ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

function Banner({
  msg,
}: {
  msg: { kind: 'ok' | 'error'; text: string } | null;
}) {
  if (!msg) return null;
  return (
    <div
      className={`text-sm rounded-xl border px-3.5 py-2.5 ${
        msg.kind === 'ok'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-red-50 border-red-200 text-red-800'
      }`}
    >
      {msg.text}
    </div>
  );
}
