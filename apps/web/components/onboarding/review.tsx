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
      <span className="text-sm text-zinc-900">{value || <em className="text-zinc-500">—</em>}</span>
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
    <div className="rounded-2xl border border-[--color-border] bg-white p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
        >
          <Pencil className="h-3 w-3" /> Editar
        </button>
      </div>
      <div className="divide-y divide-[--color-border-subtle]">{children}</div>
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
        <Row label="Correo de contacto" value={clinic.contactEmail} />
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
        <SectionCard
          title={`Preguntas frecuentes (${form.faqs.length})`}
          onEdit={() => goToStep(4)}
        >
          {form.faqs.map((f, i) => (
            <Row key={f.id} label={f.category || `Pregunta ${i + 1}`} value={f.question} />
          ))}
        </SectionCard>
      )}

      <SectionCard title="El asistente" onEdit={() => goToStep(5)}>
        <Row label="Nombre" value={agent.name} />
        <Row label="Tono / instrucciones" value={agent.tone} />
        <Row label="Mensaje fuera de horario" value={agent.afterHoursMessage} />
        <Row label="Número al que pasar la llamada" value={agent.transferNumber} />
        <Row label="Consentimiento de grabación" value={agent.recordingConsentText} />
      </SectionCard>

      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-2xl border p-4',
          confirmError ? 'border-red-300 bg-rose-50/40' : 'border-[--color-border] bg-white',
        )}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(ev) => setConfirmed(ev.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-brand-600"
        />
        <span className="text-sm text-zinc-800">
          Confirmo que los datos son correctos.
          {confirmError && <span className="mt-1 block text-xs text-rose-600">{confirmError}</span>}
        </span>
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Descargar PDF — resumen estético vía print del navegador (sin dependencias)
// ─────────────────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function priceLabel(t: OnboardingPayload['treatments'][number]) {
  const min = t.priceMin != null ? `${t.priceMin}€` : '';
  const max = t.priceMax != null ? `${t.priceMax}€` : '';
  if (min && max) return `${min}–${max}`;
  return min || max || '';
}

