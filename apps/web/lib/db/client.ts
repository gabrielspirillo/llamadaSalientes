import { env } from '@/lib/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Cliente Drizzle. Se crea lazy: importar este módulo no debe abrir conexiones
// (varios tests y el build lo importan sin base disponible).

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Tamaño del pool. El default de postgres.js es 10, y el worker levanta 11
 * colas con concurrencia 2: se quedaba esperando conexión sin loguear nada, y
 * la saturación se veía desde afuera como "los jobs se cuelgan".
 */
function poolSize(): number {
  const raw = process.env.DB_POOL_MAX;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function getClient() {
  if (_client) return _client;
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está configurado. Cargá tu .env.local.');
  }
  _client = postgres(env.DATABASE_URL, {
    // prepare: false es necesario si algún día se mete PgBouncer en modo
    // transaction. Hoy se habla directo con Postgres, pero se mantiene para no
    // cambiar el comportamiento del pool en producción con este cambio.
    prepare: false,
    max: poolSize(),
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return _client;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    // Memoizado: antes se construía una instancia nueva de Drizzle en CADA
    // acceso a propiedad (db.select, db.insert...), o sea una por query.
    if (!_db) _db = drizzle(getClient(), { schema });
    return Reflect.get(_db, prop, _db);
  },
});

/** Cierra el pool. Sólo para el shutdown ordenado del worker. */
export async function closeDb(): Promise<void> {
  if (!_client) return;
  const client = _client;
  _client = null;
  _db = null;
  await client.end({ timeout: 5 });
}
