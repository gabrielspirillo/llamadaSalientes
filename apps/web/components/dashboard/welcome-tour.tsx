'use client';

import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  Check,
  ClipboardCheck,
  Contact,
  HelpCircle,
  MessageCircle,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const STORAGE_KEY = 'futura:welcome-tour:v2';

type Step = {
  target?: string; // selector del ítem real a iluminar; sin target = tarjeta centrada
  icon: LucideIcon;
  tint: string;
  eyebrow: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    icon: Sparkles,
    tint: 'bg-gradient-to-br from-brand-500 to-brand-500',
    eyebrow: 'Bienvenido',
    title: 'Conoce Futura en 1 minuto',
    body: 'Tu asistente con IA atiende las llamadas y los WhatsApp de la clínica las 24 horas del día. Te vamos señalando cada parte del menú para que sepas dónde está todo.',
  },
  {
    target: '[data-tour="/dashboard/tasks"]',
    icon: ClipboardCheck,
    tint: 'bg-gradient-to-br from-sky-500 to-blue-500',
    eyebrow: 'El día a día',
    title: 'Tareas',
    body: 'El tablero del equipo. Se llena solo: la llamada que quedó sin devolver, el paciente que no vino, el presupuesto parado, la apertura y el cierre de cada día.',
  },
  {
    target: '[data-tour="/dashboard/agent"]',
    icon: Bot,
    tint: 'bg-gradient-to-br from-brand-500 to-brand-500',
    eyebrow: 'El cerebro',
    title: 'Tu asistente',
    body: 'Aquí configuras cómo habla: su tono, el saludo y a qué número pasa la llamada cuando hace falta una persona.',
  },
  {
    target: '[data-tour="/dashboard/calls"]',
    icon: PhoneCall,
    tint: 'bg-gradient-to-br from-blue-500 to-cyan-500',
    eyebrow: 'Teléfono',
    title: 'Llamadas',
    body: 'El asistente atiende las llamadas que entran y también llama a tus pacientes para recordarles la cita o recuperar las que se cancelaron.',
  },
  {
    target: '[data-tour="/dashboard/messages"]',
    icon: MessageSquare,
    tint: 'bg-gradient-to-br from-[#37766a] to-[#6bc2a4]',
    eyebrow: 'Tu equipo',
    title: 'Mensajes',
    body: 'El chat interno de la clínica. Aquí caen solas las llamadas perdidas, los huecos que se liberan y los avisos del asistente, y cualquier mensaje se convierte en tarea con un clic.',
  },
  {
    target: '[data-tour="/dashboard/whatsapp"]',
    icon: MessageCircle,
    tint: 'bg-gradient-to-br from-emerald-500 to-teal-500',
    eyebrow: 'Mensajes',
    title: 'WhatsApp',
    body: 'Tu asistente también atiende por WhatsApp: responde dudas, confirma citas y avisa a tu equipo cuando hace falta.',
  },
  {
    target: '[data-tour="/dashboard/treatments"]',
    icon: Stethoscope,
    tint: 'bg-gradient-to-br from-rose-500 to-emerald-500',
    eyebrow: 'Tu clínica',
    title: 'Tratamientos',
    body: 'Añade lo que ofreces, con su duración y sus precios. El asistente los usa para responder y dar cita sin equivocarse.',
  },
  {
    target: '[data-tour="/dashboard/faqs"]',
    icon: HelpCircle,
    tint: 'bg-gradient-to-br from-amber-500 to-orange-500',
    eyebrow: 'Respuestas',
    title: 'Preguntas frecuentes',
    body: 'Las respuestas a lo que más os preguntan: precios, dirección, formas de pago. El asistente las usa tal cual.',
  },
  {
    target: '[data-tour="/dashboard/reminders"]',
    icon: BellRing,
    tint: 'bg-gradient-to-br from-orange-500 to-red-500',
    eyebrow: 'Automático',
    title: 'Recordatorios',
    body: 'Avisos de cita automáticos para reducir las citas no asistidas. Y una lista de espera con pacientes listos para ocupar los huecos que se liberen.',
  },
  {
    target: '[data-tour="/dashboard/contacts"]',
    icon: Contact,
    tint: 'bg-gradient-to-br from-sky-500 to-blue-500',
    eyebrow: 'Pacientes',
    title: 'Pacientes',
    body: 'Todos tus pacientes en un mismo sitio, con su historial de llamadas y conversaciones.',
  },
  {
    target: '[data-tour="/dashboard/analytics"]',
    icon: BarChart3,
    tint: 'bg-gradient-to-br from-brand-500 to-brand-500',
    eyebrow: 'Resultados',
    title: 'Métricas',
    body: 'Datos reales: cuántas llamadas ha atendido el asistente, cuántas citas se han dado y cómo valoran la atención tus pacientes.',
  },
  {
    target: '[data-tour="/dashboard/team"]',
    icon: Users,
    tint: 'bg-gradient-to-br from-cyan-500 to-blue-500',
    eyebrow: 'Tu gente',
    title: 'Equipo',
    body: 'Invita a las personas de tu clínica, cada una con su rol. Todas trabajan sobre el mismo panel.',
  },
  {
    icon: ShieldCheck,
    tint: 'bg-gradient-to-br from-emerald-500 to-green-500',
    eyebrow: 'Listo',
    title: 'De lo técnico nos encargamos nosotros',
    body: 'Las conexiones de teléfono, WhatsApp y agenda las deja funcionando el equipo de Futura. Tú ocúpate de tu clínica. ¿Dudas? Escríbenos cuando quieras.',
  },
];

