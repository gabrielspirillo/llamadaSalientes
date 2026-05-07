import { env } from '@/lib/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Cliente Drizzle. En Fase 0 puede crearse sin DATABASE_URL (lazy).
// A partir de Fase 1 será requerido.

let _client: ReturnType<typeof postgres> | null = null;

function getClient() {
  if (_client) return _client;
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está configurado. Cargá tu .env.local.');
  }
  _client = postgres(env.DATABASE_URL, { prepare: false });
  return _client;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const instance = drizzle(getClient(), { schema });
    return Reflect.get(instance, prop, instance);
  },
});
