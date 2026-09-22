import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Modo DERIVE: el asistente no agenda.
 *
 * Que el prompt se lo diga no basta —un modelo puede llamar a una tool que no
 * le ofrecieron—, así que la garantía está en dos sitios y los dos se fijan
 * aquí: la lista de herramientas que se le entrega y el rechazo del servidor.
 */
const dispatchToolMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/retell/tools', () => ({ dispatchTool: dispatchToolMock }));

const resolveTargetMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsapp/agent/derivation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/agent/derivation')>()),
  resolveDerivationTarget: resolveTargetMock,
}));

vi.mock('@/lib/agenda/agent', () => ({
  describeAgendaForPrompt: vi.fn(),
  matchByName: vi.fn(),
  normalizeName: (s: string) => s,
}));
vi.mock('@/lib/data/faqs', () => ({ listFaqsForTenant: vi.fn() }));
vi.mock('@/lib/data/treatments', () => ({ listTreatmentsForTenant: vi.fn() }));
vi.mock('@/lib/retell/clinic-context', () => ({ buildClinicContextVars: vi.fn() }));

import { type BuildSystemPromptInput, buildSystemPrompt } from '@/lib/whatsapp/agent/prompt';
import { executeAgentTool, getAgentToolDefinitions } from '@/lib/whatsapp/agent/tools';

beforeEach(() => {
  dispatchToolMock.mockReset();
  resolveTargetMock.mockReset();
});

describe('las herramientas que ve el modelo', () => {
  it('en modo DERIVE no hay nada con lo que agendar', () => {
    const names = getAgentToolDefinitions('DERIVE').map((d) => d.name);
    expect(names).not.toContain('check_availability');
    expect(names).not.toContain('book_appointment');
    expect(names).not.toContain('cancel_appointment');
    expect(names).not.toContain('list_professionals');
    expect(names).toContain('derive_to_professional');
    // Lo que sí conserva: informar y dejar la ficha del paciente.
    expect(names).toEqual(
      expect.arrayContaining([
        'search_faqs',
        'list_treatments',
        'get_treatment_details',
        'get_patient_info',
        'register_patient',
        'request_handoff',
        'flag_urgent',
      ]),
    );
  });

  it('el modo normal sigue igual que siempre y no ve la derivación', () => {
    const names = getAgentToolDefinitions().map((d) => d.name);
    expect(names).toContain('book_appointment');
    expect(names).not.toContain('derive_to_professional');
  });
});

describe('el servidor cierra lo que el prompt sólo pide', () => {
  it('rechaza reservar en modo DERIVE sin llegar a la agenda', async () => {
    const trace = await executeAgentTool({
      tenantId: 'c1',
      toolName: 'book_appointment',
      rawArgs: { start_time: '2026-09-23T10:00:00Z', treatment_name: 'Fisioterapia' },
      mode: 'DERIVE',
    });

    expect(trace.ok).toBe(false);
    expect(trace.error).toBe('tool_not_available_in_mode');
    expect(dispatchToolMock).not.toHaveBeenCalled();
  });

  it('rechaza derivar en el modo normal', async () => {
    const trace = await executeAgentTool({
      tenantId: 'c1',
      toolName: 'derive_to_professional',
      rawArgs: { summary: 'Consulta por dolor de espalda desde hace una semana.' },
      mode: 'BOOKING',
    });

    expect(trace.ok).toBe(false);
    expect(resolveTargetMock).not.toHaveBeenCalled();
  });
});

describe('derive_to_professional', () => {
  it('deja en la traza a quién se enrutó, sin mandar nada', async () => {
    resolveTargetMock.mockResolvedValue({
      professionalId: 'p-ana',
      professionalName: 'Ana Ruiz',
      specialty: 'Fisioterapia',
      phoneE164: '+34600111222',
      treatmentName: 'Fisioterapia deportiva',
      via: 'treatment',
    });

    const trace = await executeAgentTool({
      tenantId: 'c1',
      toolName: 'derive_to_professional',
      rawArgs: {
        summary: 'Molestia en el hombro derecho desde hace dos semanas, empeora al levantar peso.',
        treatment_name: 'fisio deportiva',
        patient_name: 'Marta',
        preferred_time: 'martes por la tarde',
      },
      mode: 'DERIVE',
      deriveFallbackPhone: '+34699999999',
    });

    expect(trace.ok).toBe(true);
    expect(trace.data).toMatchObject({
      professionalId: 'p-ana',
      professionalName: 'Ana Ruiz',
      phoneE164: '+34600111222',
      patientName: 'Marta',
      preferredTime: 'martes por la tarde',
      via: 'treatment',
    });
    expect(resolveTargetMock).toHaveBeenCalledWith({
      tenantId: 'c1',
      treatmentName: 'fisio deportiva',
      fallbackPhone: '+34699999999',
    });
  });

  it('un resumen de dos palabras no pasa la validación', async () => {
    const trace = await executeAgentTool({
      tenantId: 'c1',
      toolName: 'derive_to_professional',
      rawArgs: { summary: 'hola' },
      mode: 'DERIVE',
    });

    expect(trace.ok).toBe(false);
    expect(trace.error).toBe('invalid_args');
  });
});

const BASE: BuildSystemPromptInput = {
  clinic: {
    name: 'Train Movements Center',
    address: 'Calle Falsa 123',
    phones: '+34600000000',
    workingHours: 'L-V 9:00-20:00',
    timezone: 'Europe/Madrid',
    transferNumber: '+34600000001',
  },
  treatments: [
    {
      name: 'Fisioterapia deportiva',
      durationMinutes: 45,
      priceMin: 45,
      priceMax: 45,
      currency: 'EUR',
      description: null,
    },
  ],
  faqs: [{ category: null, question: '¿Hay parking?', answer: 'Sí, en la puerta.' }],
  now: 'lunes 22 de septiembre de 2026, 11:00 (Europe/Madrid)',
};

describe('el prompt del modo DERIVE', () => {
  const prompt = buildSystemPrompt({ ...BASE, mode: 'DERIVE' });

  it('le prohíbe reservar y prometer horas', () => {
    expect(prompt).toContain('NO reservas');
    expect(prompt).toContain('NUNCA digas una hora');
  });

  it('le dice qué recoger y con qué herramienta cerrar', () => {
    expect(prompt).toContain('derive_to_professional');
    expect(prompt).toContain('A QUÉ SERVICIO del catálogo corresponde');
  });

  it('no le ofrece las herramientas de agenda', () => {
    expect(prompt).not.toContain('check_availability');
    expect(prompt).not.toContain('book_appointment');
  });

  it('mantiene el catálogo y las FAQs: sigue informando', () => {
    expect(prompt).toContain('Fisioterapia deportiva');
    expect(prompt).toContain('¿Hay parking?');
  });

  it('sin modo, el prompt es el de siempre', () => {
    const normal = buildSystemPrompt(BASE);
    expect(normal).toContain('check_availability');
    expect(normal).not.toContain('derive_to_professional');
  });
});
