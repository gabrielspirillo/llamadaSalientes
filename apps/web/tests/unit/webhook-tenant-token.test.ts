import { beforeAll, describe, expect, it } from 'vitest';

vi.mock('server-only', () => ({}));

import { verifyWebhookToken, webhookToken } from '@/lib/webhooks/tenant-token';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('token de webhook por tenant', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('es estable para el mismo tenant y scope', () => {
    expect(webhookToken('ghl', TENANT_A)).toBe(webhookToken('ghl', TENANT_A));
  });

  it('separa por scope: el token de Evolution no sirve para GHL', () => {
    const evolution = webhookToken('evolution', TENANT_A);
    expect(webhookToken('ghl', TENANT_A)).not.toBe(evolution);
    expect(verifyWebhookToken('ghl', TENANT_A, evolution)).toBe(false);
  });

  it('el token de un tenant no vale para otro', () => {
    expect(verifyWebhookToken('ghl', TENANT_B, webhookToken('ghl', TENANT_A))).toBe(false);
  });

  it('rechaza token ausente o vacío', () => {
    expect(verifyWebhookToken('ghl', TENANT_A, null)).toBe(false);
    expect(verifyWebhookToken('ghl', TENANT_A, undefined)).toBe(false);
    expect(verifyWebhookToken('ghl', TENANT_A, '')).toBe(false);
  });

  it('acepta el token correcto', () => {
    expect(verifyWebhookToken('ghl', TENANT_A, webhookToken('ghl', TENANT_A))).toBe(true);
  });
});
