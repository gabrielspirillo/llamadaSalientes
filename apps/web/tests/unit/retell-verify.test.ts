import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyRetellSignature } from '@/lib/retell/verify';

const SECRET = 'test-signing-key-fase-4';

function makeSignature(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyRetellSignature', () => {
  it('acepta firma válida', () => {
    const body = Buffer.from(JSON.stringify({ event: 'call_started' }));
    const sig = makeSignature(body, SECRET);
    expect(verifyRetellSignature(body, sig, SECRET)).toBe(true);
  });

  it('rechaza firma incorrecta', () => {
    const body = Buffer.from(JSON.stringify({ event: 'call_started' }));
    expect(verifyRetellSignature(body, 'bad-signature', SECRET)).toBe(false);
  });

  it('rechaza firma null', () => {
    const body = Buffer.from('{}');
    expect(verifyRetellSignature(body, null, SECRET)).toBe(false);
  });

  it('rechaza body adulterado (firma de body original no coincide)', () => {
    const body = Buffer.from(JSON.stringify({ event: 'call_started' }));
    const sig = makeSignature(body, SECRET);
    const tampered = Buffer.from(JSON.stringify({ event: 'call_ended' }));
    expect(verifyRetellSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rechaza firma con key equivocada', () => {
    const body = Buffer.from('{}');
    const sig = makeSignature(body, 'other-key');
    expect(verifyRetellSignature(body, sig, SECRET)).toBe(false);
  });
});
