import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

beforeAll(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
});

const createMock = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: { create: createMock },
      },
    })),
  };
});

afterEach(() => {
  createMock.mockReset();
});

describe('summarizeCall', () => {
  it('parsea JSON válido y retorna shape esperado', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: 'agendar',
              sentiment: 'positivo',
              summary: 'El paciente quiere agendar una limpieza para el martes.',
              followUp: null,
            }),
          },
        },
      ],
    });

    const { summarizeCall } = await import('@/lib/openai/client');
    const transcript = 'Hola, quiero agendar una limpieza dental para el martes a las 10.';
    const result = await summarizeCall(transcript);

    expect(result.intent).toBe('agendar');
    expect(result.sentiment).toBe('positivo');
    expect(result.summary).toContain('limpieza');
    expect(result.followUp).toBeNull();
  });

  it('rellena defaults si OpenAI omite campos', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '{}' } }],
    });

    const { summarizeCall } = await import('@/lib/openai/client');
    const result = await summarizeCall('algo lo suficientemente largo para no cortar');

    expect(result.intent).toBe('otro');
    expect(result.sentiment).toBe('neutro');
    expect(result.summary).toBe('Sin resumen disponible.');
  });

  it('retorna fallback sin llamar a OpenAI si transcript es muy corto', async () => {
    const { summarizeCall } = await import('@/lib/openai/client');
    const result = await summarizeCall('hola');

    expect(result.summary).toContain('demasiado corta');
    expect(createMock).not.toHaveBeenCalled();
  });
});
