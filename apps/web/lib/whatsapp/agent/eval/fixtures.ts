/**
 * Fixtures del sandbox de evals del agente de WhatsApp.
 *
 * Provee un `loadGrounding` falso (clínica + tratamientos + FAQs inventados)
 * y un ejecutor de tools mockeado, para correr el agente REAL (mismo loop,
 * mismo LLM) sin tocar BD, GHL ni enviar WhatsApp. Las respuestas de las
 * tools son plausibles para que el LLM pueda continuar de forma realista.
 */

import type { ClinicGrounding, FaqLine, TreatmentLine } from '../prompt';
import type { ExecuteToolInput } from '../tools';
import type { ToolCallTrace } from '../types';

export const FIXTURE_TENANT_ID = 'eval-tenant';

const clinic: ClinicGrounding = {
  name: 'Clínica Dental Demo',
  address: 'Calle Mayor 12, 28013 Madrid',
  phones: '+34 910 000 000',
  workingHours: 'Lunes a viernes 09:00-20:00; sábados 10:00-14:00',
  timezone: 'Europe/Madrid',
  transferNumber: '+34 910 000 001',
};

const treatments: TreatmentLine[] = [
  { name: 'Limpieza dental', durationMinutes: 30, priceMin: 50, priceMax: 60, currency: 'EUR', description: 'Higiene y profilaxis.' },
  { name: 'Ortodoncia invisible', durationMinutes: 45, priceMin: 2500, priceMax: 4000, currency: 'EUR', description: 'Alineadores transparentes.' },
  { name: 'Implante dental', durationMinutes: 60, priceMin: 900, priceMax: 1400, currency: 'EUR', description: 'Implante de titanio + corona.' },
  { name: 'Blanqueamiento', durationMinutes: 45, priceMin: 200, priceMax: 350, currency: 'EUR', description: 'Blanqueamiento en clínica.' },
  { name: 'Revisión / valoración', durationMinutes: 20, priceMin: 0, priceMax: 0, currency: 'EUR', description: 'Primera visita y diagnóstico.' },
];

const faqs: FaqLine[] = [
  { category: 'parking', question: '¿Tenéis parking?', answer: 'Sí, parking gratuito para pacientes en el mismo edificio.' },
  { category: 'seguros', question: '¿Aceptáis seguros?', answer: 'Trabajamos con Adeslas, Sanitas y DKV.' },
  { category: 'financiacion', question: '¿Se puede financiar?', answer: 'Sí, financiación hasta 24 meses sin intereses.' },
  { category: 'primera-visita', question: '¿La primera visita es gratis?', answer: 'La valoración inicial es gratuita y sin compromiso.' },
];

export async function fixtureLoadGrounding(): Promise<{
  clinic: ClinicGrounding;
  treatments: TreatmentLine[];
  faqs: FaqLine[];
}> {
  return { clinic, treatments, faqs };
}

/** Teléfonos que el mock reconoce como pacientes existentes. */
const KNOWN_PATIENTS: Record<string, { name: string; contactId: string }> = {
  '+34699111222': { name: 'Juan Pérez', contactId: 'ghl_fixture_juan' },
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/**
 * Ejecutor de tools mockeado. Misma firma que `executeAgentTool`. Devuelve
 * resultados canónicos plausibles. Las terminales (request_handoff /
 * flag_urgent) devuelven ok=true para que el orquestador corte el loop igual
 * que en producción.
 */
export async function fixtureExecuteTool(input: ExecuteToolInput): Promise<ToolCallTrace> {
  const args = asRecord(input.rawArgs);
  const name = input.toolName;
  const base = { name, args, latencyMs: 1 };

  const ok = (result: string): ToolCallTrace => ({ ...base, ok: true, result });
  const fail = (result: string, error: string): ToolCallTrace => ({ ...base, ok: false, result, error });

  switch (name) {
    case 'request_handoff':
      return ok('HANDOFF marcado');
    case 'flag_urgent':
      return ok('URGENT marcado');
    case 'check_availability': {
      const date = String(args.preferred_date ?? 'el próximo día disponible');
      const treatment = String(args.treatment_name ?? 'tu tratamiento');
      return ok(`Huecos para ${treatment} (${date}): 10:00, 11:30, 16:00.`);
    }
    case 'book_appointment':
      return ok(`Cita agendada correctamente para ${String(args.start_time ?? 'el horario indicado')}.`);
    case 'cancel_appointment':
      // Como en prod: cancelar requiere un appointment_id concreto. Sin id no
      // se puede cancelar (no inventamos un éxito).
      return String(args.appointment_id ?? '').trim()
        ? ok('La cita fue cancelada correctamente.')
        : fail('Falta appointment_id: no se puede cancelar sin saber qué cita.', 'missing_appointment_id');
    case 'get_patient_info': {
      const phone = String(args.phone ?? '').replace(/\s+/g, '');
      const match = KNOWN_PATIENTS[phone];
      return match
        ? ok(`Paciente: ${match.name} (contact_id: ${match.contactId})`)
        : ok('No se encontró un paciente con ese teléfono.');
    }
    case 'register_patient':
      return ok('Paciente creado (contact_id: ghl_eval_nuevo).');
    case 'list_treatments':
      return ok(treatments.map((t) => `- ${t.name}: ${t.priceMin}-${t.priceMax} ${t.currency}`).join('\n'));
    case 'get_treatment_details': {
      const q = String(args.name ?? '').toLowerCase();
      const t = treatments.find((x) => x.name.toLowerCase().includes(q));
      return t
        ? ok(`${t.name}: ${t.durationMinutes} min, ${t.priceMin}-${t.priceMax} ${t.currency}. ${t.description ?? ''}`)
        : ok('Tratamiento no encontrado en el catálogo.');
    }
    case 'search_faqs': {
      const q = String(args.query ?? '').toLowerCase();
      const hits = faqs
        .filter((f) => `${f.question} ${f.answer} ${f.category}`.toLowerCase().includes(q))
        .slice(0, 3);
      return ok(hits.length ? hits.map((f) => `- ${f.question}\n  R: ${f.answer}`).join('\n') : 'Sin resultados.');
    }
    default:
      return fail(`Herramienta desconocida: ${name}`, 'unknown_tool');
  }
}

/** "Ahora" fijo para reproducibilidad: lunes 8 de junio de 2026, 11:00 Madrid. */
export const FIXTURE_NOW = (): Date => new Date('2026-06-08T09:00:00.000Z');
