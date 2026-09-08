import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Futura entra a las clínicas impersonando: no es miembro de ninguna, así que
// no tiene fila en `tenant_memberships`. Cada gate la buscaba, no la
// encontraba y la trataba como `viewer`: desde el banco de pruebas de los
// asistentes ("Rol viewer insuficiente, se requiere operator+") hasta las
// automatizaciones de Tareas. Estos tests fijan la regla: super-admin = admin
// en cualquier clínica, y para el resto nada cambia.
const state = vi.hoisted(() => ({
  // Cola de resultados: cada `.limit()` del query builder consume el primero.
  rows: [] as Array<Array<Record<string, unknown>>>,
  tenant: { id: 'clinica-1', clerkOrganizationId: 'org_clinica' },
  clerkUserId: 'user_futura',
  isSuperAdmin: false,
  impersonating: false,
  orgRole: 'org:member' as string | null,
  ensured: vi.fn(async (_clerkUserId: string) => 'u-futura'),
  professional: null as Record<string, unknown> | null,
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
  getCurrentTenant: async () => ({
    tenant: state.tenant,
    userId: state.clerkUserId,
    isSuperAdmin: state.isSuperAdmin,
    impersonating: state.impersonating,
    realTenant: { id: 'futura', clerkOrganizationId: 'org_futura' },
  }),
}));

vi.mock('@/lib/auth/internal-user', () => ({
  internalUserIdFor: async () => null,
  ensureInternalUserId: (clerkUserId: string) => state.ensured(clerkUserId),
}));

vi.mock('@/lib/agenda/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agenda/access')>()),
  findProfessionalForClerkUser: async () => state.professional,
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ orgRole: state.orgRole }),
}));

import { getAgendaContext } from '@/lib/agenda/auth';
import { resolveTenantRole } from '@/lib/auth/tenant-role';
import { MessagingForbiddenError, requireMessagingRole } from '@/lib/messaging/auth';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';
import { TaskForbiddenError, requireTaskRole } from '@/lib/tasks/auth';
import { WaitlistForbiddenError, requireWaitlistRole } from '@/lib/waitlist/auth';

const DENTISTA_RESTRINGIDA = {
  id: 'prof-1',
  fullName: 'Dra. Restringida',
  panelAccess: 'AGENDA_ONLY',
  agendaEnabled: true,
  active: true,
  color: '#000',
};

beforeEach(() => {
  state.rows = [];
  state.isSuperAdmin = false;
  state.impersonating = false;
  state.orgRole = 'org:member';
  state.professional = null;
  state.ensured.mockClear();
});

/** Futura gestionando una clínica ajena: super-admin y sin fila de membresía. */
function futuraGestionando() {
  state.isSuperAdmin = true;
  state.impersonating = true;
  state.rows = [[]];
}

describe('resolveTenantRole', () => {
  it('Futura gestionando una clínica es admin aunque no sea miembro', async () => {
    futuraGestionando();

    const ctx = await resolveTenantRole();

    expect(ctx).toMatchObject({
      tenantId: 'clinica-1',
      clerkOrganizationId: 'org_clinica',
      clerkUserId: 'user_futura',
      role: 'admin',
      internalUserId: 'u-futura',
      isSuperAdmin: true,
      impersonating: true,
    });
    // Sin fila local no hay `users.id` con el que firmar lo que escriba: se
    // garantiza que exista.
    expect(state.ensured).toHaveBeenCalledWith('user_futura');
  });

  it('Futura en su propia clínica es admin aunque su fila diga otra cosa', async () => {
    state.isSuperAdmin = true;
    state.rows = [[{ role: 'org:member', internalUserId: 'u-1' }]];

    const ctx = await resolveTenantRole();

    expect(ctx.role).toBe('admin');
    expect(ctx.internalUserId).toBe('u-1');
    expect(state.ensured).not.toHaveBeenCalled();
  });

  it('un usuario normal sale de su membresía, normalizada', async () => {
    state.rows = [[{ role: 'org:member', internalUserId: 'u-2' }]];

    const ctx = await resolveTenantRole();

    expect(ctx).toMatchObject({ role: 'operator', internalUserId: 'u-2', isSuperAdmin: false });
    expect(state.ensured).not.toHaveBeenCalled();
  });

  it('sin membresía y sin ser Futura no hay rol ni usuario interno', async () => {
    state.rows = [[]];

    const ctx = await resolveTenantRole();

    expect(ctx.role).toBeNull();
    expect(ctx.internalUserId).toBeNull();
    expect(state.ensured).not.toHaveBeenCalled();
  });
});