type Rect = { top: number; left: number; width: number; height: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function WelcomeTour({ autoStart = false }: { autoStart?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    try {
      setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      // no-op
    }
  }, []);

  // Auto-apertura la primera vez (por navegador).
  useEffect(() => {
    if (!autoStart) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setStep(0);
        setOpen(true);
      }
    } catch {
      // sin localStorage: no autolanzamos
    }
  }, [autoStart]);

  // Reabrir desde el botón "Tutorial" del menú (evento global).
  useEffect(() => {
    function onOpen() {
      setStep(0);
      setOpen(true);
    }
    window.addEventListener('futura:open-tour', onOpen);
    return () => window.removeEventListener('futura:open-tour', onOpen);
  }, []);

  const close = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // no-op
    }
    setOpen(false);
  }, []);

  const last = STEPS.length - 1;
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

  // Medir el ítem objetivo (y re-medir en resize/scroll).
  useLayoutEffect(() => {
    if (!open) return;
    const selector = STEPS[step]?.target;
    if (!selector) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });

    function measure() {
      const node = document.querySelector<HTMLElement>(selector as string);
      if (!node) {
        setRect(null);
        return;
      }
      const r = node.getBoundingClientRect();
      // width/height 0 => oculto (ej. sidebar en mobile) => fallback centrado.
      if (r.width === 0 || r.height === 0) {
        setRect(null);
        return;
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    measure();
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 260); // tras el scroll suave
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, step, reduced]);

  // Teclado.
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

  if (!open) return null;

  const s = STEPS[step];
  if (!s) return null;
  const Icon = s.icon;
  const PAD = 8;
  const hl = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Posición de la tarjeta.
  const CARD_W = 360;
  const GAP = 20;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let cardPos: CSSProperties;
  let beakTop: number | null = null;

  if (hl && vw - (hl.left + hl.width) > CARD_W + GAP + 12) {
    // A la derecha del ítem (caso típico: menú a la izquierda).
    const top = clamp(hl.top - 8, 16, vh - 300);
    cardPos = { top, left: hl.left + hl.width + GAP, width: CARD_W };
    beakTop = clamp(hl.top + hl.height / 2 - top - 6, 16, 220);
  } else {
    // Centrada (intro/outro, o mobile sin espacio).
    cardPos = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: `min(${CARD_W}px, calc(100vw - 32px))`,
    };
  }

  const glide = reduced ? '' : 'transition-all duration-500 ease-out';

  return (
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial de bienvenida"
    >
      {/* Captura de clics: bloquea la app detrás. Click fuera no avanza (evita cierres accidentales). */}
      <button
        type="button"
        aria-label="Fondo del tutorial"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={(e) => e.preventDefault()}
      />

      {hl ? (
        <>
          {/* Recorte + oscurecido (box-shadow gigante) */}
          <div
            className={`pointer-events-none absolute rounded-xl ${glide}`}
            style={{
              top: hl.top,
              left: hl.left,
              width: hl.width,
              height: hl.height,
              boxShadow: '0 0 0 9999px rgba(24, 24, 27, 0.78)',
            }}
          />
          {/* Halo violeta que late */}
          <div
            className={`pointer-events-none absolute rounded-2xl ring-2 ring-brand-400/90 ${glide} ${
              reduced ? '' : 'animate-[tour-pulse_2s_ease-out_infinite]'
            }`}
            style={{ top: hl.top, left: hl.left, width: hl.width, height: hl.height }}
          />
        </>
      ) : (
        // Sin objetivo: oscurecido completo con desenfoque.
        <div className="absolute inset-0 bg-[#14211d]/75 backdrop-blur-[3px]" />
      )}

      {/* Tarjeta */}
      <div
        className={`absolute ${reduced ? '' : 'animate-[zoom-in_200ms_cubic-bezier(0.16,1,0.3,1)]'}`}
        style={cardPos}
      >
        <div className="relative overflow-hidden rounded-[26px] border border-white/60 bg-white shadow-[0_40px_90px_-30px_rgba(20,33,29,0.6)]">
          {/* Puntero hacia el ítem */}
          {beakTop !== null && (
            <span
              className="absolute -left-1.5 h-3 w-3 rotate-45 rounded-[3px] border-b border-l border-[--color-border] bg-white"
              style={{ top: beakTop }}
            />
          )}

          <button
            type="button"
            onClick={close}
            aria-label="Cerrar tutorial"
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-all duration-300 hover:rotate-90 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="p-6">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_12px_28px_-12px_rgba(20,33,29,0.7)] ${s.tint} ${
                  reduced ? '' : 'animate-[float_3s_ease-in-out_infinite]'
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-brand-500">
                {s.eyebrow}
              </span>
            </div>

            <h2
              key={step}
              className="mt-4 animate-fade-up text-[23px] font-extrabold tracking-tight text-zinc-900"
            >
              {s.title}
            </h2>
            <p className="mt-1.5 text-[16px] leading-relaxed text-zinc-600">{s.body}</p>

            {/* Progreso */}
            <div className="mt-5 flex items-center gap-1.5">
              {STEPS.map((st, i) => (
                <button
                  key={st.title}
                  type="button"
                  aria-label={`Ir al paso ${i + 1}`}
                  onClick={() => setStep(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step
                      ? 'w-6 bg-[linear-gradient(90deg,#37766a,#6bc2a4)]'
                      : 'w-1.5 bg-zinc-200 hover:bg-brand-200'
                  }`}
                />
              ))}
            </div>

            {/* Navegación */}
            <div className="mt-5 flex items-center justify-between gap-3">
              {step === 0 ? (
                <button
                  type="button"
                  onClick={close}
                  className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800"
                >
                  Saltar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={back}
                  className="inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800"
                >
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </button>
              )}

              <span className="text-xs tabular-nums text-zinc-400">
                {step + 1} / {STEPS.length}
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
      </div>
    </div>
  );
}
