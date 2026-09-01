'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

type Settings = {
  enabled: boolean;
  channelMode: 'WHATSAPP_ONLY' | 'VOICE_ONLY' | 'WHATSAPP_THEN_VOICE';
  ttlMinutesDefault: number;
  ttlMinutesNearSlot: number;
  nearSlotHoursThreshold: number;
  minSkipHoursThreshold: number;
  whatsappToVoiceWindowMinutes: number;
  minAppointmentDistanceDays: number;
  maxAppointmentDistanceDays: number | null;
  minAdvanceDays: number;
  requireSameDentist: boolean;
  respectTimeWindow: boolean;
};

export function WaitlistSettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/waitlist/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      setSavedAt(new Date());
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[22px] border border-[--color-border] bg-white shadow-[var(--shadow-soft)] p-6 space-y-6">
      <div>
        <h2 className="text-[22px] font-bold tracking-tight text-zinc-900">
          Configuración general
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Estas opciones controlan cómo se ofrecen los huecos que se quedan libres a los pacientes
          de la lista.
        </p>
      </div>

      <Row
        label="Módulo activo"
        hint="Si lo desactivas, no se añaden pacientes nuevos ni se envían ofertas."
      >
        <Toggle value={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
      </Row>

      <Row label="Canal de oferta" hint="Cómo se avisa al paciente cuando queda un hueco libre.">
        <select
          className="w-full sm:w-auto max-w-full rounded-md border border-[--color-border] px-3 py-1.5 text-sm bg-white"
          value={s.channelMode}
          onChange={(e) => setS({ ...s, channelMode: e.target.value as Settings['channelMode'] })}
        >
          <option value="WHATSAPP_ONLY">Solo WhatsApp</option>
          <option value="VOICE_ONLY">Solo llamada de voz</option>
          <option value="WHATSAPP_THEN_VOICE">WhatsApp y, si no responde, llamada</option>
        </select>
      </Row>

      <Row
        label="Tiempo para responder (min)"
        hint="Cuánto esperamos la respuesta antes de pasar al siguiente paciente."
      >
        <NumInput
          value={s.ttlMinutesDefault}
          onChange={(v) => setS({ ...s, ttlMinutesDefault: v })}
        />
      </Row>

      <Row
        label="Tiempo para responder si el hueco es inminente (min)"
        hint="Se usa cuando el hueco libre es muy próximo."
      >
        <NumInput
          value={s.ttlMinutesNearSlot}
          onChange={(v) => setS({ ...s, ttlMinutesNearSlot: v })}
        />
      </Row>

      <Row
        label="A partir de cuántas horas el hueco se considera inminente"
        hint="Si faltan menos horas que estas, se usa el tiempo de respuesta reducido."
      >
        <NumInput
          value={s.nearSlotHoursThreshold}
          onChange={(v) => setS({ ...s, nearSlotHoursThreshold: v })}
        />
      </Row>

      <Row
        label="No ofrecer si faltan menos de (horas)"
        hint="Si el hueco está muy cerca, no merece la pena ofrecerlo."
      >
        <NumInput
          value={s.minSkipHoursThreshold}
          onChange={(v) => setS({ ...s, minSkipHoursThreshold: v })}
        />
      </Row>

      <Row
        label="Espera entre el WhatsApp y la llamada (min)"
        hint="Solo se aplica si has elegido «WhatsApp y, si no responde, llamada»."
      >
        <NumInput
          value={s.whatsappToVoiceWindowMinutes}
          onChange={(v) => setS({ ...s, whatsappToVoiceWindowMinutes: v })}
        />
      </Row>

      <hr className="border-[--color-border-subtle]" />

      <div>
        <h2 className="text-[22px] font-bold tracking-tight text-zinc-900">
          Reglas de elegibilidad
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Qué citas entran solas en la lista y qué huecos se les ofrecen.
        </p>
      </div>

      <Row
        label="La cita actual debe estar a más de (días)"
        hint="Los pacientes con la cita muy próxima no entran en la lista de espera."
      >
        <NumInput
          value={s.minAppointmentDistanceDays}
          onChange={(v) => setS({ ...s, minAppointmentDistanceDays: v })}
        />
      </Row>

      <Row
        label="La cita actual no debe estar a más de (días)"
        hint="Las citas más lejanas no entran en la lista. Déjalo vacío para no poner tope."
      >
        <NullableNumInput
          value={s.maxAppointmentDistanceDays}
          onChange={(v) => setS({ ...s, maxAppointmentDistanceDays: v })}
          placeholder="sin tope"
        />
      </Row>

      <Row
        label="El hueco debe adelantar la cita al menos (días)"
        hint="Solo se ofrecen huecos que adelanten la cita de forma apreciable."
      >
        <NumInput value={s.minAdvanceDays} onChange={(v) => setS({ ...s, minAdvanceDays: v })} />
      </Row>

      <Row
        label="Exigir mismo dentista"
        hint="Solo se ofrecen huecos con el mismo dentista de la cita original."
      >
        <Toggle
          value={s.requireSameDentist}
          onChange={(v) => setS({ ...s, requireSameDentist: v })}
        />
      </Row>

      <Row
        label="Respetar ventana horaria del paciente"
        hint="Si el paciente solo puede en cierta franja, no se le ofrece nada fuera de ella."
      >
        <Toggle
          value={s.respectTimeWindow}
          onChange={(v) => setS({ ...s, respectTimeWindow: v })}
        />
      </Row>

      <div className="flex items-center justify-end gap-3 pt-2">
        {savedAt ? (
          <span className="text-xs text-emerald-600">
            Guardado {savedAt.toLocaleTimeString('es-ES')}
          </span>
        ) : null}
        <Button disabled={saving} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex-1">
        <div className="text-sm font-medium text-zinc-900">{label}</div>
        {hint ? <div className="text-xs text-zinc-500 mt-0.5">{hint}</div> : null}
      </div>
      <div className="sm:shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`inline-flex h-6 w-10 items-center rounded-full transition-colors ${
        value ? 'bg-emerald-600' : 'bg-zinc-200'
      }`}
      aria-pressed={value}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="w-28 rounded-md border border-[--color-border] px-3 py-1.5 text-sm bg-white text-right"
      value={value}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function NullableNumInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      className="w-28 rounded-md border border-[--color-border] px-3 py-1.5 text-sm bg-white text-right"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === '') return onChange(null);
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
