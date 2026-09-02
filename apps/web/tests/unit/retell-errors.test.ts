import { describeRetellError } from '@/lib/retell/errors';
import Retell from 'retell-sdk';
import { describe, expect, it } from 'vitest';

/** Construye el error tal y como lo lanza el SDK ante una respuesta HTTP. */
function apiError(status: number, body: unknown) {
  return Retell.APIError.generate(status, body as object, undefined, new Headers());
}

const NEUTRO = 'ajustes en el sistema';

describe('describeRetellError', () => {
  it('cuenta sin crédito: al usuario mensaje neutro, motivo real en el detalle', () => {
    const r = describeRetellError(
      apiError(402, { status: 'error', message: 'Trial over quota, please add payment.' }),
    );
    expect(r.status).toBe(402); // el status HTTP sí refleja la causa
    expect(r.message).toContain(NEUTRO);
    expect(r.message).not.toMatch(/retell|crédito|pago/i);
    expect(r.detail).toContain('Trial over quota');
  });

  it('credenciales rechazadas: neutro fuera, causa dentro', () => {
    for (const status of [401, 403]) {
      const r = describeRetellError(apiError(status, { message: 'bad key' }));
      expect(r.status).toBe(502);
      expect(r.message).toContain(NEUTRO);
      expect(r.detail).toContain(String(status));
    }
  });

  it('agente inexistente: no se nombra en pantalla', () => {
    const r = describeRetellError(apiError(404, { message: 'agent not found' }));
    expect(r.message).toContain(NEUTRO);
    expect(r.detail).toContain('agent not found');
  });

  it('límite de peticiones conserva su status', () => {
    const r = describeRetellError(apiError(429, { message: 'slow down' }));
    expect(r.status).toBe(429);
    expect(r.message).toContain(NEUTRO);
  });

  it('un fallo que no viene de Retell tampoco se enseña crudo', () => {
    const r = describeRetellError(new Error('la base de datos no responde'));
    expect(r.status).toBe(500);
    expect(r.message).toContain(NEUTRO);
    expect(r.detail).toBe('la base de datos no responde');
  });
});
