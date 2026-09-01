import { env } from '@/lib/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { restoreDateSerializers } from './date-serializers';
import * as schema from './schema';

// Cliente Drizzle. En Fase 0 puede crearse sin DATABASE_URL (lazy).
// A partir de Fase 1 será requerido.

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient() {
  if (_client) return _client;
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está configurado. Cargá tu .env.local.');
  }
  _client = postgres(env.DATABASE_URL, { prepare: false });
  return _client;
}

function getDb() {
  if (_db) return _db;

  const client = getClient();
  _db = drizzle(client, { schema });
  restoreDateSerializers(client);

  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    const instance = getDb();
    return Reflect.get(instance, prop, instance);
  },
});
