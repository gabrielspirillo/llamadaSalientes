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
  Coins,
  Contact,
  HelpCircle,
  MessageCircle,
  MessageSquare,
  PhoneCall,
  PhoneIncoming,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

// v3: el tutorial dejó de ser un "esto es X, esto es Y" del menú y pasó a
// contar para qué sirve —atender siempre, llenar la agenda, ordenarse—. Se
// sube la versión para que quien ya lo vio lo vea una vez más, ya renovado.
const STORAGE_KEY = 'futura:welcome-tour:v3';

type Step = {
  /** `hero` = tarjeta grande centrada que vende un resultado; `spot` = señala
   *  un ítem real del menú con un beneficio concreto. */
  kind: 'hero' | 'spot';
  target?: string;
  icon: LucideIcon;
  tint: string;
  eyebrow: string;
  title: string;
  body: string;
  /** Banda de impacto (el "por qué te importa"). */
  impact?: { icon: LucideIcon; text: string; tone: 'brand' | 'emerald' | 'sky' | 'amber' };
  /** Beneficios concretos, con check. */
  points?: string[];
};

const BRAND = 'bg-[linear-gradient(135deg,#2e5f56,#479183_60%,#6bc2a4)]';
const EMERALD = 'bg-[linear-gradient(135deg,#0f766e,#10b981)]';
const SKY = 'bg-[linear-gradient(135deg,#0369a1,#38bdf8)]';
const AMBER = 'bg-[linear-gradient(135deg,#b45309,#f59e0b)]';

