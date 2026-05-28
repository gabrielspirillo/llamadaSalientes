'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

type DriverScope =
  | 'whatsapp_cloud'
  | 'whatsapp_twilio'
  | 'whatsapp_evolution'
  | 'voice_retell';

type TemplateRow = {
  id: string;
  channel: 'WHATSAPP' | 'VOICE';
  driverScope: DriverScope;
  templateName: string | null;
  templateLanguage: string;
  freeText: string | null;
  voicePromptOverride: string | null;
  enabled: boolean;
};

type PreviewResult = {
  channel: 'WHATSAPP' | 'VOICE';
  driverScope: string;
  templateName: string | null;
  voicePromptOverride: string | null;
  renderedText: string | null;
  buttons: Array<{ id: string; title: string }>;
};

const SCOPE_LABELS: Record<DriverScope, string> = {
  whatsapp_cloud: 'WhatsApp Cloud (Meta)',
  whatsapp_twilio: 'WhatsApp Twilio',
  whatsapp_evolution: 'WhatsApp Evolution',
  voice_retell: 'Voz (Retell)',
};

const VARIABLE_GROUPS: Array<{ title: string; vars: Array<{ path: string; help: string }> }> = [
  {
    title: 'Paciente',
    vars: [
      { path: 'contact.firstName', help: 'Nombre' },
      { path: 'contact.lastName', help: 'Apellido' },
      { path: 'contact.fullName', help: 'Nombre completo' },
      { path: 'contact.phone', help: 'Teléfono' },
    ],
  },
  {
    title: 'Cita actual',
    vars: [
      { path: 'oldAppointment.dateTime', help: 'ej: lunes 10/06 a las 10:30' },
      { path: 'oldAppointment.date', help: 'Solo fecha' },
      { path: 'oldAppointment.time', help: 'Solo hora' },
    ],
  },
  {
    title: 'Slot ofrecido',
    vars: [
      { path: 'newSlot.dateTime', help: 'Fecha y hora del slot' },
      { path: 'newSlot.date', help: 'Solo fecha' },
      { path: 'newSlot.time', help: 'Solo hora' },
      { path: 'newSlot.durationMinutes', help: 'Duración' },
    ],
  },
  {
    title: 'Tratamiento y clínica',
    vars: [
      { path: 'treatment', help: 'Nombre del tratamiento' },
      { path: 'clinic.name', help: 'Nombre de la clínica' },
      { path: 'clinic.address', help: 'Dirección' },
      { path: 'clinic.phone', help: 'Teléfono' },
    ],
  },
];

