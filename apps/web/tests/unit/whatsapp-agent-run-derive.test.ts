import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * El pegamento del modo DERIVE dentro del orquestador.
 *
 * Tres cosas que se rompen sin darse cuenta: que derivar corte el loop, que la
 * despedida la escriba la app (el modelo no sabe a quién se enrutó la consulta)
 * y que el parte salga en el `AgentOutput` — porque el WhatsApp al profesional
 * lo manda el worker leyendo justamente ese campo.
 */
const mocks = vi.hoisted(() => ({
  loadGrounding: vi.fn(),
  callLLM: vi.fn(),
  executeAgentTool: vi.fn(),
  settings: vi.fn(),
}));

vi.mock('@/lib/whatsapp/agent/prompt', () => ({
  HANDOFF_RESPONSE_TEXT: 'Te paso con recepción. En breve te contactan para ayudarte.',
  buildSystemPrompt: () => 'SYSTEM_PROMPT_STUB',
  formatNowInClinicZone: () => 'lunes 22 de septiembre de 2026, 11:00 (Europe/Madrid)',
  loadGroundingForTenant: mocks.loadGrounding,
}));
vi.mock('@/lib/whatsapp/agent/llm', () => ({ callLLM: mocks.callLLM }));
vi.mock('@/lib/whatsapp/agent/tools', () => ({
  executeAgentTool: mocks.executeAgentTool,
  getAgentToolDefinitions: () => [],
}));
vi.mock('@/lib/memory/lead-memory', () => ({
  getLeadMemory: async () => null,
  updateLeadMemory: async () => undefined,
}));
vi.mock('@/lib/data/whatsapp-agent-settings', () => ({ getWhatsappAgentSettings: mocks.settings }));
// `derivation` se carga de verdad (queremos el texto real de la despedida);
// sólo se le corta el acceso a la base.
vi.mock('@/lib/db/client', () => ({ db: {} }));

import { runWhatsappAgent } from '@/lib/whatsapp/agent';

const INPUT = {
  tenantId: 'tenant-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  contactPhoneE164: '+34699111222',
  userText: 'Hola, me duele el hombro al levantar peso. ¿Podéis verme?',
  history: [],
  triggerMessageId: 'msg-1',
};

beforeEach(() => {
  mocks.loadGrounding.mockReset();
  mocks.callLLM.mockReset();
  mocks.executeAgentTool.mockReset();
  mocks.settings.mockReset();
  mocks.loadGrounding.mockResolvedValue({
    clinic: {
      name: 'Train Movements Center',
      address: 'C/ Falsa 123',
      phones: '+34 911 222 333',
      workingHours: 'lunes 09:00-14:00',
      timezone: 'Europe/Madrid',
      transferNumber: '+34 911 222 333',
    },
    treatments: [],
    faqs: [],
    professionals: '',
  });
  mocks.settings.mockResolvedValue({
    persona: null,
    agentName: null,
    mode: 'DERIVE',
    deriveFallbackPhone: '+34699999999',
  });
});

function llmPideDerivar() {
  mocks.callLLM.mockResolvedValue({
    text: 'Le paso tu consulta.',
    toolCalls: [
      {
        id: 'call-1',
        name: 'derive_to_professional',
        args: { summary: 'Molestia en el hombro derecho al levantar peso.' },
      },
    ],
    tokensIn: 100,
    tokensOut: 20,
    model: 'gemini-flash-latest',
    fallbackUsed: false,
  });
}

describe('runWhatsappAgent en modo DERIVE', () => {
  it('derivar corta el loop y devuelve el parte para el worker', async () => {
    llmPideDerivar();
    mocks.executeAgentTool.mockResolvedValue({
      name: 'derive_to_professional',
      args: {},
      ok: true,
      result: 'Consulta derivada a Ana Ruiz.',
      latencyMs: 4,
      data: {
        professionalId: 'p-ana',
        professionalName: 'Ana Ruiz',
        phoneE164: '+34600111222',
        treatmentName: 'Fisioterapia deportiva',
        summary: 'Molestia en el hombro derecho al levantar peso.',
        patientName: 'Marta',
        preferredTime: null,
        urgent: false,
        via: 'treatment',
      },
    });

    const out = await runWhatsappAgent(INPUT);

    // Una sola vuelta: no se le vuelve a preguntar al modelo después de derivar.
    expect(mocks.callLLM).toHaveBeenCalledTimes(1);
    expect(out.derivation).toMatchObject({
      professionalName: 'Ana Ruiz',
      phoneE164: '+34600111222',
      patientPhoneE164: '+34699111222',
      via: 'treatment',
    });
    // La despedida la pone la app, no el modelo.
    expect(out.responseText).toContain('Ana Ruiz');
    expect(out.responseText).not.toBe('Le paso tu consulta.');
    // La conversación NO queda marcada como handoff: el asistente sigue
    // atendiendo si el paciente vuelve a escribir.
    expect(out.handoff).toBe(false);
  });

  it('el modo y el número de respaldo llegan a las tools', async () => {
    llmPideDerivar();
    mocks.executeAgentTool.mockResolvedValue({
      name: 'derive_to_professional',
      args: {},
      ok: true,
      result: 'ok',
      latencyMs: 2,
      data: { summary: 'x', via: 'respaldo', phoneE164: '+34699999999' },
    });

    await runWhatsappAgent(INPUT);

    expect(mocks.executeAgentTool).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'DERIVE', deriveFallbackPhone: '+34699999999' }),
    );
  });

  it('una urgencia marcada antes viaja en el parte aunque la tool no la marque', async () => {
    mocks.callLLM
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'c1', name: 'flag_urgent', args: { reason: 'dolor agudo' } }],
        tokensIn: 50,
        tokensOut: 5,
        model: 'gemini-flash-latest',
        fallbackUsed: false,
      })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          {
            id: 'c2',
            name: 'derive_to_professional',
            args: { summary: 'Dolor lumbar agudo desde esta mañana.' },
          },
        ],
        tokensIn: 60,
        tokensOut: 6,
        model: 'gemini-flash-latest',
        fallbackUsed: false,
      });
    mocks.executeAgentTool
      .mockResolvedValueOnce({
        name: 'flag_urgent',
        args: {},
        ok: true,
        result: 'URGENT marcado',
        latencyMs: 1,
      })
      .mockResolvedValueOnce({
        name: 'derive_to_professional',
        args: {},
        ok: true,
        result: 'ok',
        latencyMs: 2,
        data: {
          summary: 'Dolor lumbar agudo desde esta mañana.',
          via: 'treatment',
          professionalName: 'Ana Ruiz',
          phoneE164: '+34600111222',
          urgent: false,
        },
      });

    const out = await runWhatsappAgent(INPUT);

    expect(out.urgent).toBe(true);
    expect(out.derivation?.urgent).toBe(true);
    expect(out.intent).toBe('URGENT');
  });

  it('si la derivación falla, el asistente sigue y no inventa que ya avisó', async () => {
    llmPideDerivar();
    mocks.executeAgentTool.mockResolvedValue({
      name: 'derive_to_professional',
      args: {},
      ok: false,
      result: 'No se pudo derivar la consulta: base caída',
      latencyMs: 3,
      error: 'base caída',
    });

    const out = await runWhatsappAgent(INPUT);

    expect(out.derivation).toBeNull();
    // El loop siguió: se le devolvió el error al modelo para que reaccione.
    expect(mocks.callLLM.mock.calls.length).toBeGreaterThan(1);
  });
});