const STEPS: Step[] = [
  // ── Parte 1: la promesa ───────────────────────────────────────────────────
  {
    kind: 'hero',
    icon: PhoneIncoming,
    tint: BRAND,
    eyebrow: 'Bienvenido a Futura',
    title: 'Nunca más una llamada perdida',
    body: 'Tu recepcionista con IA coge el teléfono y responde el WhatsApp las 24 horas. Cuando tú cierras, ella sigue dando cita.',
    impact: {
      icon: Sparkles,
      tone: 'brand',
      text: 'Cada llamada sin atender es un paciente que llama a la clínica de al lado.',
    },
    points: [
      'Atiende varias llamadas a la vez, sin colas',
      'Contesta al instante, de día y de noche',
      'Findes y festivos incluidos',
    ],
  },
  {
    kind: 'hero',
    icon: Coins,
    tint: EMERALD,
    eyebrow: 'Más ingresos',
    title: 'Llena la agenda y recupera lo que se cae',
    body: 'Avisa de cada cita, rellena con la lista de espera los huecos que se liberan y vuelve a llamar a los pacientes que hace tiempo que no vienen.',
    impact: {
      icon: TrendingUp,
      tone: 'emerald',
      text: 'Menos huecos vacíos y menos ausencias: más ingresos con los pacientes que ya tienes.',
    },
    points: [
      'Recordatorios que bajan las ausencias',
      'Huecos cancelados que se rellenan solos',
      'Campañas para reactivar pacientes dormidos',
    ],
  },
  {
    kind: 'hero',
    icon: ClipboardCheck,
    tint: SKY,
    eyebrow: 'Todo bajo control',
    title: 'Se organiza solo, sin apuntar nada a mano',
    body: 'Cada llamada perdida, cada paciente que no vino y cada mensaje se convierte solo en una tarea. Todo el equipo trabaja sobre el mismo panel.',
    impact: {
      icon: Sparkles,
      tone: 'sky',
      text: 'Dejas de llevar la clínica en post-its y en la cabeza.',
    },
    points: [
      'El tablero de tareas se llena solo',
      'Ficha del paciente con todo su historial',
      'Chat interno para coordinar al equipo',
    ],
  },

  // ── Parte 2: el recorrido, por beneficio ──────────────────────────────────
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/tasks"]',
    icon: ClipboardCheck,
    tint: SKY,
    eyebrow: 'Tu día, ordenado',
    title: 'Tareas',
    body: 'El tablero del equipo se llena solo: la llamada por devolver, el paciente que no vino, el presupuesto parado, la apertura y el cierre de cada día.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/agent"]',
    icon: Bot,
    tint: BRAND,
    eyebrow: 'El cerebro',
    title: 'Tu asistente',
    body: 'Aquí decides cómo habla: su tono, el saludo y a qué número pasa la llamada cuando hace falta una persona.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/calls"]',
    icon: PhoneCall,
    tint: BRAND,
    eyebrow: 'El teléfono',
    title: 'Llamadas',
    body: 'Atiende lo que entra y también llama a tus pacientes para recordarles la cita o recuperar las que se cancelaron. Con transcripción y resumen de cada una.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/reminders"]',
    icon: BellRing,
    tint: AMBER,
    eyebrow: 'Menos ausencias',
    title: 'Recordatorios',
    body: 'Avisos de cita automáticos por WhatsApp y por voz para que no falten. Y una lista de espera lista para ocupar el hueco que se libere.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/whatsapp"]',
    icon: MessageCircle,
    tint: EMERALD,
    eyebrow: 'También por chat',
    title: 'WhatsApp',
    body: 'Responde dudas, confirma citas y pasa la conversación a una persona en cuanto hace falta.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/messages"]',
    icon: MessageSquare,
    tint: BRAND,
    eyebrow: 'El equipo, a una',
    title: 'Mensajes',
    body: 'El chat interno de la clínica. Aquí caen solas las llamadas perdidas y los huecos libres, y cualquier mensaje se vuelve tarea con un clic.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/contacts"]',
    icon: Contact,
    tint: SKY,
    eyebrow: 'Cada paciente',
    title: 'Pacientes',
    body: 'La ficha de cada persona con todo junto: resumen, próximas citas, llamadas, WhatsApp y sus tareas. Sin saltar de pantalla.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/treatments"]',
    icon: Stethoscope,
    tint: EMERALD,
    eyebrow: 'Para que acierte',
    title: 'Tratamientos y precios',
    body: 'Añade lo que ofreces con su duración y su precio. El asistente los usa para responder y dar cita sin equivocarse.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/faqs"]',
    icon: HelpCircle,
    tint: AMBER,
    eyebrow: 'Respuestas listas',
    title: 'Preguntas frecuentes',
    body: 'Lo que más os preguntan —precios, dirección, formas de pago—. El asistente responde con tus palabras.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/analytics"]',
    icon: BarChart3,
    tint: BRAND,
    eyebrow: 'Los resultados',
    title: 'Métricas',
    body: 'El dinero recuperado, las ausencias que has evitado y cuántas citas salieron del asistente. Lo que antes no se veía.',
  },
  {
    kind: 'spot',
    target: '[data-tour="/dashboard/team"]',
    icon: Users,
    tint: SKY,
    eyebrow: 'Tu gente',
    title: 'Equipo',
    body: 'Invita a las personas de tu clínica, cada una con su rol. Todas trabajan sobre el mismo panel.',
  },

  // ── Cierre ────────────────────────────────────────────────────────────────
  {
    kind: 'hero',
    icon: ShieldCheck,
    tint: BRAND,
    eyebrow: 'Ya está',
    title: 'Empieza por aquí',
    body: 'De lo técnico —teléfono, WhatsApp y agenda— nos encargamos nosotros. Tú ocúpate de tu clínica.',
    impact: {
      icon: Sparkles,
      tone: 'brand',
      text: '¿Dudas? Escríbenos cuando quieras: te acompañamos en la puesta en marcha.',
    },
    points: [
      'Mira el panel con datos de ejemplo',
      'Prueba a hablar con el asistente',
      'Añade tus tratamientos y precios',
    ],
  },
];

