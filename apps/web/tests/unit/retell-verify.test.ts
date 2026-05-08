import { describe, expect, it } from 'vitest';
import { sign as retellSign } from 'retell-sdk';
import { verifyRetellSignature } from '@/lib/retell/verify';

const API_KEY = 'key_test_fase_4_signing';

describe('verifyRetellSignature', () => {
  it('acepta firma válida generada por el SDK', async () => {
    const body = JSON.stringify({ event: 'call_started', call: { call_id: 'c1' } });
    const sig = await retellSign(body, API_KEY);
    expect(await verifyRetellSignature(Buffer.from(body), sig, API_KEY)).toBe(true);
  });

  it('rechaza firma inválida', async () => {
    const body = Buffer.from('{"x":1}');
    expect(await verifyRetellSignature(body, 'v=123,d=deadbeef', API_KEY)).toBe(false);
  });

  it('rechaza firma null', async () => {
    expect(await verifyRetellSignature(Buffer.from('{}'), null, API_KEY)).toBe(false);
  });

  it('rechaza body adulterado (firma original ya no coincide)', async () => {
    const body = JSON.stringify({ event: 'call_started' });
    const sig = await retellSign(body, API_KEY);
    const tampered = Buffer.from(JSON.stringify({ event: 'call_ended' }));
    expect(await verifyRetellSignature(tampered, sig, API_KEY)).toBe(false);
  });

  it('rechaza firma con API key incorrecta', async () => {
    const body = JSON.stringify({ event: 'call_started' });
    const sig = await retellSign(body, 'other_key');
    expect(await verifyRetellSignature(Buffer.from(body), sig, API_KEY)).toBe(false);
  });

  it('rechaza si apiKey vacío', async () => {
    const body = JSON.stringify({ event: 'call_started' });
    const sig = await retellSign(body, API_KEY);
    expect(await verifyRetellSignature(Buffer.from(body), sig, '')).toBe(false);
  });
});
