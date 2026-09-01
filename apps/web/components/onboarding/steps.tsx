'use client';

import { CharCount, Field, IconTextButton, Select } from '@/components/onboarding/fields';
import type { Errors } from '@/components/onboarding/validation';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  DAYS,
  DAY_LABELS,
  FAQ_CATEGORIES,
  LANGUAGE_OPTIONS,
  type OnboardingForm,
  TIMEZONE_OPTIONS,
  emptyFaq,
  emptyTreatment,
} from '@/lib/onboarding/schema';
import { ChevronDown, Copy, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

export type StepProps = {
  form: OnboardingForm;
  mutate: (fn: (draft: OnboardingForm) => void) => void;
  errors: Errors;
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Datos de la clínica
// ─────────────────────────────────────────────────────────────────────────────

export function StepClinic({ form, mutate, errors }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field
        label="Nombre de la clínica"
        required
        htmlFor="clinic-name"
        error={errors['clinic.name']}
      >
        <Input
          id="clinic-name"
          value={form.clinic.name}
          onChange={(ev) =>
            mutate((d) => {
              d.clinic.name = ev.target.value;
            })
          }
          placeholder="Ej: Clínica Dental Sonrisa"
        />
      </Field>

      <Field label="Dirección" required htmlFor="clinic-address" error={errors['clinic.address']}>
        <Input
          id="clinic-address"
          value={form.clinic.address}
          onChange={(ev) =>
            mutate((d) => {
              d.clinic.address = ev.target.value;
            })
          }
          placeholder="Calle, número, ciudad"
        />
      </Field>

      <Field label="Teléfonos de contacto" required error={errors['clinic.phones']}>
        <div className="flex flex-col gap-2">
          {form.clinic.phones.map((phone, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={phone}
                inputMode="tel"
                onChange={(ev) =>
                  mutate((d) => {
                    d.clinic.phones[i] = ev.target.value;
                  })
                }
                placeholder="+34 611 22 33 44"
              />
              {form.clinic.phones.length > 1 && (
                <button
                  type="button"
                  aria-label="Eliminar teléfono"
                  onClick={() => mutate((d) => d.clinic.phones.splice(i, 1))}
                  className="shrink-0 rounded-full p-2.5 text-zinc-400 hover:bg-zinc-100 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <IconTextButton onClick={() => mutate((d) => d.clinic.phones.push(''))}>
            <Plus className="h-3.5 w-3.5" /> Agregar teléfono
          </IconTextButton>
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Field label="Zona horaria" required htmlFor="clinic-tz" error={errors['clinic.timezone']}>
          <Select
            id="clinic-tz"
            value={form.clinic.timezone}
            onChange={(ev) =>
              mutate((d) => {
                d.clinic.timezone = ev.target.value;
              })
            }
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Idioma del agente" required htmlFor="clinic-lang">
          <Select
            id="clinic-lang"
            value={form.clinic.defaultLanguage}
            onChange={(ev) =>
              mutate((d) => {
                d.clinic.defaultLanguage = ev.target.value as 'es' | 'en';
              })
            }
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Email de contacto"
        required
        htmlFor="clinic-email"
        error={errors['clinic.contactEmail']}
      >
        <Input
          id="clinic-email"
          type="email"
          value={form.clinic.contactEmail}
          onChange={(ev) =>
            mutate((d) => {
              d.clinic.contactEmail = ev.target.value;
            })
          }
          placeholder="contacto@tuclinica.com"
        />
      </Field>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Horarios de atención
// ─────────────────────────────────────────────────────────────────────────────

export function StepHours({ form, mutate, errors }: StepProps) {
  const copyMondayToAll = () =>
    mutate((d) => {
      const mon = d.hours.monday;
      for (const day of DAYS) {
        d.hours[day] = { ...mon };
      }
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={copyMondayToAll} type="button">
          <Copy className="h-3.5 w-3.5" /> Copiar Lunes a todos
        </Button>
      </div>

      <div className="flex flex-col divide-y divide-[--color-border-subtle]">
        {DAYS.map((day) => {
          const row = form.hours[day];
          return (
            <div key={day} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 w-32 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(ev) =>
                      mutate((d) => {
                        d.hours[day].enabled = ev.target.checked;
                      })
                    }
                    className="h-4 w-4 rounded border-zinc-300 accent-violet-600"
                  />
                  <span className="text-sm font-medium text-zinc-800">{DAY_LABELS[day]}</span>
                </label>

                {row.enabled ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={row.open}
                      onChange={(ev) =>
                        mutate((d) => {
                          d.hours[day].open = ev.target.value;
                        })
                      }
                      className="w-28"
                    />
                    <span className="text-zinc-400 text-sm">a</span>
                    <Input
                      type="time"
                      value={row.close}
                      onChange={(ev) =>
                        mutate((d) => {
                          d.hours[day].close = ev.target.value;
                        })
                      }
                      className="w-28"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-zinc-400">Cerrado</span>
                )}
              </div>
              {errors[`hours.${day}`] && (
                <p className="text-xs text-rose-600 pl-0 sm:pl-[8.5rem]">{errors[`hours.${day}`]}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Tratamientos
// ─────────────────────────────────────────────────────────────────────────────

export function StepTreatments({ form, mutate, errors }: StepProps) {
  const [openIdx, setOpenIdx] = React.useState<number>(0);

  const updateT = (i: number, patch: Partial<OnboardingForm['treatments'][number]>) =>
    mutate((d) => {
      const it = d.treatments[i];
      if (it) Object.assign(it, patch);
    });

  return (
    <div className="flex flex-col gap-3">
      {errors.treatments && <p className="text-xs text-rose-600">{errors.treatments}</p>}

      {form.treatments.map((t, i) => {
        const isOpen = openIdx === i;
        const hasError = Object.keys(errors).some((k) => k.startsWith(`treatments.${i}.`));
        return (
          <div
            key={t.id}
            className={cn(
              'rounded-2xl border bg-white',
              hasError ? 'border-rose-200' : 'border-[--color-border]',
            )}
          >
            <div className="flex items-center gap-2 p-3.5">
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? -1 : i)}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-zinc-400 transition-transform',
                    isOpen && 'rotate-180',
                  )}
                />
                <span className="text-sm font-medium text-zinc-800">
                  {t.name.trim() || `Tratamiento ${i + 1}`}
                </span>
              </button>
              {form.treatments.length > 1 && (
                <button
                  type="button"
                  aria-label="Eliminar tratamiento"
                  onClick={() => {
                    mutate((d) => d.treatments.splice(i, 1));
                    setOpenIdx(0);
                  }}
                  className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {isOpen && (
              <div className="flex flex-col gap-4 border-t border-[--color-border-subtle] p-4">
                <Field label="Nombre" required error={errors[`treatments.${i}.name`]}>
                  <Input
                    value={t.name}
                    onChange={(ev) => updateT(i, { name: ev.target.value })}
                    placeholder="Ej: Limpieza dental"
                  />
                </Field>
                <Field label="Descripción">
                  <Textarea
                    className="min-h-[80px]"
                    value={t.description}
                    onChange={(ev) => updateT(i, { description: ev.target.value })}
                    placeholder="Opcional"
                  />
                </Field>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field
                    label="Duración (min)"
                    required
                    error={errors[`treatments.${i}.durationMinutes`]}
                  >
                    <Input
                      inputMode="numeric"
                      value={t.durationMinutes}
                      onChange={(ev) => updateT(i, { durationMinutes: ev.target.value })}
                      placeholder="30"
                    />
                  </Field>
                  <Field label="Precio mín €" error={errors[`treatments.${i}.priceMin`]}>
                    <Input
                      inputMode="decimal"
                      value={t.priceMin}
                      onChange={(ev) => updateT(i, { priceMin: ev.target.value })}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Precio máx €" error={errors[`treatments.${i}.priceMax`]}>
                    <Input
                      inputMode="decimal"
                      value={t.priceMax}
                      onChange={(ev) => updateT(i, { priceMax: ev.target.value })}
                      placeholder="0"
                    />
                  </Field>
                  <Field
                    label="Precio ref. €"
                    error={errors[`treatments.${i}.priceReferencial`]}
                    hint="Se usa para calcular el revenue recuperado; vacío si no querés contabilizarlo."
                  >
                    <Input
                      inputMode="decimal"
                      value={t.priceReferencial}
                      onChange={(ev) => updateT(i, { priceReferencial: ev.target.value })}
                      placeholder="0"
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <IconTextButton
        onClick={() => {
          mutate((d) => d.treatments.push(emptyTreatment()));
          setOpenIdx(form.treatments.length);
        }}
      >
        <Plus className="h-3.5 w-3.5" /> Agregar tratamiento
      </IconTextButton>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — FAQs (opcional)
// ─────────────────────────────────────────────────────────────────────────────

export function StepFaqs({ form, mutate, errors }: StepProps) {
  const updateF = (i: number, patch: Partial<OnboardingForm['faqs'][number]>) =>
    mutate((d) => {
      const it = d.faqs[i];
      if (it) Object.assign(it, patch);
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500">
        Opcional. Cargá las preguntas frecuentes que quieras que el agente sepa responder.
      </p>

      {form.faqs.map((f, i) => {
        const hasError = Object.keys(errors).some((k) => k.startsWith(`faqs.${i}.`));
        return (
          <div
            key={f.id}
            className={cn(
              'flex flex-col gap-4 rounded-2xl border bg-white p-4',
              hasError ? 'border-rose-200' : 'border-[--color-border]',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-800">FAQ {i + 1}</span>
              <button
                type="button"
                aria-label="Eliminar FAQ"
                onClick={() => mutate((d) => d.faqs.splice(i, 1))}
                className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-rose-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <Field label="Categoría">
              <Input
                list="faq-categories"
                value={f.category}
                onChange={(ev) => updateF(i, { category: ev.target.value })}
                placeholder="Precios, Pagos, Ubicación…"
              />
            </Field>
            <Field label="Pregunta" required error={errors[`faqs.${i}.question`]}>
              <Input
                value={f.question}
                onChange={(ev) => updateF(i, { question: ev.target.value })}
                placeholder="¿Aceptan obra social?"
              />
            </Field>
            <Field label="Respuesta" required error={errors[`faqs.${i}.answer`]}>
              <Textarea
                className="min-h-[80px]"
                value={f.answer}
                onChange={(ev) => updateF(i, { answer: ev.target.value })}
                placeholder="Sí, trabajamos con las principales obras sociales…"
              />
            </Field>
          </div>
        );
      })}

      <datalist id="faq-categories">
        {FAQ_CATEGORIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <IconTextButton onClick={() => mutate((d) => d.faqs.push(emptyFaq()))}>
        <Plus className="h-3.5 w-3.5" /> Agregar FAQ
      </IconTextButton>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — El agente
// ─────────────────────────────────────────────────────────────────────────────

export function StepAgent({ form, mutate, errors }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Nombre del agente" htmlFor="agent-name" hint="Opcional. Ej: Sofía.">
        <Input
          id="agent-name"
          value={form.agent.name}
          onChange={(ev) =>
            mutate((d) => {
              d.agent.name = ev.target.value;
            })
          }
          placeholder="Sofía"
        />
      </Field>

      <Field label="Tono / instrucciones extra" htmlFor="agent-tone" error={errors['agent.tone']}>
        <Textarea
          id="agent-tone"
          value={form.agent.tone}
          maxLength={2000}
          onChange={(ev) =>
            mutate((d) => {
              d.agent.tone = ev.target.value;
            })
          }
          placeholder="Cercano y profesional. Tratá de usted. Nunca des precios exactos sin confirmar…"
        />
        <div className="flex justify-end">
          <CharCount value={form.agent.tone} max={2000} />
        </div>
      </Field>

      <Field label="Mensaje fuera de horario" htmlFor="agent-afterhours">
        <Textarea
          id="agent-afterhours"
          className="min-h-[80px]"
          value={form.agent.afterHoursMessage}
          onChange={(ev) =>
            mutate((d) => {
              d.agent.afterHoursMessage = ev.target.value;
            })
          }
          placeholder="Ahora estamos cerrados. Dejanos tu consulta y te contactamos apenas abramos."
        />
      </Field>

      <Field
        label="Número de transferencia a humano"
        required
        htmlFor="agent-transfer"
        hint="Formato internacional E.164, ej: +34611223344"
        error={errors['agent.transferNumber']}
      >
        <Input
          id="agent-transfer"
          inputMode="tel"
          value={form.agent.transferNumber}
          onChange={(ev) =>
            mutate((d) => {
              d.agent.transferNumber = ev.target.value;
            })
          }
          placeholder="+34611223344"
        />
      </Field>

      <Field
        label="Texto de consentimiento de grabación"
        required
        htmlFor="agent-consent"
        hint="Lo dice el agente al inicio de cada llamada"
        error={errors['agent.recordingConsentText']}
      >
        <Textarea
          id="agent-consent"
          value={form.agent.recordingConsentText}
          onChange={(ev) =>
            mutate((d) => {
              d.agent.recordingConsentText = ev.target.value;
            })
          }
        />
      </Field>
    </div>
  );
}