const IMPACT_TONE: Record<NonNullable<Step['impact']>['tone'], { wrap: string; icon: string }> = {
  brand: { wrap: 'bg-brand-50 text-brand-800 ring-brand-100', icon: 'text-brand-600' },
  emerald: { wrap: 'bg-emerald-50 text-emerald-800 ring-emerald-100', icon: 'text-emerald-600' },
  sky: { wrap: 'bg-sky-50 text-sky-800 ring-sky-100', icon: 'text-sky-600' },
  amber: { wrap: 'bg-amber-50 text-amber-900 ring-amber-100', icon: 'text-amber-600' },
};

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
      if (r.width === 0 || r.height === 0) {
        setRect(null);
        return;
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    measure();
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 260);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, step, reduced]);

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
  const isHero = s.kind === 'hero';
  const PAD = 8;
  const hl = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  const CARD_W = isHero ? 468 : 372;
  const GAP = 20;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let cardPos: CSSProperties;
  let beakTop: number | null = null;

  if (hl && vw - (hl.left + hl.width) > CARD_W + GAP + 12) {
    const top = clamp(hl.top - 8, 16, vh - 340);
    cardPos = { top, left: hl.left + hl.width + GAP, width: CARD_W };
    beakTop = clamp(hl.top + hl.height / 2 - top - 6, 16, 240);
  } else {
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
      // biome-ignore lint/a11y/useSemanticElements: overlay propio del tour; no usa showModal() ni el top-layer del <dialog> nativo
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial de bienvenida"
    >
      <button
        type="button"
        aria-label="Fondo del tutorial"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={(e) => e.preventDefault()}
      />

      {hl ? (
        <>
          <div
            className={`pointer-events-none absolute rounded-xl ${glide}`}
            style={{
              top: hl.top,
              left: hl.left,
              width: hl.width,
              height: hl.height,
              boxShadow: '0 0 0 9999px rgba(20, 33, 29, 0.80)',
            }}
          />
          <div
            className={`pointer-events-none absolute rounded-2xl ring-2 ring-brand-400/90 ${glide} ${
              reduced ? '' : 'animate-[tour-pulse_2s_ease-out_infinite]'
            }`}
            style={{ top: hl.top, left: hl.left, width: hl.width, height: hl.height }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-[#14211d]/80 backdrop-blur-[3px]" />
      )}

      <div
        className={`absolute ${reduced ? '' : 'animate-[zoom-in_200ms_cubic-bezier(0.16,1,0.3,1)]'}`}
        style={cardPos}
      >
        <div className="relative overflow-hidden rounded-[26px] border border-white/60 bg-white shadow-[0_44px_96px_-30px_rgba(20,33,29,0.62)]">
          {/* Halo de marca arriba, solo en las tarjetas grandes */}
          {isHero && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(70%_120%_at_25%_0%,rgba(95,168,150,0.20),transparent_70%)]"
            />
          )}

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

          <div className={`relative ${isHero ? 'p-6 sm:p-7' : 'p-6'}`}>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_14px_30px_-14px_rgba(20,33,29,0.75)] ${s.tint} ${
                  isHero ? 'h-14 w-14' : 'h-12 w-12'
                } ${reduced ? '' : 'animate-[float_3s_ease-in-out_infinite]'}`}
              >
                <Icon className={isHero ? 'h-6 w-6' : 'h-5 w-5'} />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-500">
                {s.eyebrow}
              </span>
            </div>

            <h2
              key={step}
              className={`mt-4 animate-fade-up font-extrabold tracking-tight text-zinc-900 ${
                isHero ? 'text-[24px] leading-tight' : 'text-[20px]'
              }`}
            >
              {s.title}
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-600">{s.body}</p>

            {s.impact && (
              <div
                className={`mt-3.5 flex items-start gap-2.5 rounded-[16px] px-3.5 py-2.5 ring-1 ${IMPACT_TONE[s.impact.tone].wrap}`}
              >
                <s.impact.icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${IMPACT_TONE[s.impact.tone].icon}`}
                />
                <p className="text-[13px] font-medium leading-snug">{s.impact.text}</p>
              </div>
            )}

            {s.points && s.points.length > 0 && (
              <ul className="mt-3.5 space-y-1.5">
                {s.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2 text-[13.5px] text-zinc-700">
                    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    {pt}
                  </li>
                ))}
              </ul>
            )}

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
                  className="text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-800"
                >
                  Saltar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={back}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-800"
                >
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </button>
              )}

              <span className="text-[12px] tabular-nums text-zinc-400">
                {step + 1} / {STEPS.length}
              </span>

              <Button size="sm" type="button" onClick={next}>
                {step === last ? (
                  <>
                    <Check className="h-4 w-4" /> Empezar
                  </>
                ) : step === 2 ? (
                  <>
                    Ver la app <ArrowRight className="h-4 w-4" />
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
