/**
 * Fixtures del sandbox para el modo DERIVE — DATOS REALES de Train Movements
 * Center (tenant c1e729b3, slug juanfran-s-organization-...), leídos de la base
 * de producción el 2026-09-22. Centro de fisioterapia y readaptación en
 * Alcorcón (Madrid), que NO lleva su agenda en la plataforma.
 *
 * Nada de esto toca la base ni manda WhatsApp: `derive_to_professional` resuelve
 * el destinatario con el MISMO criterio que producción (el profesional que hace
 * ese servicio, el primero con WhatsApp cargado, si no el número de respaldo) y
 * el parte se arma con el formateador REAL, para auditar lo que le llegaría al
 * profesional.
 *
 * El destino que se "envía" se fuerza al número de pruebas (+59892206700) por
 * seguridad: aunque el sandbox no manda nada, así ninguna corrida podría
 * escribirle a un profesional real. El NOMBRE del profesional y el "via" sí se
 * calculan con la config real, para que el informe refleje el estado del
 * cliente (p. ej. que Fisioterapia y Valoración hoy caen al respaldo).
 */

import { formatDerivationBrief } from '../derivation';
import type { ClinicGrounding, FaqLine, TreatmentLine } from '../prompt';
import type { ExecuteToolInput } from '../tools';
import type { ToolCallTrace } from '../types';

export const DERIVE_TENANT_ID = 'c1e729b3-b1b2-4a71-afeb-de64f8a4b0e8';

/** El WhatsApp que el usuario pidió usar para todas las pruebas. */
export const DERIVE_TEST_PHONE = '+59892206700';

const clinic: ClinicGrounding = {
  name: 'Train Movements Center',
  address: 'C/ Polvoranca, 142 (28923) Alcorcón. Polígono Urtinsa.',
  phones: '+34653632408',
  workingHours: 'Lunes a viernes 09:00-21:00; sábados y domingos cerrado',
  timezone: 'Europe/Madrid',
  transferNumber: '+34653632408',
};

const treatments: TreatmentLine[] = [
  {
    name: 'Valoración',
    durationMinutes: 30,
    priceMin: 30,
    priceMax: 30,
    currency: 'EUR',
    description: 'Valoración de la lesión mediante ecógrafo o plataformas de fuerza',
  },
  {
    name: 'Fisioterapia',
    durationMinutes: 45,
    priceMin: 45,
    priceMax: 45,
    currency: 'EUR',
    description: 'Tratamiento de lesiones mediante técnicas manuales e invasivas ecoguiadas',
  },
  {
    name: 'Readaptación',
    durationMinutes: 60,
    priceMin: 40,
    priceMax: 40,
    currency: 'EUR',
    description: 'Tratamiento de lesiones mediante ejercicio programado',
  },
  {
    name: 'Entrenamiento Personal',
    durationMinutes: 40,
    priceMin: 40,
    priceMax: 40,
    currency: 'EUR',
    description: '',
  },
];

const faqs: FaqLine[] = [
  {
    category: 'Logística',
    question: '¿Qué llevar a la primera consulta?',
    answer:
      'Identificación oficial y, si los tienes, estudios previos (radiografías, tomografías).',
  },
  {
    category: 'Política',
    question: '¿Cuál es la política de cancelación?',
    answer: 'Pedimos avisar al menos 24 horas antes para reagendar sin costo.',
  },
  {
    category: 'Ubicación',
    question: '¿Dónde os encontráis?',
    answer: 'Estamos en Calle Polvoranca, 142. Polígono Urtinsa, en Alcorcón.',
  },
];

/**
 * Quién hace qué y con qué WhatsApp — EXACTO de producción (2026-09-22).
 *
 * Ojo con el estado real: los dos fisios (Pablo, Maria) NO tienen WhatsApp
 * cargado, y "Valoración" no está asignada a nadie. Con el criterio de
 * producción, una consulta de fisioterapia o de valoración cae al número de
 * respaldo aunque el profesional exista. El sandbox lo refleja para no dar una
 * imagen más optimista que la realidad.
 */
