import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Capturamos la fila que el código pasa a db.insert(...).values(...).
// Eso prueba la conversión de numéricos (intentConfidence → string .toFixed(2))
// y los defaults que pasamos vs los que pone la DB.
const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  onConflict: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({
      values: (row: unknown) => {
        mocks.insertValues(row);
        return {
          onConflictDoNothing: (cfg: unknown) => {
            mocks.onConflict(cfg);
            return {
              returning: (cols: unknown) => mocks.returning(cols),
            };
          },
        };
      },
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  whatsappAgentRuns: {
    id: 'id-col',
    conversationId: 'conv-col',
    triggerMessageId: 'trigger-col',
  },
}));

import { writeAgentRun } from '@/lib/whatsapp/agent/persist-run';
import type { AgentRunRecord } from '@/lib/whatsapp/agent/types';

function baseRecord(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    tenantId: 'tenant-1',
    conversationId: 'conv-1',
    triggerMessageId: 'msg-1',
    responseMessageId: 'msg-out-1',
    agent: 'main',
    model: 'gemini-flash-latest',
    intent: 'SCHEDULING',
    intentConfidence: 0.9,
    intentReasoning: null,
    handoff: false,
    urgent: false,
    tokensIn: 250,
    tokensOut: 30,
    latencyMs: 1500,
    fallbackUsed: false,
    toolsCalled: [
      {
        name: 'check_availability',
        args: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
        ok: true,
        result: 'Horarios disponibles: lunes 10:00',
        latencyMs: 200,
      },
    ],
    errorText: null,
    traceId: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.insertValues.mockReset();
  mocks.onConflict.mockReset();
  mocks.returning.mockReset();
});

describe('writeAgentRun', () => {
  it('inserta con onConflictDoNothing y devuelve la fila', async () => {
    mocks.returning.mockResolvedValue([{ id: 'run-1' }]);

    const out = await writeAgentRun(baseRecord());

    expect(out).toEqual({ id: 'run-1' });
    // Confirmamos que se usa el UNIQUE de idempotencia.
    expect(mocks.onConflict).toHaveBeenCalledWith({
      target: ['conv-col', 'trigger-col'],
    });
  });

  it('serializa intentConfidence como string con 2 decimales (Drizzle numeric)', async () => {
    mocks.returning.mockResolvedValue([{ id: 'run-2' }]);
    await writeAgentRun(baseRecord({ intentConfidence: 0.95 }));

    const inserted = mocks.insertValues.mock.calls[0]?.[0];
    expect(inserted.intentConfidence).toBe('0.95');
  });

  it('intentConfidence null queda null', async () => {
    mocks.returning.mockResolvedValue([{ id: 'run-3' }]);
    await writeAgentRun(baseRecord({ intentConfidence: null }));

    const inserted = mocks.insertValues.mock.calls[0]?.[0];
    expect(inserted.intentConfidence).toBeNull();
  });

  it('propaga toolsCalled tal cual como jsonb', async () => {
    mocks.returning.mockResolvedValue([{ id: 'run-4' }]);
    const record = baseRecord();
    await writeAgentRun(record);

    const inserted = mocks.insertValues.mock.calls[0]?.[0];
    expect(inserted.toolsCalled).toEqual(record.toolsCalled);
  });

  it('si hubo conflicto (idempotencia), returning vacío → devuelve null', async () => {
    mocks.returning.mockResolvedValue([]);
    const out = await writeAgentRun(baseRecord());
    expect(out).toBeNull();
  });
});