function buildOnboardingHtml(payload: OnboardingPayload) {
  const { clinic, hours, treatments, faqs, agent } = payload;
  const langLabel = clinic.defaultLanguage === 'en' ? 'English' : 'Español';

  const hoursRows = DAYS.map((day) => {
    const h = hours[day];
    const val = h ? `${h.open} – ${h.close}` : 'Cerrado';
    return `<tr><td class="d">${esc(DAY_LABELS[day])}</td><td class="${h ? '' : 'muted'}">${esc(val)}</td></tr>`;
  }).join('');

  const treatmentRows = treatments
    .map((t) => {
      const price = priceLabel(t);
      return `<div class="item"><div class="item-head"><span class="item-name">${esc(t.name)}</span><span class="pill">${t.durationMinutes} min</span>${price ? `<span class="price">${esc(price)}</span>` : ''}</div>${t.description ? `<div class="item-desc">${esc(t.description)}</div>` : ''}</div>`;
    })
    .join('');

  const faqRows = faqs.length
    ? faqs
        .map(
          (f) =>
            `<div class="item"><div class="item-name">${esc(f.question)}${f.category ? ` <span class="tag">${esc(f.category)}</span>` : ''}</div><div class="item-desc">${esc(f.answer)}</div></div>`,
        )
        .join('')
    : '<div class="muted">No se han añadido preguntas.</div>';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Alta de clínica — ${esc(clinic.name)}</title><style>
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0f1f2e;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:720px;margin:0 auto;padding:40px 40px 56px}
.brand{display:flex;align-items:center;gap:8px}
.brand .name{font-weight:800;letter-spacing:-.02em;font-size:20px}
.brand .dot{width:9px;height:9px;border-radius:9999px;background:#5fa896;display:inline-block}
.brand .sep{color:#cbd2d9}
.brand .kicker{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#7c8894}
h1{font-size:26px;letter-spacing:-.02em;margin:22px 0 2px}
.sub{color:#6b7580;font-size:13px;margin:0 0 26px}
section{margin-top:24px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#7c8894;margin:0 0 10px}
.card{border:1px solid #eceef1;border-radius:14px;padding:16px 18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}
.field .k{font-size:11px;color:#98a2ad}
.field .v{font-size:14px;color:#0f1f2e}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:7px 0;border-bottom:1px solid #f1f3f5}
td.d{color:#6b7580;width:130px}
.muted{color:#a7b0b8}
.item{padding:10px 0;border-bottom:1px solid #f1f3f5}
.item:last-child{border-bottom:0}
.item-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.item-name{font-weight:600;font-size:14px}
.item-desc{color:#6b7580;font-size:13px;margin-top:3px}
.pill{font-size:11px;font-weight:600;color:#6d28d9;background:#f3f0ff;border-radius:9999px;padding:2px 8px}
.price{font-size:13px;color:#0f1f2e;font-weight:600}
.tag{font-size:10px;font-weight:600;color:#5a6b8c;background:#eef1f6;border-radius:9999px;padding:1px 6px;text-transform:uppercase;letter-spacing:.04em}
.foot{margin-top:40px;text-align:center;color:#b3bcc4;font-size:11px}
@page{margin:16mm}
</style></head><body><div class="wrap">
<div class="brand"><span class="name">FUTURA</span><span class="dot"></span><span class="sep">·</span><span class="kicker">Formulario de alta</span></div>
<h1>${esc(clinic.name)}</h1>
<p class="sub">Datos enviados para activar el asistente de voz.</p>
<section><h2>Clínica</h2><div class="card grid">
<div class="field"><div class="k">Dirección</div><div class="v">${esc(clinic.address)}</div></div>
<div class="field"><div class="k">Teléfonos</div><div class="v">${esc(clinic.phones.join(' · '))}</div></div>
<div class="field"><div class="k">Correo de contacto</div><div class="v">${esc(clinic.contactEmail)}</div></div>
<div class="field"><div class="k">Zona horaria</div><div class="v">${esc(clinic.timezone)}</div></div>
<div class="field"><div class="k">Idioma del asistente</div><div class="v">${esc(langLabel)}</div></div>
</div></section>
<section><h2>Horarios</h2><div class="card"><table>${hoursRows}</table></div></section>
<section><h2>Tratamientos (${treatments.length})</h2><div class="card">${treatmentRows}</div></section>
<section><h2>Preguntas frecuentes (${faqs.length})</h2><div class="card">${faqRows}</div></section>
<section><h2>El asistente</h2><div class="card grid">
${agent.name ? `<div class="field"><div class="k">Nombre del asistente</div><div class="v">${esc(agent.name)}</div></div>` : ''}
<div class="field"><div class="k">Número al que pasar la llamada</div><div class="v">${esc(agent.transferNumber)}</div></div>
${agent.tone ? `<div class="field"><div class="k">Tono / instrucciones</div><div class="v">${esc(agent.tone)}</div></div>` : ''}
${agent.afterHoursMessage ? `<div class="field"><div class="k">Mensaje fuera de horario</div><div class="v">${esc(agent.afterHoursMessage)}</div></div>` : ''}
<div class="field"><div class="k">Consentimiento de grabación</div><div class="v">${esc(agent.recordingConsentText)}</div></div>
</div></section>
<div class="foot">Generado desde app.futuradigital.es · Futura</div>
</div></body></html>`;
}

export function downloadPdf(payload: OnboardingPayload) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(buildOnboardingHtml(payload));
  doc.close();

  const cleanup = () => setTimeout(() => iframe.remove(), 500);
  // Damos un margen a que renderice el HTML (todo inline, sin assets externos).
  setTimeout(() => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    setTimeout(cleanup, 60000); // fallback si onafterprint no dispara
  }, 350);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla de confirmación
// ─────────────────────────────────────────────────────────────────────────────

export function SuccessScreen({
  payload,
  authenticated = false,
}: {
  payload: OnboardingPayload;
  authenticated?: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#37766a,#5fa896)]">
        <Check className="h-7 w-7 text-white" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Listo. Hemos recibido los datos de {payload.clinic.name}
      </h1>
      <p className="mt-2 text-zinc-500">
        {authenticated
          ? 'Revisamos los datos y activamos tu asistente. Ya puedes entrar al panel.'
          : 'Revisamos los datos y activamos tu asistente.'}{' '}
        {payload.clinic.contactEmail && (
          <>
            Te avisamos a{' '}
            <span className="font-medium text-zinc-700">{payload.clinic.contactEmail}</span>.
          </>
        )}
      </p>

      <div className="mt-8 w-full rounded-2xl border border-[--color-border] bg-white p-5 text-left">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Resumen de lo que has enviado</h2>
        <div className="divide-y divide-[--color-border-subtle]">
          <Row label="Clínica" value={payload.clinic.name} />
          <Row label="Dirección" value={payload.clinic.address} />
          <Row label="Teléfonos" value={payload.clinic.phones.join(' · ')} />
          <Row label="Tratamientos" value={`${payload.treatments.length} añadidos`} />
          <Row label="Preguntas frecuentes" value={`${payload.faqs.length} añadidas`} />
          <Row label="Número al que pasar la llamada" value={payload.agent.transferNumber} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {authenticated && (
          <Button type="button" onClick={() => window.location.assign('/dashboard')}>
            Ir al panel
          </Button>
        )}
        <Button variant="secondary" type="button" onClick={() => downloadPdf(payload)}>
          <Download className="h-4 w-4" /> Descargar PDF
        </Button>
      </div>
    </div>
  );
}
