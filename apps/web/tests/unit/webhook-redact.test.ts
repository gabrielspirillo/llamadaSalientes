import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { redactWebhookPayload } from '@/lib/webhooks/redact';

describe('redacción de payloads de webhook', () => {
  it('borra la transcripción y la grabación, que son datos de salud', () => {
    const out = redactWebhookPayload({
      event: 'call_analyzed',
      call: {
        call_id: 'abc',
        transcript: 'Paciente: me duele la muela desde el martes',
        recording_url: 'https://retell/rec.wav',
        duration_ms: 42000,
      },
    }) as { call: Record<string, unknown> };

    expect(out.call.transcript).toBe('[redactado 43 chars]');
    expect(out.call.recording_url).toBe('[redactado 22 chars]');
    // Lo que sirve para auditar se conserva.
    expect(out.call.call_id).toBe('abc');
    expect(out.call.duration_ms).toBe(42000);
  });

  it('atraviesa arrays y no rompe con null ni con primitivos', () => {
    const out = redactWebhookPayload({
      items: [{ transcript: 'hola' }, { ok: true }],
      nulo: null,
      n: 3,
    }) as { items: Record<string, unknown>[]; nulo: null; n: number };

    expect(out.items[0]?.transcript).toBe('[redactado 4 chars]');
    expect(out.items[1]?.ok).toBe(true);
    expect(out.nulo).toBeNull();
    expect(out.n).toBe(3);
  });

  it('corta la recursión en payloads profundos sin lanzar', () => {
    let deep: Record<string, unknown> = { transcript: 'x' };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(() => redactWebhookPayload(deep)).not.toThrow();
  });
});
