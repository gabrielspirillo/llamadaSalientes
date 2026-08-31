'use client';

import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  Check,
  MessageCircle,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'futura:welcome-tour:v1';

type Slide = {
  icon: LucideIcon;
  tint: string; // clases del círculo del ícono
  title: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    icon: Sparkles,
    tint: 'bg-gradient-to-br from-violet-500 to-fuchsia-500',
    title: '¡Bienvenido a Futura! 🎉',
    body: 'Tu recepcionista con inteligencia artificial: atiende llamadas y WhatsApp por vos, las 24 horas. Te muestro en 1 minuto todo lo que puede hacer.',
  },
  {
    icon: Bot,
    tint: 'bg-gradient-to-br from-violet-500 to-indigo-500',
    title: 'Tu Agente',
    body: 'Es el cerebro de todo. Desde acá configurás cómo habla: su tono, el saludo, y a qué número transfiere cuando hace falta una persona.',
  },
  {
    icon: PhoneCall,
    tint: 'bg-gradient-to-br from-blue-500 to-cyan-500',
    title: 'Llamadas',
    body: 'El agente atiende las llamadas que entran a tu clínica y también llama a tus pacientes: recordatorios de turno, recuperar citas perdidas y más.',
  },
  {
    icon: MessageCircle,
    tint: 'bg-gradient-to-br from-emerald-500 to-teal-500',
    title: 'WhatsApp',
    body: 'Además de llamar, tu agente conversa por WhatsApp con tus pacientes: responde dudas, confirma turnos y deriva a tu equipo cuando conviene.',
  },
  {
    icon: Stethoscope,
    tint: 'bg-gradient-to-br from-rose-500 to-pink-500',
    title: 'Tu clínica',
    body: 'Cargá tus tratamientos, horarios de atención y preguntas frecuentes. El agente usa toda esa información para responder bien y agendar.',
  },
  {
    icon: BellRing,
    tint: 'bg-gradient-to-br from-amber-500 to-orange-500',
    title: 'Seguimiento automático',
    body: 'Recordatorios de turno automáticos, lista de espera para llenar los huecos que se liberan, y todos tus pacientes ordenados en Contactos.',
  },
  {
    icon: BarChart3,
    tint: 'bg-gradient-to-br from-indigo-500 to-violet-500',
    title: 'Resultados a la vista',
    body: 'En Analytics ves métricas reales: cuántas llamadas atendió el agente, turnos agendados, sentimiento de los pacientes y mucho más.',
  },
  {
    icon: Users,
    tint: 'bg-gradient-to-br from-cyan-500 to-blue-500',
    title: 'Tu equipo',
    body: 'Invitá a las personas de tu clínica desde Equipo, cada una con su rol. Trabajen todos sobre el mismo panel.',
  },
  {
    icon: ShieldCheck,
    tint: 'bg-gradient-to-br from-emerald-500 to-green-500',
    title: 'Nosotros lo activamos',
    body: 'Las conexiones técnicas (teléfono, WhatsApp, agenda) las deja listas el equipo de Futura. Vos ocupate de tu clínica; de lo técnico nos encargamos nosotros.',
  },
];

export function WelcomeTour({ autoStart = false }: { autoStart?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-apertura solo la primera vez (por navegador).
  useEffect(() => {
    if (!autoStart) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setStep(0);
        setOpen(true);
      }
    } catch {
      // sin localStorage (modo privado): no autolanzamos.
    }
  }, [autoStart]);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // no-op
    }
  }, []);

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [markSeen]);

  const last = SLIDES.length - 1;
  const next = useCallback(() => {
    setStep((s) => {
      if (s >= last) {
        close();
        return s;
      }
      return s + 1;
    });
  }, [last, close]);
  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Teclado: Esc cierra, flechas navegan.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, next, back]);

  // Reabrir el tour desde cualquier lado (ej. botón 'Tutorial' del menú) vía
  // un evento global, para no acoplar componentes.
  useEffect(() => {
    function onOpen() {
      setStep(0);
      setOpen(true);
    }
    window.addEventListener('futura:open-tour', onOpen);
    return () => window.removeEventListener('futura:open-tour', onOpen);
  }, []);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-[fade-in_150ms_ease-out]"
          role="dialog"
          aria-modal="true"
          aria-label="Tutorial de bienvenida"
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Cerrar tutorial"
            onClick={close}
            className="absolute inset-0 cursor-default bg-zinc-900/60 backdrop-blur-sm"
          />

          {/* Card */}
          <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl">
            <button
              type="button"
              onClick={close}
              aria-label="Cerrar"
              className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Escena animada del ícono */}
            <div className="relative flex h-52 items-center justify-center overflow-hidden bg-gradient-to-b from-zinc-50 to-white">
              {SLIDES.map((s, i) => {
                const Icon = s.icon;
                const active = i === step;
                return (
                  <div
                    key={s.title}
                    className={`absolute transition-all duration-500 ease-out ${
                      active
                        ? 'scale-100 opacity-100 blur-0'
                        : 'pointer-events-none scale-75 opacity-0 blur-sm'
                    }`}
                  >
                    <span
                      className={`inline-flex h-24 w-24 items-center justify-center rounded-3xl text-white shadow-lg ${s.tint} ${
                        active ? 'animate-[float_3s_ease-in-out_infinite]' : ''
                      }`}
                    >
                      <Icon className="h-11 w-11" />
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Texto (cambia con animación por step) */}
            <div key={step} className="animate-[fade-in_300ms_ease-out] px-7 pb-2 pt-5 text-center">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
                {SLIDES[step]?.title}
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-600">
                {SLIDES[step]?.body}
              </p>
            </div>

            {/* Progreso */}
            <div className="flex items-center justify-center gap-1.5 py-4">
              {SLIDES.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  aria-label={`Ir al paso ${i + 1}`}
                  onClick={() => setStep(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? 'w-5 bg-violet-600' : 'w-1.5 bg-zinc-200 hover:bg-zinc-300'
                  }`}
                />
              ))}
            </div>

            {/* Navegación */}
            <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-6 py-4">
              {step === 0 ? (
                <button
                  type="button"
                  onClick={close}
                  className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800"
                >
                  Saltar
                </button>
              ) : (
                <Button variant="ghost" size="sm" type="button" onClick={back}>
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </Button>
              )}

              <span className="text-xs text-zinc-400">
                {step + 1} / {SLIDES.length}
              </span>

              <Button size="sm" type="button" onClick={next}>
                {step === last ? (
                  <>
                    <Check className="h-4 w-4" /> Empezar
                  </>
                ) : (
                  <>
                    Siguiente <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
