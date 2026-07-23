import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Cola de resultados que devuelve el .limit(1) del select de tenants, en orden.
const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  getOrganization: vi.fn(),
  ensureTenantForOrg: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          // Cada llamada consume el próximo resultado de la cola.
          limit: () => Promise.resolve(mocks.selectResults.shift() ?? []),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  tenants: { clerkOrganizationId: 'clerk_org_col' },
}));

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    organizations: { getOrganization: mocks.getOrganization },
  }),
}));

vi.mock('@/lib/provision-tenant', () => ({
  ensureTenantForOrg: mocks.ensureTenantForOrg,
}));

import { TenantNotFoundError, resolveTenantForOrg } from '@/lib/tenant';

const TENANT = { id: 'tenant-1', name: 'Clínica X', clerkOrganizationId: 'org_123' };

beforeEach(() => {
  mocks.selectResults = [];
  mocks.getOrganization.mockReset();
  mocks.ensureTenantForOrg.mockReset();
});

describe('resolveTenantForOrg', () => {
  it('devuelve el tenant existente sin provisionar', async () => {
    mocks.selectResults = [[TENANT]]; // primer lookup ya lo encuentra

    const res = await resolveTenantForOrg('org_123', 'user_1');

    expect(res.tenant).toEqual(TENANT);
    expect(res.userId).toBe('user_1');
    expect(mocks.ensureTenantForOrg).not.toHaveBeenCalled();
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });

  it('auto-provisiona y NO tira 500 cuando falta el tenant (el bug corregido)', async () => {
    // 1er lookup: vacío → provisiona → 2do lookup: encuentra el tenant nuevo.
    mocks.selectResults = [[], [TENANT]];
    mocks.getOrganization.mockResolvedValue({ name: 'Clínica X', slug: 'clinica-x' });
    mocks.ensureTenantForOrg.mockResolvedValue({ id: 'tenant-1' });

    const res = await resolveTenantForOrg('org_123', 'user_1');

    expect(res.tenant).toEqual(TENANT);
    expect(mocks.getOrganization).toHaveBeenCalledWith({ organizationId: 'org_123' });
    expect(mocks.ensureTenantForOrg).toHaveBeenCalledWith({
      clerkOrgId: 'org_123',
      name: 'Clínica X',
      slug: 'clinica-x',
    });
  });

  it('tira TenantNotFoundError solo si tras provisionar sigue sin aparecer', async () => {
    mocks.selectResults = [[], []]; // ambos lookups vacíos
    mocks.getOrganization.mockResolvedValue({ name: 'Clínica X', slug: null });
    mocks.ensureTenantForOrg.mockResolvedValue({ id: 'tenant-1' });

    await expect(resolveTenantForOrg('org_123', 'user_1')).rejects.toBeInstanceOf(
      TenantNotFoundError,
    );
  });
});
