import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumensoError, getDocument } from '@/lib/consents/documenso';

const cfg = { baseUrl: 'https://doc.test', apiToken: 'tok' };

function respond(routes: Record<string, [number, unknown]>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    const [status, body] = routes[path] ?? [404, { message: 'not found' }];
    return new Response(JSON.stringify(body), { status });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('getDocument', () => {
  it('lee el estado de la v2', async () => {
    respond({
      '/api/v2/document/7': [
        200,
        { id: 7, status: 'COMPLETED', completedAt: '2026-10-07T17:35:00Z' },
      ],
    });
    expect(await getDocument(cfg, 7)).toEqual({
      id: 7,
      status: 'COMPLETED',
      completedAt: '2026-10-07T17:35:00Z',
    });
  });

  it('cae a la v1 si la v2 devuelve null o 404', async () => {
    respond({
      '/api/v2/document/7': [200, null],
      '/api/v1/documents/7': [200, { id: 7, status: 'COMPLETED', completedAt: null }],
    });
    expect((await getDocument(cfg, 7)).status).toBe('COMPLETED');

    respond({ '/api/v1/documents/7': [200, { id: 7, status: 'PENDING' }] });
    expect((await getDocument(cfg, 7)).status).toBe('PENDING');
  });

  it('sin documento en ninguna versión da un error legible', async () => {
    respond({ '/api/v1/documents/7': [200, null] });
    await expect(getDocument(cfg, 7)).rejects.toBeInstanceOf(DocumensoError);
  });
});
