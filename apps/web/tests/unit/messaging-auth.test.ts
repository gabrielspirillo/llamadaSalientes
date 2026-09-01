import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Los gates de rol son la única cosa que separa a un `viewer` de borrar un
// canal. Se testean sin base: el query builder de drizzle se falsea y lo que
// se prueba es la DECISIÓN, no el SQL.
const state = vi.hoisted(() => ({
  // Cola de resultados: cada `.limit()` consume el primero.
  rows: [] as Array<Array<Record<string, unknown>>>,
  tenant: {
    id: 'tenant-1',
    clerkOrganizationId: 'org_1',
  } as Record<string, unknown>,
  clerkUserId: 'user_clerk_1',
}));

vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(state.rows.shift() ?? []);
  return { db: { select: () => chain } };
});

vi.mock('@/lib/tenant', () => ({
  getCurrentTenant: async () => ({ tenant: state.tenant, userId: state.clerkUserId }),
}));

import {
  canPostIn,
  MessagingForbiddenError,
  NotChannelMemberError,
  requireChannelManager,
  requireChannelMember,
  requireMessagingRole,
  type MessagingAuthContext,
  type MessagingRole,
} from '@/lib/messaging/auth';
import { IM_CHANNEL_KINDS } from '@/lib/messaging/constants';

const ROLES: MessagingRole[] = ['viewer', 'operator', 'admin'];

function auth(role: MessagingRole): MessagingAuthContext {
  return {
    tenantId: 'tenant-1',
    clerkOrganizationId: 'org_1',
    userId: 'u-1',
    clerkUserId: 'user_clerk_1',
    role,
  };
}

beforeEach(() => {
  state.rows = [];
  state.tenant = { id: 'tenant-1', clerkOrganizationId: 'org_1' };
  state.clerkUserId = 'user_clerk_1';
});

describe('canPostIn — matriz rol × tipo de canal', () => {
  // Criterio implementado: el `viewer` es quien mira números sin operar. No
  // publica en canales de trabajo, pero sí en sus conversaciones privadas:
  // silenciarlo del todo lo deja fuera de la coordinación sin ganar nada.
  const ESPERADO: Record<MessagingRole, Record<string, boolean>> = {
    viewer: { PUBLIC: false, PRIVATE: false, DM: true, GROUP: true, CONTEXT: false },
    operator: { PUBLIC: true, PRIVATE: true, DM: true, GROUP: true, CONTEXT: true },
    admin: { PUBLIC: true, PRIVATE: true, DM: true, GROUP: true, CONTEXT: true },
  };

  for (const role of ROLES) {
    for (const kind of IM_CHANNEL_KINDS) {
      it(`${role} en ${kind} → ${ESPERADO[role][kind] ? 'puede' : 'no puede'}`, () => {
        expect(canPostIn(role, kind)).toBe(ESPERADO[role][kind]);
      });
    }
  }

  it('cubre los 5 kinds declarados en constants (si se agrega uno, este test lo caza)', () => {
    expect([...IM_CHANNEL_KINDS].sort()).toEqual([
      'CONTEXT',
      'DM',
      'GROUP',
      'PRIVATE',
      'PUBLIC',
    ]);
  });

  it('un kind desconocido bloquea al viewer y deja pasar al resto', () => {
    expect(canPostIn('viewer', 'ALGO_NUEVO')).toBe(false);
    expect(canPostIn('operator', 'ALGO_NUEVO')).toBe(true);
  });
});