export function TemplatesEditor({
  initialTemplates,
  activeWhatsappScope,
}: {
  initialTemplates: TemplateRow[];
  activeWhatsappScope: DriverScope | null;
}) {
  const scopes = useMemo<DriverScope[]>(
    () =>
      activeWhatsappScope
        ? [activeWhatsappScope, 'voice_retell']
        : ['whatsapp_evolution', 'voice_retell'],
    [activeWhatsappScope],
  );

  const [activeScope, setActiveScope] = useState<DriverScope>(scopes[0]!);

  useEffect(() => {
    if (!scopes.includes(activeScope)) setActiveScope(scopes[0]!);
  }, [scopes, activeScope]);

  const current = initialTemplates.find((t) => t.driverScope === activeScope) ?? null;
  const channel: 'WHATSAPP' | 'VOICE' = activeScope === 'voice_retell' ? 'VOICE' : 'WHATSAPP';

  const [freeText, setFreeText] = useState<string>(current?.freeText ?? '');
  const [templateName, setTemplateName] = useState<string>(current?.templateName ?? '');
  const [voicePrompt, setVoicePrompt] = useState<string>(current?.voicePromptOverride ?? '');
  const [enabled, setEnabled] = useState<boolean>(current?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [testing, setTesting] = useState<null | 'WHATSAPP' | 'VOICE'>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const router = useRouter();

  const freeTextRef = useRef<HTMLTextAreaElement | null>(null);
  const voicePromptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setFreeText(current?.freeText ?? '');
    setTemplateName(current?.templateName ?? '');
    setVoicePrompt(current?.voicePromptOverride ?? '');
    setEnabled(current?.enabled ?? true);
    setPreview(null);
    setTestResult(null);
  }, [current]);

  // Inserta {{path}} en el cursor del textarea correspondiente.
  function insertVariable(path: string) {
    const token = `{{${path}}}`;
    if (channel === 'WHATSAPP' && activeScope === 'whatsapp_evolution') {
      insertAt(freeTextRef.current, freeText, setFreeText, token);
    } else if (channel === 'VOICE') {
      insertAt(voicePromptRef.current, voicePrompt, setVoicePrompt, token);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        channel,
        driverScope: activeScope,
        templateName:
          channel === 'WHATSAPP' && activeScope !== 'whatsapp_evolution' ? templateName : null,
        freeText: channel === 'WHATSAPP' && activeScope === 'whatsapp_evolution' ? freeText : null,
        voicePromptOverride: channel === 'VOICE' ? voicePrompt : null,
        enabled,
        templateParamsMap: [],
        buttons: [],
      };
      const res = await fetch('/api/waitlist/templates', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function doPreview() {
    setPreviewing(true);
    try {
      const res = await fetch('/api/waitlist/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      setPreview(data);
    } finally {
      setPreviewing(false);
    }
  }

  async function doTestSend(ch: 'WHATSAPP' | 'VOICE') {
    const phone = window.prompt(
      ch === 'WHATSAPP'
        ? 'Teléfono destino en formato E.164 (ej: +34611223344) para enviar el WhatsApp de prueba:'
        : 'Teléfono destino en formato E.164 (ej: +34611223344) para llamar de prueba:',
    );
    if (!phone) return;
    if (!/^\+\d{7,15}$/.test(phone.trim())) {
      alert('El teléfono debe estar en formato E.164 (ej: +34611223344).');
      return;
    }
    setTesting(ch);
    setTestResult(null);
    try {
      const res = await fetch('/api/waitlist/test-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: ch, toPhoneE164: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTestResult(`✗ Error: ${data.error ?? data.reason ?? res.statusText}`);
        return;
      }
      setTestResult(
        ch === 'WHATSAPP'
          ? `✓ WhatsApp enviado (kind=${data.kind ?? 'text'}).`
          : `✓ Llamada iniciada (callId=${data.callId ?? '?'}).`,
      );
    } finally {
      setTesting(null);
    }
  }

  // Botones de prueba disponibles: WhatsApp si el tenant tiene conexión WA activa
  // y Voz si tiene voice_retell. Si están los dos, ambos visibles.
  const showTestWa = activeWhatsappScope != null;
  const showTestVoice = true; // siempre potencialmente; el endpoint valida

  return (
    <div className="rounded-xl border border-zinc-200/70 bg-white p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Plantillas de mensaje</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Texto que se envía al paciente al ofrecerle el slot adelantado. Las variables se reemplazan en el envío real.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActiveScope(s)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              activeScope === s
                ? 'border-zinc-900 bg-zinc-900 text-white'
                : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            {SCOPE_LABELS[s]}
          </button>
        ))}
      </div>

      {(channel === 'VOICE' || activeScope === 'whatsapp_evolution') ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Variables disponibles · click para insertar en el cursor
          </div>
          <div className="space-y-2">
            {VARIABLE_GROUPS.map((g) => (
              <div key={g.title} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-500 w-32 shrink-0">{g.title}:</span>
                {g.vars.map((v) => (
                  <button
                    key={v.path}
                    type="button"
                    onClick={() => insertVariable(v.path)}
                    title={v.help}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-xs font-mono text-zinc-700 hover:bg-zinc-900 hover:text-white transition-colors"
                  >
                    {`{{${v.path}}}`}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Plantilla activa</span>
        </label>

        {channel === 'WHATSAPP' && activeScope !== 'whatsapp_evolution' ? (
          <label className="block">
            <span className="text-sm font-medium text-zinc-900">Nombre de la plantilla (WABA)</span>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="ej: waitlist_offer_es"
            />
            <span className="text-xs text-zinc-500">
              Debe estar aprobada en Meta Business Manager. Las variables van en los parámetros de la plantilla, no acá.
            </span>
          </label>
        ) : null}

        {channel === 'WHATSAPP' && activeScope === 'whatsapp_evolution' ? (
          <label className="block">
            <span className="text-sm font-medium text-zinc-900">Texto libre con variables</span>
            <textarea
              ref={freeTextRef}
              className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm font-mono"
              rows={6}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={`Hola {{contact.firstName}}, se liberó un hueco antes de tu cita del {{oldAppointment.dateTime}}. ¿Querés adelantarla al {{newSlot.dateTime}}?`}
            />
          </label>
        ) : null}

        {channel === 'VOICE' ? (
          <label className="block">
            <span className="text-sm font-medium text-zinc-900">Prompt extra para el agente</span>
            <textarea
              ref={voicePromptRef}
              className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm font-mono"
              rows={4}
              value={voicePrompt}
              onChange={(e) => setVoicePrompt(e.target.value)}
              placeholder="Instrucciones específicas para el agente al ofrecer el slot adelantado."
            />
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {showTestWa ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => doTestSend('WHATSAPP')}
            disabled={testing !== null}
          >
            {testing === 'WHATSAPP' ? 'Enviando…' : 'Probar WhatsApp'}
          </Button>
        ) : null}
        {showTestVoice ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => doTestSend('VOICE')}
            disabled={testing !== null}
          >
            {testing === 'VOICE' ? 'Llamando…' : 'Probar llamada'}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={doPreview} disabled={previewing}>
          {previewing ? 'Cargando…' : 'Previsualizar'}
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar plantilla'}
        </Button>
      </div>

      {testResult ? (
        <div
          className={`rounded-lg border p-3 text-sm ${
            testResult.startsWith('✓')
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {testResult}
        </div>
      ) : null}

      {preview ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Previsualización</div>
          {preview.renderedText ? (
            <div className="whitespace-pre-wrap text-zinc-800">{preview.renderedText}</div>
          ) : preview.templateName ? (
            <div className="text-zinc-700">
              Plantilla: <code>{preview.templateName}</code>
            </div>
          ) : preview.voicePromptOverride ? (
            <div className="whitespace-pre-wrap text-zinc-800">{preview.voicePromptOverride}</div>
          ) : (
            <div className="text-zinc-500">Sin contenido renderizado.</div>
          )}
          {preview.buttons.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {preview.buttons.map((b) => (
                <span key={b.id} className="rounded-full bg-white border border-zinc-200 px-3 py-1 text-xs">
                  {b.title}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Inserta texto en el cursor de un <textarea>. Mantiene la selección apuntando
// justo después del texto insertado para que el user pueda seguir escribiendo.
function insertAt(
  el: HTMLTextAreaElement | null,
  current: string,
  setter: (s: string) => void,
  token: string,
) {
  if (!el) {
    setter(current + token);
    return;
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.substring(0, start) + token + current.substring(end);
  setter(next);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}
