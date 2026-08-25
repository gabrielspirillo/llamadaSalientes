// Contrato compartido (cliente + servidor) del wizard de onboarding público.
//
// IMPORTANTE: los nombres de campo siguen EXACTAMENTE el modelo de datos
// existente (clinic_settings / treatments / faqs / agent_configs) para poder
// persistir reusando los servicios ya presentes en lib/data/*. Ver
// lib/onboarding/persist.ts para el mapeo a cada tabla.
//
// Este archivo NO es `server-only`: se importa también desde el wizard cliente.
// zod ya es dependencia del repo — no se agrega nada nuevo.

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes / opciones de UI
// ─────────────────────────────────────────────────────────────────────────────

export const STORAGE_KEY_PREFIX = 'futura:onboarding:';

// E.164 — mismo criterio pedido en el prompt y usado en el resto del repo.
export const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type Day = (typeof DAYS)[number];

export const DAY_LABELS: Record<Day, string> = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo',
};

// Default Europe/Madrid + opciones LATAM (pedido explícito del prompt).
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Europe/Madrid', label: 'España (Europe/Madrid)' },
  { value: 'America/Mexico_City', label: 'México (America/Mexico_City)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
  { value: 'America/Bogota', label: 'Colombia (America/Bogota)' },
  { value: 'America/Santiago', label: 'Chile (America/Santiago)' },
  { value: 'America/Lima', label: 'Perú (America/Lima)' },
  { value: 'America/Montevideo', label: 'Uruguay (America/Montevideo)' },
  { value: 'America/Guayaquil', label: 'Ecuador (America/Guayaquil)' },
  { value: 'America/Caracas', label: 'Venezuela (America/Caracas)' },
  { value: 'America/Santo_Domingo', label: 'Rep. Dominicana' },
];

