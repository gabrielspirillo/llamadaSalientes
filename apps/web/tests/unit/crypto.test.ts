import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  // Genera una key válida para los tests (no toca .env.local)
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 'a').toString('base64');
  process.env.DATABASE_URL = 'postgres://test';
  process.env.DIRECT_URL = 'postgres://test';
  process.env.CLERK_SECRET_KEY = 'sk_test_x';
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_x';
});

describe('crypto AES-256-GCM', () => {
  it('round-trips a token', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const plain = 'ya29.A0AfH6S-FAKE-TOKEN-1234567890';
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(enc.length).toBeGreaterThan(plain.length);
    expect(decrypt(enc)).toBe(plain);
  });

  it('produces different ciphertext on each call (random IV)', async () => {
    const { encrypt } = await import('@/lib/crypto');
    const a = encrypt('hello');
    const b = encrypt('hello');
    expect(a).not.toBe(b);
  });

  it('rejects tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const enc = encrypt('secret');
    // flip a byte at the end
    const buf = Buffer.from(enc, 'base64');
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });
});
