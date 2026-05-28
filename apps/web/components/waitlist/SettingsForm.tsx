'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

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
    <div className="rounded-xl border border-zinc-200/70 bg-white p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Configuración general</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Estas opciones controlan cómo el sistema oferta los slots liberados a los pacientes en cola.
        </p>
      </div>

      <Row label="Módulo activo" hint="Si está apagado, no se crean entradas nuevas ni se envían ofertas.">
        <Toggle value={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} />
      </Row>

      <Row label="Canal de oferta" hint="Cómo se contacta al paciente cuando hay un slot disponible.">
        <select
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm bg-white"
          value={s.channelMode}
          onChange={(e) => setS({ ...s, channelMode: e.target.value as Settings['channelMode'] })}
        >
          <option value="WHATSAPP_ONLY">Solo WhatsApp</option>
          <option value="VOICE_ONLY">Solo Voz (llamada)</option>
          <option value="WHATSAPP_THEN_VOICE">WhatsApp y luego Voz si no responde</option>
        </select>
      </Row>

      <Row label="TTL default (min)" hint="Cuánto esperamos respuesta antes de pasar al siguiente paciente.">
        <NumInput value={s.ttlMinutesDefault} onChange={(v) => setS({ ...s, ttlMinutesDefault: v })} />
      </Row>

      <Row label="TTL si el slot está cerca (min)" hint="TTL reducido cuando el slot es próximo.">
        <NumInput value={s.ttlMinutesNearSlot} onChange={(v) => setS({ ...s, ttlMinutesNearSlot: v })} />
      </Row>

      <Row label="Umbral 'slot cercano' (horas)" hint="Si faltan menos horas, se usa el TTL reducido.">
        <NumInput value={s.nearSlotHoursThreshold} onChange={(v) => setS({ ...s, nearSlotHoursThreshold: v })} />
      </Row>

      <Row label="No ofrecer si faltan menos de (horas)" hint="Si el slot está muy cerca, no perdemos tiempo ofreciéndolo.">
        <NumInput value={s.minSkipHoursThreshold} onChange={(v) => setS({ ...s, minSkipHoursThreshold: v })} />
      </Row>

      <Row label="Ventana WhatsApp → Voz (min)" hint="Solo para canal WHATSAPP_THEN_VOICE.">
        <NumInput
          value={s.whatsappToVoiceWindowMinutes}
          onChange={(v) => setS({ ...s, whatsappToVoiceWindowMinutes: v })}
        />
      </Row>

      <hr className="border-zinc-100" />

      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Reglas de elegibilidad</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Qué citas entran a la cola automática y qué slots se les ofrecen.
        </p>
      </div>

      <Row
        label="Cita actual debe estar a (días) al menos"
        hint="Pacientes con cita cercana no entran a la waitlist."
      >
        <NumInput
          value={s.minAppointmentDistanceDays}
          onChange={(v) => setS({ ...s, minAppointmentDistanceDays: v })}
        />
      </Row>

      <Row
        label="Slot debe adelantar al menos (días)"
        hint="Solo ofrecemos slots que adelanten significativamente la cita actual."
      >
        <NumInput value={s.minAdvanceDays} onChange={(v) => setS({ ...s, minAdvanceDays: v })} />
      </Row>

      <Row label="Exigir mismo dentista" hint="Solo ofrecer slots del mismo dentista que tenía la cita original.">
        <Toggle
          value={s.requireSameDentist}
          onChange={(v) => setS({ ...s, requireSameDentist: v })}
        />
      </Row>

      <Row
        label="Respetar ventana horaria del paciente"
        hint="Si el paciente solo puede en cierta franja horaria, no ofrecer fuera de esa franja."
      >
        <Toggle value={s.respectTimeWindow} onChange={(v) => setS({ ...s, respectTimeWindow: v })} />
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
    <div className="flex items-start justify-between gap-6">
      <div className="flex-1">
        <div className="text-sm font-medium text-zinc-900">{label}</div>
        {hint ? <div className="text-xs text-zinc-500 mt-0.5">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
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
      className="w-28 rounded-md border border-zinc-200 px-3 py-1.5 text-sm bg-white text-right"
      value={value}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
