import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumensoError, getDocument, resolveCreatedDocument } from '@/lib/consents/documenso';

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
      externalId: null,
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

describe('resolveCreatedDocument', () => {
  const created = { documentId: 41, envelopeId: 'envelope_abc' };
  const expected = { externalId: 'consent-adrian', recipientEmail: 'mama.adrian@test.com' };

  it('enlace del documento recién creado, comprobado por el sobre', async () => {
    respond({
      '/api/v2/envelope/envelope_abc': [
        200,
        {
          secondaryId: 'document_41',
          externalId: 'consent-adrian',
          recipients: [{ role: 'SIGNER', email: 'Mama.Adrian@test.com', token: 'tok-adrian' }],
        },
      ],
    });
    expect(await resolveCreatedDocument(cfg, created, expected)).toEqual({
      documentId: 41,
      signingUrl: 'https://doc.test/sign/tok-adrian',
    });
  });

  it('nunca devuelve el enlace de otro paciente (el bug de octubre)', async () => {
    // El id numérico resuelve al documento de OTRO niño: antes se mandaba ese enlace.
    respond({
      '/api/v2/document/41': [
        200,
        {
          id: 41,
          externalId: 'consent-oliver',
          recipients: [{ role: 'SIGNER', email: 'mama.oliver@test.com', token: 'tok-oliver' }],
        },
      ],
    });
    await expect(resolveCreatedDocument(cfg, created, expected)).rejects.toBeInstanceOf(
      DocumensoError,
    );
  });

  it('si el sobre no responde, vale el id numérico cuando es el nuestro', async () => {
    respond({
      '/api/v2/document/41': [
        200,
        {
          id: 41,
          externalId: 'consent-adrian',
          recipients: [{ role: 'SIGNER', email: 'mama.adrian@test.com', token: 'tok-adrian' }],
        },
      ],
    });
    expect((await resolveCreatedDocument(cfg, created, expected)).signingUrl).toBe(
      'https://doc.test/sign/tok-adrian',
    );
  });
});