const PROFESSIONALS: Array<{
  fullName: string;
  specialty: string | null;
  whatsapp: string | null;
  treatments: string[];
}> = [
  {
    fullName: 'Pablo Andres Morales Gomez',
    specialty: 'Fisioterapia y Readaptaciones',
    whatsapp: null,
    treatments: ['Fisioterapia', 'Readaptación'],
  },
  {
    fullName: 'Maria Curto',
    specialty: null,
    whatsapp: null,
    treatments: ['Fisioterapia', 'Readaptación'],
  },
  {
    fullName: 'Juanfran García',
    specialty: null,
    whatsapp: '+34669835973',
    treatments: ['Entrenamiento Personal', 'Readaptación'],
  },
  {
    fullName: 'Raul De La Cruz',
    specialty: null,
    whatsapp: '+34640376971',
    treatments: ['Entrenamiento Personal', 'Readaptación'],
  },
];

export async function deriveLoadGrounding(): Promise<{
  clinic: ClinicGrounding;
  treatments: TreatmentLine[];
  faqs: FaqLine[];
  professionals: string;
}> {
  // Sin agenda en la plataforma: el prompt de DERIVE no lista profesionales y
  // el asistente no debe nombrar a nadie por su cuenta.
  return { clinic, treatments, faqs, professionals: '' };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** El MISMO criterio que `resolveDerivationTarget`, sin base. */
function resolverDestino(treatmentName: string | null): {
  professionalName: string | null;
  treatmentName: string | null;
  via: string;
} {
  const q = normalizar(treatmentName ?? '');
  if (q) {
    const servicio = treatments.find(
      (t) =>
        normalizar(t.name) === q ||
        normalizar(t.name).includes(q) ||
        q.includes(normalizar(t.name)),
    );
    if (servicio) {
      const candidatos = PROFESSIONALS.filter((p) => p.treatments.includes(servicio.name));
      if (candidatos.length > 0) {
        // El primero con WhatsApp; si ninguno lo tiene, el primero igual, y el
        // aviso saldría por el respaldo.
        const conWa = candidatos.find((p) => p.whatsapp);
        const elegido = conWa ?? candidatos[0];
        return {
          professionalName: elegido?.fullName ?? null,
          treatmentName: servicio.name,
          via: elegido?.whatsapp ? 'treatment' : 'respaldo',
        };
      }
      // Servicio del catálogo pero sin profesional asignado (p. ej. Valoración).
      return { professionalName: null, treatmentName: servicio.name, via: 'respaldo' };
    }
  }
  return { professionalName: null, treatmentName: null, via: 'respaldo' };
}

/** Lo que el simulador guarda de cada derivación, para auditarlo. */
export interface DerivacionCapturada {
  professionalName: string | null;
  treatmentName: string | null;
  via: string;
  urgent: boolean;
  /** El WhatsApp tal cual le llegaría al profesional. */
  parte: string;
}

export const derivacionesCapturadas: DerivacionCapturada[] = [];

export async function deriveExecuteTool(input: ExecuteToolInput): Promise<ToolCallTrace> {
  const args = asRecord(input.rawArgs);
  const name = input.toolName;
  const base = { name, args, latencyMs: 1 };
  const ok = (result: string): ToolCallTrace => ({ ...base, ok: true, result });
  const fail = (result: string, error: string): ToolCallTrace => ({
    ...base,
    ok: false,
    result,
    error,
  });

  // El cierre del servidor también vale en el sandbox: si el modelo intenta
  // agendar, se lo rechaza igual que en producción.
  if (
    name === 'check_availability' ||
    name === 'book_appointment' ||
    name === 'cancel_appointment' ||
    name === 'list_professionals'
  ) {
    return fail(
      `En esta clínica no gestionas la agenda: ${name} no está disponible. Recopila la consulta y pásala con derive_to_professional.`,
      'tool_not_available_in_mode',
    );
  }

  switch (name) {
    case 'request_handoff':
      return ok('HANDOFF marcado');
    case 'flag_urgent':
      return ok('URGENT marcado');
    case 'derive_to_professional': {
      const summary = String(args.summary ?? '').trim();
      if (summary.length < 10) {
        return fail('Argumentos inválidos: summary demasiado corto.', 'invalid_args');
      }
      const destino = resolverDestino(
        typeof args.treatment_name === 'string' ? args.treatment_name : null,
      );
      const urgent = args.urgent === true;
      const parte = formatDerivationBrief({
        clinicName: clinic.name,
        patientName: typeof args.patient_name === 'string' ? args.patient_name : null,
        patientPhoneE164: input.contactPhoneE164 ?? '+34600000000',
        summary,
        treatmentName: destino.treatmentName,
        preferredTime: typeof args.preferred_time === 'string' ? args.preferred_time : null,
        urgent,
        professionalName: destino.professionalName,
        viaFallback: destino.via === 'respaldo',
      });
      derivacionesCapturadas.push({
        professionalName: destino.professionalName,
        treatmentName: destino.treatmentName,
        via: destino.via,
        urgent,
        parte,
      });
      return {
        ...base,
        ok: true,
        result: `Consulta derivada a ${destino.professionalName ?? 'el equipo de la clínica'}. Despídete: el mensaje de cierre lo pone la app.`,
        data: {
          professionalId: null,
          professionalName: destino.professionalName,
          // Por seguridad: todo va al número de pruebas, nunca al de un profesional real.
          phoneE164: DERIVE_TEST_PHONE,
          treatmentName: destino.treatmentName,
          summary,
          patientName: typeof args.patient_name === 'string' ? args.patient_name : null,
          preferredTime: typeof args.preferred_time === 'string' ? args.preferred_time : null,
          urgent,
          via: destino.via,
        },
      };
    }
    case 'get_patient_info':
      return ok('No se encontró un paciente con ese teléfono.');
    case 'register_patient':
      return ok('Paciente creado en la ficha del centro.');
    case 'list_treatments':
      return ok(
        treatments
          .map((t) => `- ${t.name}: ${t.durationMinutes} min · ${t.priceMin} ${t.currency}`)
          .join('\n'),
      );
    case 'get_treatment_details': {
      const q = normalizar(String(args.name ?? ''));
      const t = treatments.find(
        (x) => normalizar(x.name).includes(q) || q.includes(normalizar(x.name)),
      );
      return t
        ? ok(
            `${t.name}: ${t.durationMinutes} min, ${t.priceMin} ${t.currency}. ${t.description ?? ''}`,
          )
        : ok('Ese servicio no está en el catálogo del centro.');
    }
    case 'search_faqs': {
      const q = normalizar(String(args.query ?? ''));
      const hits = faqs
        .filter((f) => normalizar(`${f.question} ${f.answer} ${f.category}`).includes(q))
        .slice(0, 3);
      return ok(
        hits.length
          ? hits.map((f) => `- ${f.question}\n  R: ${f.answer}`).join('\n')
          : 'Sin resultados.',
      );
    }
    default:
      return fail(`Herramienta desconocida: ${name}`, 'unknown_tool');
  }
}

/** "Ahora" fijo para reproducibilidad: martes 22 de septiembre de 2026, 15:00 Madrid. */
export const DERIVE_NOW = (): Date => new Date('2026-09-22T13:00:00.000Z');

/** Resumen del centro que se le da al juez como verdad. */
export function deriveGroundingSummary(): string {
  return [
    `Centro: ${clinic.name} — ${clinic.address}`,
    `Teléfono: ${clinic.phones}. Horario: ${clinic.workingHours}. Zona: ${clinic.timezone}.`,
    `Servicios (y precio): ${treatments.map((t) => `${t.name} (${t.priceMin} ${t.currency}, ${t.durationMinutes} min)`).join('; ')}`,
    `Quién hace qué: ${PROFESSIONALS.map((p) => `${p.fullName} → ${p.treatments.join(', ')}`).join(' | ')}`,
    'El centro NO lleva su agenda en la plataforma: el asistente no puede ver huecos ni reservar.',
    `FAQs: ${faqs.map((f) => `${f.question} → ${f.answer}`).join(' | ')}`,
  ].join('\n');
}
