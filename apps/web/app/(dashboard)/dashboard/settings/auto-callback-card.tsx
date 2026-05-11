'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Check, Copy, ExternalLink, PhoneCall } from 'lucide-react';
import { useState } from 'react';

type Props = {
  intakeUrl: string;
  intakeKey: string;
  ghlWebhookUrl: string;
  locationId: string | null;
};

export function AutoCallbackCard({ intakeUrl, intakeKey, ghlWebhookUrl, locationId }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  function copy(value: string, label: string) {
    void navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold tracking-tight flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-violet-600" /> Auto-callback
          </h3>
          <Badge tone="success">Activo</Badge>
        </div>
        <p className="text-sm text-zinc-500 mb-5">
          Cada vez que un nuevo lead deja su teléfono, el agente lo llama automáticamente y
          al instante. Conectá las dos fuentes:
        </p>

        {/* 1. Webhook GHL */}
        <Section
          number="1"
          title="Webhook desde GHL"
          subtitle="GHL llama esta URL cada vez que se crea un contacto"
        >
          <CopyableField
            label="URL del webhook"
            value={ghlWebhookUrl}
            copyKey="ghl-webhook"
            copied={copied}
            onCopy={copy}
          />
          <p className="text-xs text-zinc-500 mt-3">
            En GHL → <strong>Settings → Integrations → Webhooks</strong> → New Outbound Webhook
            → pegá esta URL y elegí el evento <em>Contact Create</em>.
            {locationId && (
              <>
                {' '}
                Tu Location ID es <code className="text-[11px]">{locationId}</code>.
              </>
            )}
          </p>
        </Section>

        <Divider />

        {/* 2. API pública */}
        <Section
          number="2"
          title="API pública para formularios"
          subtitle="Cualquier landing o web puede disparar la llamada"
        >
          <CopyableField
            label="Endpoint"
            value={intakeUrl}
            copyKey="intake-url"
            copied={copied}
            onCopy={copy}
          />

          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-zinc-600">API Key</span>
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="text-[11px] text-zinc-500 hover:text-zinc-900"
              >
                {showKey ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
              <code className="flex-1 truncate text-xs font-mono text-zinc-700">
                {showKey ? intakeKey : '••••••••••••••••••••••••••••••••'}
              </code>
              <button
                type="button"
                onClick={() => copy(intakeKey, 'intake-key')}
                className="text-zinc-400 hover:text-zinc-900"
                title="Copiar"
              >
                {copied === 'intake-key' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              Esta key se deriva determinísticamente y no se guarda en plano. Para rotarla
              hay que rotar la ENCRYPTION_KEY del proyecto.
            </p>
          </div>

          <details className="mt-4 group">
            <summary className="text-xs font-medium text-violet-600 hover:text-violet-700 cursor-pointer inline-flex items-center gap-1">
              Ver ejemplo de uso (curl)
            </summary>
            <pre className="mt-2 rounded-lg bg-zinc-900 text-zinc-100 text-[11px] p-3 overflow-x-auto leading-relaxed">{`curl -X POST '${intakeUrl}' \\
  -H 'Authorization: Bearer ${intakeKey.slice(0, 12)}...' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "phone": "+34900000000",
    "name": "Juan Pérez",
    "email": "juan@example.com",
    "source": "landing-promo"
  }'`}</pre>
          </details>
        </Section>

        <Divider />

        {/* 3. Manual */}
        <Section
          number="3"
          title="Manual desde el dashboard"
          subtitle="Útil para hacer pruebas o callbacks puntuales"
        >
          <p className="text-xs text-zinc-500">
            Andá a <strong>Contactos</strong>, abrí cualquier contacto y dale a{' '}
            <strong>Llamar ahora</strong>.
          </p>
          <a
            href="/dashboard/contacts"
            className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-violet-600 hover:text-violet-700"
          >
            Ir a contactos <ExternalLink className="h-3 w-3" />
          </a>
        </Section>
      </div>
    </Card>
  );
}

function Section({
  number,
  title,
  subtitle,
  children,
}: {
  number: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="h-5 w-5 rounded-full bg-zinc-900 text-white text-[11px] font-semibold inline-flex items-center justify-center">
          {number}
        </span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[11px] text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="ml-7">{children}</div>
    </div>
  );
}

function CopyableField({
  label,
  value,
  copyKey,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  copied: string | null;
  onCopy: (v: string, k: string) => void;
}) {
  return (
    <div>
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
        <code className="flex-1 truncate text-xs font-mono text-zinc-700">{value}</code>
        <button
          type="button"
          onClick={() => onCopy(value, copyKey)}
          className="text-zinc-400 hover:text-zinc-900"
          title="Copiar"
        >
          {copied === copyKey ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-5 border-t border-zinc-100" />;
}
