'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  DAYS,
  DAY_LABELS,
  type OnboardingForm,
  type OnboardingPayload,
} from '@/lib/onboarding/schema';
import { Check, Download, Pencil } from 'lucide-react';
import type * as React from 'react';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-900">{value || <em className="text-zinc-400">—</em>}</span>
    </div>
  );
}

function SectionCard({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/70 bg-white p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline"
        >
          <Pencil className="h-3 w-3" /> Editar
        </button>
      </div>
      <div className="divide-y divide-zinc-100">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — Revisión
// ─────────────────────────────────────────────────────────────────────────────

export function ReviewStep({
  form,
  goToStep,
  confirmed,
  setConfirmed,
  confirmError,
}: {
  form: OnboardingForm;
  goToStep: (step: number) => void;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  confirmError?: string;
}) {
  const { clinic, agent } = form;
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Datos de la clínica" onEdit={() => goToStep(1)}>
        <Row label="Nombre" value={clinic.name} />
        <Row label="Dirección" value={clinic.address} />
        <Row label="Teléfonos" value={clinic.phones.filter(Boolean).join(' · ')} />
        <Row label="Zona horaria" value={clinic.timezone} />
        <Row label="Idioma" value={clinic.defaultLanguage === 'es' ? 'Español' : 'English'} />
        <Row label="Email de contacto" value={clinic.contactEmail} />
      </SectionCard>

      <SectionCard title="Horarios" onEdit={() => goToStep(2)}>
        {DAYS.map((day) => {
          const row = form.hours[day];
          return (
            <Row
              key={day}
              label={DAY_LABELS[day]}
              value={row.enabled ? `${row.open} – ${row.close}` : 'Cerrado'}
            />
          );
        })}
      </SectionCard>

      <SectionCard title={`Tratamientos (${form.treatments.length})`} onEdit={() => goToStep(3)}>
        {form.treatments.map((t, i) => (
          <Row
            key={t.id}
            label={t.name || `Tratamiento ${i + 1}`}
            value={
              [
                t.durationMinutes && `${t.durationMinutes} min`,
                (t.priceMin || t.priceMax) && `${t.priceMin || '?'}–${t.priceMax || '?'} €`,
                t.priceReferencial && `ref. ${t.priceReferencial} €`,
              ]
                .filter(Boolean)
                .join(' · ') || '—'
            }
          />
        ))}
      </SectionCard>

      {form.faqs.length > 0 && (
        <SectionCard title={`FAQs (${form.faqs.length})`} onEdit={() => goToStep(4)}>
          {form.faqs.map((f, i) => (
            <Row key={f.id} label={f.category || `FAQ ${i + 1}`} value={f.question} />
          ))}
        </SectionCard>
      )}

      <SectionCard title="El agente" onEdit={() => goToStep(5)}>
        <Row label="Nombre" value={agent.name} />
        <Row label="Tono / instrucciones" value={agent.tone} />
        <Row label="Mensaje fuera de horario" value={agent.afterHoursMessage} />
        <Row label="Transferencia a humano" value={agent.transferNumber} />
        <Row label="Consentimiento de grabación" value={agent.recordingConsentText} />
      </SectionCard>

      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-2xl border p-4',
          confirmError ? 'border-red-300 bg-red-50/40' : 'border-zinc-200/70 bg-white',
        )}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(ev) => setConfirmed(ev.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-violet-600"
        />
        <span className="text-sm text-zinc-800">
          Confirmo que los datos son correctos.
          {confirmError && <span className="mt-1 block text-xs text-red-600">{confirmError}</span>}
        </span>
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Descargar copia (JSON) — sin dependencias
// ─────────────────────────────────────────────────────────────────────────────

export function downloadCopy(payload: OnboardingPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `onboarding-${payload.tenant || 'clinica'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla de confirmación
// ─────────────────────────────────────────────────────────────────────────────

export function SuccessScreen({ payload }: { payload: OnboardingPayload }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600">
        <Check className="h-7 w-7 text-white" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        ¡Listo! Recibimos los datos de {payload.clinic.name}
      </h1>
      <p className="mt-2 text-zinc-500">
        Nuestro equipo lo revisa y activa tu agente. Te avisamos a{' '}
        <span className="font-medium text-zinc-700">{payload.clinic.contactEmail}</span>.
      </p>

      <div className="mt-8 w-full rounded-2xl border border-zinc-200/70 bg-white p-5 text-left">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Resumen de lo que cargaste</h2>
        <div className="divide-y divide-zinc-100">
          <Row label="Clínica" value={payload.clinic.name} />
          <Row label="Dirección" value={payload.clinic.address} />
          <Row label="Teléfonos" value={payload.clinic.phones.join(' · ')} />
          <Row label="Tratamientos" value={`${payload.treatments.length} cargados`} />
          <Row label="FAQs" value={`${payload.faqs.length} cargadas`} />
          <Row label="Transferencia a humano" value={payload.agent.transferNumber} />
        </div>
      </div>

      <Button variant="secondary" className="mt-6" onClick={() => downloadCopy(payload)}>
        <Download className="h-4 w-4" /> Descargar copia (JSON)
      </Button>
    </div>
  );
}
