import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const dispatchToolMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/retell/tools', () => ({
  dispatchTool: dispatchToolMock,
}));

import {
  TERMINAL_TOOL_NAMES,
  executeAgentTool,
  getAgentToolDefinitions,
} from '@/lib/whatsapp/agent/tools';

beforeEach(() => {
  dispatchToolMock.mockReset();
});

describe('getAgentToolDefinitions', () => {
  it('expone las 8 tools de Retell + handoff (terminal) + flag_urgent (marcador)', () => {
    const defs = getAgentToolDefinitions();
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        'book_appointment',
        'cancel_appointment',
        'check_availability',
        'flag_urgent',
        'get_patient_info',
        'get_treatment_details',
        'list_treatments',
        'register_patient',
        'request_handoff',
        'search_faqs',
      ].sort(),
    );
  });

  it('cada tool tiene JSON Schema válido con type=object y additionalProperties=false', () => {
    for (const def of getAgentToolDefinitions()) {
      expect(def.parameters.type).toBe('object');
      expect(def.parameters.additionalProperties).toBe(false);
      expect(Array.isArray(def.parameters.required)).toBe(true);
    }
  });

  it('solo request_handoff es terminal; flag_urgent es marcador no terminal', () => {
    expect(TERMINAL_TOOL_NAMES.has('request_handoff')).toBe(true);
    // flag_urgent marca urgencia pero deja seguir al agente para que agende.
    expect(TERMINAL_TOOL_NAMES.has('flag_urgent')).toBe(false);
    expect(TERMINAL_TOOL_NAMES.has('check_availability')).toBe(false);
  });
});

describe('executeAgentTool', () => {
  it('rechaza una herramienta desconocida sin dispatch', async () => {
    const trace = await executeAgentTool({
      tenantId: 'tenant-1',
      toolName: 'doSomethingWeird',
      rawArgs: { foo: 'bar' },
    });
    expect(trace.ok).toBe(false);
    expect(trace.error).toBe('unknown_tool');
    expect(dispatchToolMock).not.toHaveBeenCalled();
  });

  it('valida args con Zod y devuelve invalid_args sin dispatch', async () => {
    const trace = await executeAgentTool({
      tenantId: 'tenant-1',
      toolName: 'book_appointment',
      // start_time y treatment_name son required
      rawArgs: { phone: '+34699111222' },
    });
    expect(trace.ok).toBe(false);
    expect(trace.error).toBe('invalid_args');
    expect(trace.result).toContain('Argumentos inválidos');
    expect(dispatchToolMock).not.toHaveBeenCalled();
  });

  it('request_handoff es terminal: NO toca dispatchTool', async () => {
    const trace = await executeAgentTool({
      tenantId: 'tenant-1',
      toolName: 'request_handoff',
      rawArgs: { reason: 'paciente pide hablar con doctor concreto' },
    });
    expect(trace.ok).toBe(true);
    expect(trace.name).toBe('request_handoff');
    expect(trace.result).toContain('HANDOFF');
    expect(dispatchToolMock).not.toHaveBeenCalled();
  });

  it('flag_urgent es marcador: NO toca dispatchTool y pide agendar la cita', async () => {
    const trace = await executeAgentTool({
      tenantId: 'tenant-1',
      toolName: 'flag_urgent',
      rawArgs: { reason: 'sangrado intenso tras extracción' },
    });
    expect(trace.ok).toBe(true);
    expect(trace.result).toContain('URGENT');
    // La observación empuja al LLM a seguir el flujo de urgencia (preguntar y
    // reservar), no a cortar la conversación.
    expect(trace.result).toContain('reserva');
    expect(dispatchToolMock).not.toHaveBeenCalled();
  });

  it('dispatch normal: pasa args validados a Retell tools y devuelve el result', async () => {
    dispatchToolMock.mockResolvedValue({
      result: 'Horarios disponibles: lunes 10:00, martes 11:00',
    });
    const trace = await executeAgentTool({
      tenantId: 'tenant-abc',
      toolName: 'check_availability',
      rawArgs: { treatment_name: 'Limpieza', preferred_date: '2026-05-22' },
    });
    expect(trace.ok).toBe(true);
    expect(trace.result).toContain('Horarios disponibles');
    expect(dispatchToolMock).toHaveBeenCalledWith(
      'tenant-abc',
      'check_availability',
      expect.objectContaining({ treatment_name: 'Limpieza', preferred_date: '2026-05-22' }),
    );
  });

  it('captura errores del dispatch sin lanzar; devuelve ok=false con mensaje', async () => {
    dispatchToolMock.mockRejectedValue(new Error('GHL 502'));
    const trace = await executeAgentTool({
      tenantId: 'tenant-abc',
      toolName: 'get_patient_info',
      rawArgs: { phone: '+34699111222' },
    });
    expect(trace.ok).toBe(false);
    expect(trace.error).toBe('GHL 502');
    expect(trace.result).toContain('Error ejecutando get_patient_info');
  });
});