describe('los gates dejan pasar a Futura como admin en la clínica que gestiona', () => {
  it('requireTaskRole — el que usan denyUnlessRole y las Server Actions', async () => {
    futuraGestionando();
    await expect(requireTaskRole('admin')).resolves.toMatchObject({
      tenantId: 'clinica-1',
      userId: 'u-futura',
      clerkUserId: 'user_futura',
      role: 'admin',
    });
  });

  it('…aunque tenga ficha de profesional restringida en esa clínica', async () => {
    futuraGestionando();
    state.professional = DENTISTA_RESTRINGIDA;
    await expect(requireTaskRole('operator')).resolves.toMatchObject({ role: 'admin' });
  });

  it('requireMessagingRole', async () => {
    futuraGestionando();
    await expect(requireMessagingRole('admin')).resolves.toMatchObject({
      userId: 'u-futura',
      role: 'admin',
    });
  });

  it('requireReminderRole', async () => {
    futuraGestionando();
    await expect(requireReminderRole('admin')).resolves.toEqual({
      tenantId: 'clinica-1',
      userId: 'u-futura',
      role: 'admin',
    });
  });

  it('requireWaitlistRole', async () => {
    futuraGestionando();
    await expect(requireWaitlistRole('admin')).resolves.toEqual({
      tenantId: 'clinica-1',
      userId: 'u-futura',
      role: 'admin',
    });
  });

  it('getAgendaContext — configura profesionales y ve todas las agendas', async () => {
    futuraGestionando();
    await expect(getAgendaContext()).resolves.toMatchObject({
      role: 'admin',
      userId: 'u-futura',
      isSuperAdmin: true,
      impersonating: true,
      scope: 'ALL',
      canManageProfessionals: true,
      canWriteAppointments: true,
      agendaOnly: false,
    });
  });
});

describe('para el resto no cambia nada', () => {
  it('sin membresía → 403 como viewer en los cuatro gates', async () => {
    state.rows = [[]];
    await expect(requireTaskRole('viewer')).rejects.toMatchObject({
      name: 'TaskForbiddenError',
      actual: 'viewer',
    });
    state.rows = [[]];
    await expect(requireMessagingRole('viewer')).rejects.toBeInstanceOf(MessagingForbiddenError);
    state.rows = [[]];
    await expect(requireReminderRole('viewer')).rejects.toBeInstanceOf(ReminderForbiddenError);
    state.rows = [[]];
    await expect(requireWaitlistRole('viewer')).rejects.toBeInstanceOf(WaitlistForbiddenError);
  });

  it('un operator sigue sin llegar a admin', async () => {
    state.rows = [[{ role: 'org:member', internalUserId: 'u-2' }]];
    await expect(requireTaskRole('admin')).rejects.toMatchObject({
      name: 'TaskForbiddenError',
      actual: 'operator',
      required: 'admin',
    });
  });

  it('un admin de la clínica pasa con su users.id de la fila local', async () => {
    state.rows = [[{ role: 'org:admin', internalUserId: 'u-admin' }]];
    await expect(requireTaskRole('admin')).resolves.toMatchObject({
      userId: 'u-admin',
      role: 'admin',
    });
    expect(state.ensured).not.toHaveBeenCalled();
  });

  it('un profesional AGENDA_ONLY sigue fuera del resto del panel', async () => {
    state.rows = [[{ role: 'org:member', internalUserId: 'u-dentista' }]];
    state.professional = DENTISTA_RESTRINGIDA;
    await expect(requireTaskRole('operator')).rejects.toBeInstanceOf(TaskForbiddenError);
  });

  it('la agenda sigue cayendo al rol de Clerk cuando no hay fila local', async () => {
    state.rows = [[]];
    state.orgRole = 'org:admin';
    await expect(getAgendaContext()).resolves.toMatchObject({
      role: 'admin',
      userId: null,
      isSuperAdmin: false,
      canManageProfessionals: true,
    });
  });
});
