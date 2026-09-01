import 'server-only';
import { readFileSync, readdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { env } from '@/lib/env';
import postgres from 'postgres';

/**
 * Runner de migraciones SQL.
 *
 * Por qué existe: aplicar cada `.sql` a mano por SSH contra el Postgres de
 * Dokploy es frágil y bloquea el deploy en una persona con acceso al server.
 * Con esto, el worker aplica lo que falte al arrancar y queda registrado.
 *
 * Reglas de diseño:
 *   - Una tabla `schema_migrations` guarda qué archivos ya corrieron.
 *   - Cada migración corre dentro de su propia transacción: o entra entera o
 *     no entra nada.
 *   - Si falla, se loguea y se corta la cadena, pero NO se tira el proceso:
 *     un error de migración no puede dejar la clínica sin worker.
 *   - Baseline: las migraciones hasta BASELINE_THROUGH ya estaban aplicadas a
 *     mano en producción antes de que existiera este runner, así que en la
 *     primera corrida se marcan como aplicadas sin ejecutarlas.
 */

const BASELINE_THROUGH = '0017';

// Identificador arbitrario y estable del advisory lock del runner.
const MIGRATION_LOCK_ID = 4823917;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  failed: { file: string; error: string } | null;
}

/** Ubica `supabase/migrations` sin depender del cwd del proceso. */
export function findMigrationsDir(): string | null {
  const fromEnv = process.env.MIGRATIONS_DIR?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  // worker: cwd = /app/apps/web  ·  dev: cwd = apps/web  ·  raíz del repo
  const candidates = [
    resolve(process.cwd(), '../../supabase/migrations'),
    resolve(process.cwd(), '../supabase/migrations'),
    resolve(process.cwd(), 'supabase/migrations'),
    '/app/supabase/migrations',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function runPendingMigrations(): Promise<MigrationResult> {
  const result: MigrationResult = { applied: [], skipped: [], failed: null };

  if (!env.DATABASE_URL) {
    console.warn('[migrate] sin DATABASE_URL, no hago nada');
    return result;
  }

  const dir = findMigrationsDir();
  if (!dir) {
    console.warn('[migrate] no encontré supabase/migrations, no hago nada');
    return result;
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) return result;

  // Conexión propia y efímera: no reusamos el pool de la app para que un
  // `LOCK` largo de DDL no le coma conexiones al resto.
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    // Un solo runner a la vez: con más de una réplica de worker, dos procesos
    // corrían el mismo DDL en paralelo. Y sin lock_timeout, un DDL esperando
    // el lock del worker viejo dejaba al nuevo sin consumir un solo job,
    // indefinidamente y sin un error en los logs.
    await sql.unsafe("SET lock_timeout = '15s'");
    const [lock] = (await sql.unsafe(
      `SELECT pg_try_advisory_lock(${MIGRATION_LOCK_ID}) AS acquired`,
    )) as unknown as { acquired: boolean }[];
    if (!lock?.acquired) {
      console.warn('[migrate] otro proceso está migrando, no hago nada');
      return result;
    }

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        baseline boolean NOT NULL DEFAULT false
      )
    `);

    const rows = (await sql.unsafe('SELECT filename FROM schema_migrations')) as unknown as {
      filename: string;
    }[];
    const done = new Set(rows.map((r) => r.filename));

    // Primera corrida sobre una base que ya tenía el schema viejo aplicado a
    // mano: marcamos el baseline en vez de re-ejecutar (0000 volvería a
    // fallar con "already exists").
    if (done.size === 0) {
      const probe = (await sql.unsafe(
        "SELECT to_regclass('public.tenants') IS NOT NULL AS ok",
      )) as unknown as { ok: boolean }[];
      if (probe[0]?.ok) {
        const baseline = files.filter((f) => f.slice(0, 4) <= BASELINE_THROUGH);
        for (const f of baseline) {
          await sql.unsafe(
            'INSERT INTO schema_migrations (filename, baseline) VALUES ($1, true) ON CONFLICT DO NOTHING',
            [f],
          );
          done.add(f);
          result.skipped.push(f);
        }
        console.log(`[migrate] baseline marcado: ${baseline.length} migraciones previas`);
      }
    }

    for (const file of files) {
      if (done.has(file)) continue;

      const body = readFileSync(join(dir, file), 'utf8');
      try {
        await sql.begin(async (tx) => {
          // `.simple()` = protocolo simple, único que admite varias sentencias
          // en un mismo string (una migración son decenas de statements).
          await tx.unsafe(body).simple();
          await tx.unsafe('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        });
        result.applied.push(file);
        console.log(`[migrate] aplicada ${file}`);
      } catch (err) {
        const message = (err as Error).message;

        // "already exists" = alguien la aplicó a mano antes de que existiera
        // este runner. La registramos y seguimos: reintentarla en cada boot
        // dejaría la cadena trabada para siempre.
        //
        // Sólo vale para el baseline. Fuera de él era una trampa: cada archivo
        // corre en una transacción, así que si el statement 12 de 40 choca con
        // un objeto preexistente, los 11 anteriores hacen rollback y el archivo
        // igual quedaba registrado como aplicado. Resultado: esquema a medias,
        // marcado como completo y sin forma de reintentarlo.
        const isBaseline = file.slice(0, 4) <= BASELINE_THROUGH;
        if (isBaseline && /already exists/i.test(message)) {
          await sql
            .unsafe('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [
              file,
            ])
            .catch(() => undefined);
          result.skipped.push(file);
          console.warn(`[migrate] ${file} ya estaba aplicada a mano, la registro y sigo`);
          continue;
        }

        result.failed = { file, error: message };
        console.error(`[migrate] FALLÓ ${file}: ${message}`);
        // Cortamos: las migraciones siguientes asumen que esta corrió.
        break;
      }
    }

    if (result.applied.length === 0 && !result.failed) {
      console.log('[migrate] sin migraciones pendientes');
    }
  } catch (err) {
    result.failed = { file: '(setup)', error: (err as Error).message };
    console.error('[migrate] error preparando el runner', err);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  return result;
}
