import { describeRetellError } from '@/lib/retell/errors';
import Retell from 'retell-sdk';
import { describe, expect, it } from 'vitest';

/** Construye el error tal y como lo lanza el SDK ante una respuesta HTTP. */
function apiError(status: number, body: unknown) {
  return Retell.APIError.generate(status, body as object, undefined, new Headers());
}

describe('describeRetellError', () => {
  it('cuenta sin crédito: lo dice con esas palabras y no como un 500', () => {
    const r = describeRetellError(
      apiError(402, { status: 'error', message: 'Trial over quota, please add payment.' }),
    );
    expect(r.status).toBe(402);
    expect(r.message).toContain('sin crédito');
    expect(r.message).toContain('método de pago');
  });

  it('credenciales rechazadas', () => {
    for (const status of [401, 403]) {
      const r = describeRetellError(apiError(status, { message: 'nope' }));
      expect(r.status).toBe(502);
      expect(r.message).toContain('credenciales');
    }
  });

  it('agente inexistente apunta a la pantalla que hay que revisar', () => {
    const r = describeRetellError(apiError(404, { message: 'agent not found' }));
    expect(r.message).toContain('Agent ID');
  });

  it('límite de peticiones pide reintentar', () => {
    const r = describeRetellError(apiError(429, { message: 'slow down' }));
    expect(r.status).toBe(429);
    expect(r.message).toContain('vuelve a probar');
  });

  it('un error desconocido conserva el detalle de Retell', () => {
    const r = describeRetellError(apiError(500, { message: 'boom interno' }));
    expect(r.status).toBe(502);
    expect(r.message).toContain('boom interno');
  });

  it('un fallo que no viene de Retell no se disfraza', () => {
    const r = describeRetellError(new Error('la base de datos no responde'));
    expect(r.status).toBe(500);
    expect(r.message).toBe('la base de datos no responde');
  });
});
