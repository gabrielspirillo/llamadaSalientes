'use client';

import { ReviewStep, SuccessScreen } from '@/components/onboarding/review';
import {
  StepAgent,
  StepClinic,
  StepFaqs,
  StepHours,
  StepTreatments,
} from '@/components/onboarding/steps';
import { type Errors, validateStep } from '@/components/onboarding/validation';
import { Button } from '@/components/ui/button';
import {
  type OnboardingForm,
  type OnboardingPayload,
  STORAGE_KEY_PREFIX,
  defaultForm,
  toPayload,
} from '@/lib/onboarding/schema';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import * as React from 'react';

const STEPS = [
  { n: 1, title: 'Datos de la clínica' },
  { n: 2, title: 'Horarios' },
  { n: 3, title: 'Tratamientos' },
  { n: 4, title: 'FAQs' },
  { n: 5, title: 'El agente' },
  { n: 6, title: 'Revisión y envío' },
] as const;

export function OnboardingWizard({
  tenant,
  onboardingKey,
  selfRegister = false,
}: {
  tenant: string;
  onboardingKey: string;
  // Modo link único: no hay tenant en la URL; la clínica se crea al enviar.
  selfRegister?: boolean;
}) {
  const [form, setForm] = React.useState<OnboardingForm>(defaultForm);
  const [step, setStep] = React.useState(1);
  const [errors, setErrors] = React.useState<Errors>({});
  const [showErrors, setShowErrors] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [confirmError, setConfirmError] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string>();
  const [success, setSuccess] = React.useState<OnboardingPayload | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const storageKey = `${STORAGE_KEY_PREFIX}${tenant || 'default'}`;

  // Autosave: hidratar desde localStorage al montar.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<OnboardingForm>;
        setForm({ ...defaultForm(), ...saved });
      }
    } catch {
      // localStorage no disponible / JSON corrupto → arrancamos limpio.
    }
    setHydrated(true);
  }, [storageKey]);

  // Autosave: persistir en cada cambio (una vez hidratado).
  React.useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(form));
    } catch {
      // Sin localStorage (modo privado, etc.) — el wizard sigue funcionando.
    }
  }, [form, hydrated, storageKey]);

  const mutate = React.useCallback((fn: (draft: OnboardingForm) => void) => {
    setForm((prev) => {
      const draft = structuredClone(prev);
      fn(draft);
      return draft;
    });
  }, []);

  // Revalidar en vivo una vez que el usuario intentó avanzar en este paso.
  React.useEffect(() => {
    if (showErrors) setErrors(validateStep(step, form));
  }, [form, step, showErrors]);

  const goToStep = (n: number) => {
    setShowErrors(false);
    setErrors({});
    setStep(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    const stepErrors = validateStep(step, form);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      setShowErrors(true);
      return;
    }
    goToStep(Math.min(step + 1, STEPS.length));
  };

  const back = () => goToStep(Math.max(step - 1, 1));

  const submit = async () => {
    if (!confirmed) {
      setConfirmError('Marcá la casilla para confirmar antes de enviar.');
      return;
    }
    setConfirmError(undefined);
    setSubmitError(undefined);
    setSubmitting(true);

    const payload = toPayload(form, tenant);
    try {
      const params = new URLSearchParams();
      if (tenant) params.set('tenant', tenant);
      if (onboardingKey) params.set('key', onboardingKey);
      const qs = params.toString();
      const res = await fetch(`/api/public/onboarding${qs ? `?${qs}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? 'No pudimos enviar el onboarding. Reintentá en un momento.');
      }
      // Éxito: limpiar el borrador local y mostrar confirmación.
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignorar
      }
      setSuccess(payload);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      // Error: NO perdemos datos (siguen en el form + localStorage).
      setSubmitError(err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return <SuccessScreen payload={success} />;
  }

  // Link sin tenant y sin modo auto-registro → link incompleto.
  if (!tenant && !selfRegister) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Link incompleto</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Este link de onboarding no identifica a ninguna clínica. Pedinos el link correcto para
          completar tus datos.
        </p>
      </div>
    );
  }

  const progress = Math.round(((step - 1) / (STEPS.length - 1)) * 100);
  const current = STEPS[step - 1] ?? STEPS[0];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      {/* Header + progreso */}
      <header className="mb-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="text-[18px] font-extrabold leading-none tracking-tight text-[#0f1f2e]">
            FUTURA
          </span>
          <span className="inline-block h-2 w-2 rounded-full bg-[#5fa896]" />
          <span className="mx-0.5 text-zinc-300">·</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Formulario de onboarding
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-violet-700">
              Paso {step} de {STEPS.length}
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
              {current.title}
            </h1>
          </div>
        </div>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
          <div
            className="h-full rounded-full bg-violet-600 transition-all duration-300 ease-out"
            style={{ width: `${Math.max(progress, 4)}%` }}
          />
        </div>
      </header>

      {/* Contenido del paso */}
      <main key={step} className="flex-1 animate-fade-in">
        {step === 1 && <StepClinic form={form} mutate={mutate} errors={errors} />}
        {step === 2 && <StepHours form={form} mutate={mutate} errors={errors} />}
        {step === 3 && <StepTreatments form={form} mutate={mutate} errors={errors} />}
        {step === 4 && <StepFaqs form={form} mutate={mutate} errors={errors} />}
        {step === 5 && <StepAgent form={form} mutate={mutate} errors={errors} />}
        {step === 6 && (
          <ReviewStep
            form={form}
            goToStep={goToStep}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            confirmError={confirmError}
          />
        )}
      </main>

      {submitError && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
      )}

      {/* Navegación */}
      <footer className="mt-8 flex items-center justify-between gap-3 border-t border-zinc-100 pt-5">
        <Button variant="ghost" onClick={back} disabled={step === 1 || submitting} type="button">
          <ArrowLeft className="h-4 w-4" /> Atrás
        </Button>

        {step < STEPS.length ? (
          <Button onClick={next} type="button">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting} type="button">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Enviando…' : 'Enviar onboarding'}
          </Button>
        )}
      </footer>
    </div>
  );
}
