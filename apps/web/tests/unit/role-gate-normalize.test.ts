import { describe, expect, it } from 'vitest';

vi.mock('server-only', () => ({}));

import { normalizeRole } from '@/lib/tasks/auth';

// Regresión: los gates de recordatorios y lista de espera comparaban el rol
// crudo de Clerk contra una tabla que sólo conoce viewer/operator/admin. Como
// `member` no está en ella, `ORDER[role] < ORDER['admin']` era
// `undefined < 2` → false, y el gate dejaba pasar a cualquier miembro.
const ORDER = { viewer: 0, operator: 1, admin: 2 } as const;

describe('normalizeRole en los gates de rol', () => {
  it('mapea los roles crudos de Clerk a los tres del producto', () => {
    expect(normalizeRole('member')).toBe('operator');
    expect(normalizeRole('basic_member')).toBe('operator');
    expect(normalizeRole('org:admin')).toBe('admin');
    expect(normalizeRole('org:viewer')).toBe('viewer');
    expect(normalizeRole(null)).toBe('operator');
  });

  it('un member de Clerk no supera el gate de admin', () => {
    const role = normalizeRole('member');
    expect(ORDER[role] < ORDER.admin).toBe(true);
  });

  it('comparar el rol sin normalizar dejaba pasar el gate', () => {
    const raw = 'member' as unknown as keyof typeof ORDER;
    expect(ORDER[raw] < ORDER.admin).toBe(false);
  });
});