describe('requireMessagingRole', () => {
  it('devuelve el contexto con el users.id interno y el rol normalizado', async () => {
    state.rows = [[{ role: 'org:admin', internalUserId: 'u-99' }]];

    const ctx = await requireMessagingRole('viewer');

    expect(ctx).toEqual({
      tenantId: 'tenant-1',
      clerkOrganizationId: 'org_1',
      userId: 'u-99',
      clerkUserId: 'user_clerk_1',
      role: 'admin',
    });
  });

  it('normaliza los roles raros de Clerk a operator', async () => {
    state.rows = [[{ role: 'org:basic_member', internalUserId: 'u-2' }]];
    expect((await requireMessagingRole('viewer')).role).toBe('operator');
  });

  it('sin membresía en el tenant → MessagingForbiddenError', async () => {
    state.rows = [[]];
    await expect(requireMessagingRole('viewer')).rejects.toBeInstanceOf(MessagingForbiddenError);
  });

  it('respeta la jerarquía viewer < operator < admin', async () => {
    // operator no llega a admin
    state.rows = [[{ role: 'org:member', internalUserId: 'u-2' }]];
    await expect(requireMessagingRole('admin')).rejects.toBeInstanceOf(MessagingForbiddenError);

    // admin sí llega a operator
    state.rows = [[{ role: 'org:admin', internalUserId: 'u-2' }]];
    await expect(requireMessagingRole('operator')).resolves.toMatchObject({ role: 'admin' });

    // viewer no llega a operator
    state.rows = [[{ role: 'org:viewer', internalUserId: 'u-2' }]];
    await expect(requireMessagingRole('operator')).rejects.toBeInstanceOf(MessagingForbiddenError);

    // viewer sí llega a viewer
    state.rows = [[{ role: 'org:viewer', internalUserId: 'u-2' }]];
    await expect(requireMessagingRole('viewer')).resolves.toMatchObject({ role: 'viewer' });
  });

  it('el mínimo por defecto es viewer', async () => {
    state.rows = [[{ role: 'org:viewer', internalUserId: 'u-2' }]];
    await expect(requireMessagingRole()).resolves.toMatchObject({ role: 'viewer' });
  });

  it('el error dice qué rol hace falta', async () => {
    state.rows = [[{ role: 'org:viewer', internalUserId: 'u-2' }]];
    await expect(requireMessagingRole('admin')).rejects.toMatchObject({
      name: 'MessagingForbiddenError',
      actual: 'viewer',
      required: 'admin',
    });
  });
});

describe('requireChannelMember', () => {
  it('devuelve el rol de miembro y el kind del canal', async () => {
    state.rows = [[{ memberRole: 'OWNER', kind: 'PRIVATE' }]];

    await expect(requireChannelMember(auth('operator'), 'c-1')).resolves.toEqual({
      channelId: 'c-1',
      memberRole: 'OWNER',
      kind: 'PRIVATE',
    });
  });

  it('un no-miembro no puede leer un canal privado', async () => {
    state.rows = [[]]; // el join no trae fila: o no es miembro o se fue
    await expect(requireChannelMember(auth('operator'), 'c-privado')).rejects.toBeInstanceOf(
      NotChannelMemberError,
    );
  });

  it('ni siquiera un admin del tenant entra a un canal del que no es miembro', async () => {
    state.rows = [[]];
    await expect(requireChannelMember(auth('admin'), 'c-privado')).rejects.toBeInstanceOf(
      NotChannelMemberError,
    );
  });
});

describe('requireChannelManager', () => {
  it('el OWNER del canal puede gestionarlo aunque sea operator', async () => {
    state.rows = [[{ memberRole: 'OWNER', kind: 'PUBLIC' }]];
    await expect(requireChannelManager(auth('operator'), 'c-1')).resolves.toBeUndefined();
  });

  it('un admin del tenant puede gestionar un canal donde es MEMBER', async () => {
    state.rows = [[{ memberRole: 'MEMBER', kind: 'PUBLIC' }]];
    await expect(requireChannelManager(auth('admin'), 'c-1')).resolves.toBeUndefined();
  });

  it('un MEMBER operator NO puede gestionar el canal', async () => {
    state.rows = [[{ memberRole: 'MEMBER', kind: 'PUBLIC' }]];
    await expect(requireChannelManager(auth('operator'), 'c-1')).rejects.toBeInstanceOf(
      MessagingForbiddenError,
    );
  });

  it('un MEMBER viewer tampoco', async () => {
    state.rows = [[{ memberRole: 'MEMBER', kind: 'PUBLIC' }]];
    await expect(requireChannelManager(auth('viewer'), 'c-1')).rejects.toBeInstanceOf(
      MessagingForbiddenError,
    );
  });

  it('un no-miembro falla antes, con NotChannelMemberError', async () => {
    state.rows = [[]];
    await expect(requireChannelManager(auth('admin'), 'c-1')).rejects.toBeInstanceOf(
      NotChannelMemberError,
    );
  });
});
