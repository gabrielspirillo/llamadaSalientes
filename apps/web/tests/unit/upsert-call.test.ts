import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Fake mínimo del query builder de drizzle: nos interesa capturar qué columnas
// se escriben en el INSERT y en el ON CONFLICT DO UPDATE, no ejecutar SQL.
const state = vi.hoisted(() => ({
  values: null as Record<string, unknown> | null,
  conflictSet: null as Record<string, unknown> | null,
  conflictDoNothing: false,
  returned: [{ id: 'row-1' }] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.values = values;
        const returning = () => Promise.resolve(state.returned);
        return {
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
            state.conflictSet = set;
            return { returning };
          },
          onConflictDoNothing: () => {
            state.conflictDoNothing = true;
            return { returning };
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ id: 'row-1' }]) }),
      }),
    }),
  },
}));

import { upsertCall } from '@/lib/data/calls';

const BASE = { tenantId: 'tenant-1', retellCallId: 'call_abc' };

describe('upsertCall', () => {
  beforeEach(() => {
    state.values = null;
    state.conflictSet = null;
    state.conflictDoNothing = false;
    state.returned = [{ id: 'row-1' }];
  });

  it('inserta con los campos provistos cuando la llamada es nueva', async () => {
    await upsertCall({
      ...BASE,
      fromNumber: '+34600111222',
      toNumber: '+34910000000',
      startedAt: new Date('2026-07-23T10:00:00Z'),
      status: 'ongoing',
    });

    expect(state.values).toMatchObject({
      tenantId: 'tenant-1',
      retellCallId: 'call_abc',
      fromNumber: '+34600111222',
      toNumber: '+34910000000',
      status: 'ongoing',
      transferred: false,
    });
  });

  // Regresión: el evento call_analyzed llega después de call_ended y solo trae
  // transcript/resumen. Antes se escribía el objeto completo con `?? null` y
  // borraba número, inicio, fin y duración — dejando /dashboard/calls vacío.
  it('NO pisa columnas que el evento no manda', async () => {
    await upsertCall({
      ...BASE,
      status: 'ended',
      summary: 'El paciente pidió hora.',
      intent: 'agendar',
      sentiment: 'neutro',
    });

    expect(state.conflictSet).toEqual({
      status: 'ended',
      summary: 'El paciente pidió hora.',
      intent: 'agendar',
      sentiment: 'neutro',
    });
    // Lo importante: estas claves ni siquiera aparecen en el UPDATE.
    for (const key of [
      'fromNumber',
      'toNumber',
      'startedAt',
      'endedAt',
      'durationSeconds',
      'ghlContactId',
      'transferred',
    ]) {
      expect(state.conflictSet).not.toHaveProperty(key);
    }
  });

  it('permite borrar un valor explícitamente con null', async () => {
    await upsertCall({ ...BASE, ghlContactId: null });

    expect(state.conflictSet).toEqual({ ghlContactId: null });
  });

  it('no actualiza nada si el evento no trae campos', async () => {
    state.returned = [];

    const row = await upsertCall(BASE);

    expect(state.conflictDoNothing).toBe(true);
    expect(state.conflictSet).toBeNull();
    // Cae al SELECT para devolver la fila que ya existía.
    expect(row).toEqual({ id: 'row-1' });
  });
});
