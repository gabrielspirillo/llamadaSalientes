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
import { useClerk } from '@clerk/nextjs';
import { ArrowLeft, ArrowRight, Check, Loader2, LogOut } from 'lucide-react';
import * as React from 'react';

const STEPS = [
  { n: 1, title: 'Datos de la clínica' },
  { n: 2, title: 'Horarios' },
  { n: 3, title: 'Tratamientos' },
  { n: 4, title: 'Preguntas frecuentes' },
  { n: 5, title: 'El asistente' },
  { n: 6, title: 'Revisión y envío' },
] as const;

export function OnboardingWizard({
  tenant,
  onboardingKey,
  selfRegister = false,
  authenticated = false,
}: {
  tenant: string;
  onboardingKey: string;
  // Modo link único (retirado como alta): no hay tenant en la URL.
  selfRegister?: boolean;
  // Modo logueado: la clínica ya tiene sesión; guarda sobre SU tenant vía el
  // endpoint autenticado y al terminar va al dashboard.
  authenticated?: boolean;
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

  // En el paso 1 no hay "atrás": ofrecemos "Salir" para cerrar sesión y volver
  // al inicio (por si se registraron con el mail equivocado).
  const { signOut } = useClerk();
  const exit = () => signOut({ redirectUrl: '/' });

  const submit = async () => {
    if (!confirmed) {
      setConfirmError('Marca la casilla para confirmar antes de enviar.');
      return;
    }
    setConfirmError(undefined);
    setSubmitError(undefined);
    setSubmitting(true);

    const payload = toPayload(form, tenant);
    try {
      let url: string;
      if (authenticated) {
        // Modo logueado: guarda sobre el tenant de la sesión (sin tenant/key).
        url = '/api/onboarding/complete';
      } else {
        const params = new URLSearchParams();
        if (tenant) params.set('tenant', tenant);
        if (onboardingKey) params.set('key', onboardingKey);
        const qs = params.toString();
        url = `/api/public/onboarding${qs ? `?${qs}` : ''}`;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? 'No hemos podido enviar los datos. Inténtalo de nuevo.');
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
      setSubmitError(err instanceof Error ? err.message : 'Ha ocurrido un error inesperado.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return <SuccessScreen payload={success} authenticated={authenticated} />;
  }

  // Link sin tenant, sin auto-registro y sin sesión → link incompleto.
  if (!tenant && !selfRegister && !authenticated) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-[26px] font-extrabold tracking-tight text-zinc-900">
          Enlace incompleto
        </h1>
        <p className="mt-2 text-[16px] leading-relaxed text-zinc-500">
          Este enlace no identifica a ninguna clínica. Pídenos el enlace correcto para completar tus
          datos.
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
        <div className="mb-6 flex items-center gap-1.5">
          <span className="text-[23px] font-extrabold leading-none tracking-tight text-[#0f1f2e]">
            FUTURA
          </span>
          <span className="inline-block h-2 w-2 rounded-full bg-[#5fa896]" />
          <span className="mx-0.5 text-zinc-300">·</span>
          <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Alta de clínica
          </span>
        </div>

        {/* Pasos: puntos conectados que se llenan al avanzar */}
        <ol className="mb-5 flex items-center gap-1.5" aria-label="Progreso del alta">
          {STEPS.map((st) => {
            const done = st.n < step;
            const active = st.n === step;
            return (
              <li key={st.n} className="flex flex-1 items-center gap-1.5">
                <span
                  title={st.title}
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-all duration-500 ${
                    done
                      ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white'
                      : active
                        ? 'bg-white text-brand-700 ring-2 ring-brand-400 animate-pulse-ring'
                        : 'bg-white/70 text-zinc-400 ring-1 ring-[--color-border]'
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : st.n}
                </span>
                {st.n < STEPS.length && (
                  <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-zinc-200">
                    <span
                      className="block h-full rounded-full bg-[linear-gradient(90deg,#37766a,#6bc2a4)] transition-transform duration-500 ease-out"
                      style={{
                        transform: `scaleX(${done ? 1 : 0})`,
                        transformOrigin: 'left center',
                      }}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <div>
          <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-500">
            Paso {step} de {STEPS.length} · {progress}%
          </p>
          <h1 className="mt-1 text-[29px] font-extrabold tracking-tight text-zinc-900 sm:text-[34px]">
            {current.title}
          </h1>
        </div>
      </header>

      {/* Contenido del paso */}
      <main key={step} className="flex-1 animate-fade-up">
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
        <p className="mt-4 animate-fade-up rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-3 text-[16px] text-rose-700">
          {submitError}
        </p>
      )}

      {/* Navegación */}
      <footer className="sticky bottom-0 mt-8 flex items-center justify-between gap-3 rounded-t-[22px] border-t border-[--color-border-subtle] bg-white/80 py-4 backdrop-blur-xl">
        {step === 1 ? (
          <Button variant="ghost" onClick={exit} disabled={submitting} type="button">
            <LogOut className="h-4 w-4" /> Salir
          </Button>
        ) : (
          <Button variant="ghost" onClick={back} disabled={submitting} type="button">
            <ArrowLeft className="h-4 w-4" /> Atrás
          </Button>
        )}

        {step < STEPS.length ? (
          <Button onClick={next} type="button">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting} type="button">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Enviando…' : 'Enviar datos'}
          </Button>
        )}
      </footer>
    </div>
  );
}
