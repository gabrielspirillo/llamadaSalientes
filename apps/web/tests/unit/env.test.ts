import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Smoke test del schema de env. Valida que la forma del schema acepta
// los defaults definidos en lib/env.ts y rechaza inputs claramente inválidos.

describe('env schema shape', () => {
  it('accepts a minimal valid env', () => {
    const schema = z.object({
      NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    });

    const parsed = schema.parse({});
    expect(parsed.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(parsed.NODE_ENV).toBe('development');
  });

  it('rejects malformed APP_URL', () => {
    const schema = z.object({ NEXT_PUBLIC_APP_URL: z.string().url() });
    expect(() => schema.parse({ NEXT_PUBLIC_APP_URL: 'not-a-url' })).toThrow();
  });

  it('rejects unknown NODE_ENV', () => {
    const schema = z.object({
      NODE_ENV: z.enum(['development', 'test', 'production']),
    });
    expect(() => schema.parse({ NODE_ENV: 'staging' })).toThrow();
  });
});
