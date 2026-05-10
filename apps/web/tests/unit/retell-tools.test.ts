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

// Mock de calendars (evita pulling de DB client + env)
vi.mock('@/lib/ghl/calendars', () => ({
  resolveCalendarId: vi.fn(),
  getFreeSlots: vi.fn(),
  listCalendars: vi.fn(),
}));

// Mock de data/calls (evita pulling de DB en tests)
vi.mock('@/lib/data/calls', () => ({
  patchCallCustomData: vi.fn(),
  setCallGhlContact: vi.fn(),
  upsertCall: vi.fn(),
  getCallByRetellId: vi.fn(),
  logCallEvent: vi.fn(),
}));

import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { ghlFetch } from '@/lib/ghl/client';
import { getFreeSlots, resolveCalendarId } from '@/lib/ghl/calendars';
import { dispatchTool, checkAvailability, getPatientInfo } from '@/lib/retell/tools';

const mockGetGhlIntegration = vi.mocked(getGhlIntegration);
const mockGhlFetch = vi.mocked(ghlFetch);
const mockResolveCalendarId = vi.mocked(resolveCalendarId);
const mockGetFreeSlots = vi.mocked(getFreeSlots);

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
  const mockIntegration = {
    tenantId: 'tenant-1',
    locationId: 'loc-123',
    companyId: null,
    accessTokenEnc: 'enc',
    refreshTokenEnc: 'enc',
    expiresAt: new Date(Date.now() + 3600_000),
    scopes: 'pit',
    connectedBy: null,
    connectedAt: new Date(),
  };

  // Fecha futura: 30 días desde hoy
  const futureDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  it('formatea slots correctamente cuando GHL responde', async () => {
    mockGetGhlIntegration.mockResolvedValue(mockIntegration);
    mockResolveCalendarId.mockResolvedValue({ calendarId: 'cal-1', reason: 'first-active' });
    mockGetFreeSlots.mockResolvedValue([
      { startTime: `${futureDate}T10:00:00Z`, endTime: `${futureDate}T10:30:00Z` },
      { startTime: `${futureDate}T14:00:00Z`, endTime: `${futureDate}T14:30:00Z` },
    ]);

    const result = await checkAvailability('tenant-1', {
      treatment_name: 'limpieza dental',
      preferred_date: futureDate,
    });

    expect(result.result).toContain('Horarios disponibles');
    expect(mockResolveCalendarId).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      treatmentName: 'limpieza dental',
    }));
  });

  it('responde amigablemente cuando no hay slots', async () => {
    mockGetGhlIntegration.mockResolvedValue(mockIntegration);
    mockResolveCalendarId.mockResolvedValue({ calendarId: 'cal-1', reason: 'first-active' });
    mockGetFreeSlots.mockResolvedValue([]);

    const result = await checkAvailability('tenant-1', {
      treatment_name: 'blanqueamiento',
      preferred_date: futureDate,
    });

    expect(result.result).toContain('No hay disponibilidad');
  });

  it('rechaza fechas del pasado con feedback al agente', async () => {
    mockGetGhlIntegration.mockResolvedValue(mockIntegration);
    mockResolveCalendarId.mockResolvedValue({ calendarId: 'cal-1', reason: 'first-active' });

    const result = await checkAvailability('tenant-1', {
      treatment_name: 'limpieza',
      preferred_date: '2020-01-01',
    });

    expect(result.result).toContain('ya pasó');
    expect(result.result).toContain('Recalculá');
  });

  it('avisa si la clínica no tiene calendarios configurados', async () => {
    mockGetGhlIntegration.mockResolvedValue(mockIntegration);
    mockResolveCalendarId.mockResolvedValue({ calendarId: null, reason: 'no-calendars' });

    const result = await checkAvailability('tenant-1', {
      treatment_name: 'limpieza',
      preferred_date: futureDate,
    });

    expect(result.result).toContain('no tiene calendarios');
  });
});

describe('getPatientInfo', () => {
  const mockIntegration = {
    tenantId: 'tenant-1',
    locationId: 'loc-123',
    companyId: null,
    accessTokenEnc: 'enc',
    refreshTokenEnc: 'enc',
    expiresAt: new Date(Date.now() + 3600_000),
    scopes: 'pit',
    connectedBy: null,
    connectedAt: new Date(),
  };

  it('devuelve datos del paciente si existe en GHL', async () => {
    mockGetGhlIntegration.mockResolvedValue(mockIntegration);

    // Nuevo endpoint: /contacts/search/duplicate → { contact: {...} | null }
    mockGhlFetch.mockResolvedValue({
      contact: { id: 'contact-abc', firstName: 'María', lastName: 'García', email: 'maria@test.com' },
    });

    const result = await getPatientInfo('tenant-1', { phone: '+525512345678' });
    expect(result.result).toContain('María García');
    expect(result.result).toContain('contact-abc');
  });

  it('indica paciente nuevo si no existe', async () => {
    mockGetGhlIntegration.mockResolvedValue(mockIntegration);
    mockGhlFetch.mockResolvedValue({ contact: null });

    const result = await getPatientInfo('tenant-1', { phone: '+525599999999' });
    expect(result.result).toContain('paciente nuevo');
  });
});