export const LANGUAGE_OPTIONS: { value: 'es' | 'en'; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

export const FAQ_CATEGORIES = [
  'Precios',
  'Pagos',
  'Ubicación',
  'Logística',
  'Política',
  'Emergencias',
  'Otros',
] as const;

export const DEFAULT_RECORDING_CONSENT =
  'Esta llamada se está grabando para mejorar la calidad del servicio. Si no querés que se grabe, podés colgar y nuestra recepción te llamará de vuelta.';

// ─────────────────────────────────────────────────────────────────────────────
// Estado del formulario (lo que vive en React + localStorage)
//
// Se diferencia levemente del payload que viaja al servidor: acá los horarios
// llevan un flag `enabled` por día (más cómodo para la UI que null), y los
// precios se cargan en euros. La conversión a la forma del payload la hace
// `toPayload()` más abajo.
// ─────────────────────────────────────────────────────────────────────────────

export type HourRow = { enabled: boolean; open: string; close: string };

// id local estable para keys de React en listas editables (no viaja al payload).
// Mismo patrón que apps/web/components/dashboard/whatsapp genId.
function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export type TreatmentForm = {
  id: string;
  name: string;
  description: string;
  durationMinutes: string; // string en el input; se castea al validar/enviar
  priceMin: string;
  priceMax: string;
  priceReferencial: string;
};

export type FaqForm = { id: string; category: string; question: string; answer: string };

export type OnboardingForm = {
  clinic: {
    name: string;
    address: string;
    phones: string[];
    timezone: string;
    defaultLanguage: 'es' | 'en';
    contactEmail: string;
  };
  hours: Record<Day, HourRow>;
  treatments: TreatmentForm[];
  faqs: FaqForm[];
  agent: {
    name: string;
    tone: string;
    afterHoursMessage: string;
    transferNumber: string;
    recordingConsentText: string;
  };
};

export function emptyTreatment(): TreatmentForm {
  return {
    id: genId(),
    name: '',
    description: '',
    durationMinutes: '',
    priceMin: '',
    priceMax: '',
    priceReferencial: '',
  };
}

export function emptyFaq(): FaqForm {
  return { id: genId(), category: '', question: '', answer: '' };
}

export function defaultForm(): OnboardingForm {
  const defaultHours = (): HourRow => ({ enabled: true, open: '09:00', close: '19:00' });
  return {
    clinic: {
      name: '',
      address: '',
      phones: [''],
      timezone: 'Europe/Madrid',
      defaultLanguage: 'es',
      contactEmail: '',
    },
    hours: {
      monday: defaultHours(),
      tuesday: defaultHours(),
      wednesday: defaultHours(),
      thursday: defaultHours(),
      friday: defaultHours(),
      saturday: { enabled: false, open: '10:00', close: '14:00' },
      sunday: { enabled: false, open: '10:00', close: '14:00' },
    },
    treatments: [emptyTreatment()],
    faqs: [],
    agent: {
      name: '',
      tone: '',
      afterHoursMessage: '',
      transferNumber: '',
      recordingConsentText: DEFAULT_RECORDING_CONSENT,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload que viaja al endpoint POST /api/public/onboarding
// ─────────────────────────────────────────────────────────────────────────────

const numeric = z
  .number({ invalid_type_error: 'Número inválido' })
  .nonnegative('No puede ser negativo');

export const payloadSchema = z.object({
  // Vacío en modo link único (auto-registro): el server crea la clínica desde
  // clinic.name. En modo link por clínica trae el slug del tenant existente.
  tenant: z.string().default(''),
  submittedAt: z.string().min(1),
  clinic: z.object({
    name: z.string().trim().min(1, 'Ingresá el nombre de la clínica'),
    address: z.string().trim().min(1, 'Ingresá la dirección'),
    phones: z.array(z.string().trim().min(3)).min(1, 'Ingresá al menos un teléfono'),
    timezone: z.string().trim().min(1),
    defaultLanguage: z.enum(['es', 'en']),
    contactEmail: z.string().trim().email('Email inválido'),
  }),
  // Horarios en forma final: {open,close} o null (cerrado). Igual que
  // clinic_settings.working_hours.
  hours: z.record(z.enum(DAYS), z.object({ open: z.string(), close: z.string() }).nullable()),
  treatments: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Nombre requerido'),
        description: z.string().trim().optional().default(''),
        durationMinutes: z.number().int().positive('Duración inválida'),
        priceMin: numeric.optional(),
        priceMax: numeric.optional(),
        // Precio referencial en EUROS (el servidor lo pasa a centavos).
        priceReferencial: numeric.optional(),
      }),
    )
    .min(1, 'Cargá al menos un tratamiento'),
  faqs: z
    .array(
      z.object({
        category: z.string().trim().optional().default(''),
        question: z.string().trim().min(1, 'Pregunta requerida'),
        answer: z.string().trim().min(1, 'Respuesta requerida'),
      }),
    )
    .default([]),
  agent: z.object({
    name: z.string().trim().optional().default(''),
    tone: z.string().trim().max(2000).optional().default(''),
    afterHoursMessage: z.string().trim().optional().default(''),
    transferNumber: z
      .string()
      .trim()
      .regex(E164_REGEX, 'Número inválido. Usá formato internacional, ej: +34611223344'),
    recordingConsentText: z.string().trim().min(1, 'El texto de consentimiento es obligatorio'),
  }),
});

export type OnboardingPayload = z.infer<typeof payloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Conversión estado de formulario → payload
// ─────────────────────────────────────────────────────────────────────────────

function toNumberOrUndefined(raw: string): number | undefined {
  const v = raw.trim();
  if (v === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function toPayload(form: OnboardingForm, tenant: string): OnboardingPayload {
  const hours = {} as OnboardingPayload['hours'];
  for (const day of DAYS) {
    const row = form.hours[day];
    hours[day] = row.enabled ? { open: row.open, close: row.close } : null;
  }

  return {
    tenant,
    submittedAt: new Date().toISOString(),
    clinic: {
      name: form.clinic.name.trim(),
      address: form.clinic.address.trim(),
      phones: form.clinic.phones.map((p) => p.trim()).filter(Boolean),
      timezone: form.clinic.timezone,
      defaultLanguage: form.clinic.defaultLanguage,
      contactEmail: form.clinic.contactEmail.trim(),
    },
    hours,
    treatments: form.treatments.map((t) => ({
      name: t.name.trim(),
      description: t.description.trim(),
      durationMinutes: Math.round(toNumberOrUndefined(t.durationMinutes) ?? 0),
      priceMin: toNumberOrUndefined(t.priceMin),
      priceMax: toNumberOrUndefined(t.priceMax),
      priceReferencial: toNumberOrUndefined(t.priceReferencial),
    })),
    faqs: form.faqs
      .filter((f) => f.question.trim() || f.answer.trim())
      .map((f) => ({
        category: f.category.trim(),
        question: f.question.trim(),
        answer: f.answer.trim(),
      })),
    agent: {
      name: form.agent.name.trim(),
      tone: form.agent.tone.trim(),
      afterHoursMessage: form.agent.afterHoursMessage.trim(),
      transferNumber: form.agent.transferNumber.trim(),
      recordingConsentText: form.agent.recordingConsentText.trim(),
    },
  };
}
