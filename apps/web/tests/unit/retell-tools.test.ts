import { describe, expect, it, vi, beforeAll } from 'vitest';

// Mock de server-only para que no rompa en el entorno de test
vi.mock('server-only', () => ({}));

// Mock del módulo ghl-integration para controlar si GHL está conectado
vi.mock('@/lib/data/ghl-integration', () => ({
  getGhlIntegration: vi.fn(),
}));

// Mock del cliente GHL para no hacer fetch reales
vi.mock('@/lib/ghl/client', () => ({
  ghlFetch: vi.fn(),
  GhlApiError: class GhlApiError extends Error {
    constructor(public status: number, public path: string, public body: string) {
      super(`GHL ${status}`);
      this.name = 'GhlApiError';
    }
  },
}));

import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { ghlFetch } from '@/lib/ghl/client';
import { dispatchTool, checkAvailability, getPatientInfo } from '@/lib/retell/tools';

const mockGetGhlIntegration = vi.mocked(getGhlIntegration);
const mockGhlFetch = vi.mocked(ghlFetch);

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 'a').toString('base64');
});

describe('dispatchTool', () => {
  it('devuelve mensaje de GHL no conectado si no hay integración', async () => {
    mockGetGhlIntegration.mockResolvedValue(null);
    const result = await dispatchTool('tenant-1', 'check_availability', {
      treatment_name: 'limpieza',
      preferred_date: '2025-06-01',
    });
    expect(result.result).toContain('CRM no está conectado');
  });

  it('retorna mensaje para tool desconocida', async () => {
    mockGetGhlIntegration.mockResolvedValue(null);
    const result = await dispatchTool('tenant-1', 'unknown_tool', {});
    expect(result.result).toContain('Tool desconocida');
  });
});

describe('checkAvailability', () => {
  it('formatea slots correctamente cuando GHL responde', async () => {
    mockGetGhlIntegration.mockResolvedValue({
      tenantId: 'tenant-1',
      locationId: 'loc-123',
      companyId: null,
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: 'contacts.readonly',
      connectedBy: null,
      connectedAt: new Date(),
    });

    mockGhlFetch.mockResolvedValue({
      slots: [
        { startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T10:30:00Z' },
        { startTime: '2025-06-01T14:00:00Z', endTime: '2025-06-01T14:30:00Z' },
      ],
    });

    const result = await checkAvailability('tenant-1', {
      treatment_name: 'limpieza dental',
      preferred_date: '2025-06-01',
    });

    expect(result.result).toContain('Horarios disponibles');
  });

  it('responde amigablemente cuando no hay slots', async () => {
    mockGetGhlIntegration.mockResolvedValue({
      tenantId: 'tenant-1',
      locationId: 'loc-123',
      companyId: null,
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: 'contacts.readonly',
      connectedBy: null,
      connectedAt: new Date(),
    });

    mockGhlFetch.mockResolvedValue({ slots: [] });

    const result = await checkAvailability('tenant-1', {
      treatment_name: 'blanqueamiento',
      preferred_date: '2025-06-01',
    });

    expect(result.result).toContain('No hay disponibilidad');
  });
});

describe('getPatientInfo', () => {
  it('devuelve datos del paciente si existe en GHL', async () => {
    mockGetGhlIntegration.mockResolvedValue({
      tenantId: 'tenant-1',
      locationId: 'loc-123',
      companyId: null,
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: 'contacts.readonly',
      connectedBy: null,
      connectedAt: new Date(),
    });

    mockGhlFetch.mockResolvedValue({
      contacts: [
        { id: 'contact-abc', firstName: 'María', lastName: 'García', email: 'maria@test.com' },
      ],
    });

    const result = await getPatientInfo('tenant-1', { phone: '+525512345678' });
    expect(result.result).toContain('María García');
    expect(result.result).toContain('contact-abc');
  });

  it('indica paciente nuevo si no existe', async () => {
    mockGetGhlIntegration.mockResolvedValue({
      tenantId: 'tenant-1',
      locationId: 'loc-123',
      companyId: null,
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      expiresAt: new Date(Date.now() + 3600_000),
      scopes: 'contacts.readonly',
      connectedBy: null,
      connectedAt: new Date(),
    });

    mockGhlFetch.mockResolvedValue({ contacts: [] });

    const result = await getPatientInfo('tenant-1', { phone: '+525599999999' });
    expect(result.result).toContain('paciente nuevo');
  });
});
