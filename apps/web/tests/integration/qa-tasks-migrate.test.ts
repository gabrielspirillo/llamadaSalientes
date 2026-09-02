import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

const MIG_DIR = process.env.MIGRATIONS_DIR as string;
const ADMIN_URL = 'postgres://postgres@127.0.0.1:5441/postgres';
const FILES = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const created: string[] = [];

async function freshDb(name: string): Promise<string> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  created.push(name);
  return `postgres://postgres@127.0.0.1:5441/${name}`;
}

/** Aplica migraciones "a mano", como estaba producción antes del runner. */
async function applyByHand(url: string, upTo: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false });
  for (const f of FILES) {
    if (f.slice(0, 4) > upTo) continue;
    await sql.unsafe(readFileSync(join(MIG_DIR, f), 'utf8')).simple();
  }
  await sql.end();
}

/** Reimporta el runner con DATABASE_URL apuntando a `url`. */
async function runOn(url: string) {
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  vi.resetModules();
  const mod = await import('@/lib/db/migrate');
  return mod.runPendingMigrations();
}

async function query<T>(url: string, q: string): Promise<T[]> {
  const sql = postgres(url, { max: 1, prepare: false });
  const rows = (await sql.unsafe(q)) as unknown as T[];
  await sql.end();
  return rows;
}

const ORIGINAL_URL = process.env.DATABASE_URL as string;

afterAll(async () => {
  process.env.DATABASE_URL = ORIGINAL_URL;
  process.env.DIRECT_URL = ORIGINAL_URL;
  const admin = postgres(ADMIN_URL, { max: 1 });
  for (const db of created) await admin.unsafe(`DROP DATABASE IF EXISTS ${db}`).catch(() => {});
  await admin.end();
});

describe('10. Runner de migraciones', () => {
  it('base con schema viejo (hasta 0017): marca baseline y aplica solo 0018', async () => {
    const url = await freshDb('qa_mig_old');
    await applyByHand(url, '0017');

    const r1 = await runOn(url);
    expect(r1.failed).toBeNull();
    expect(r1.applied).toEqual(['0018_tasks.sql']);
    expect(r1.skipped.length).toBe(FILES.length - 1);
    expect(r1.skipped).not.toContain('0018_tasks.sql');

    const tabla = await query<{ ok: boolean }>(
      url,
      "SELECT to_regclass('public.tasks') IS NOT NULL AS ok",
    );
    expect(tabla[0]!.ok).toBe(true);

    const marcas = await query<{ filename: string; baseline: boolean }>(
      url,
      'SELECT filename, baseline FROM schema_migrations ORDER BY filename',
    );
    expect(marcas.length).toBe(FILES.length);
    expect(marcas.filter((m) => m.baseline).length).toBe(FILES.length - 1);
    expect(marcas.find((m) => m.filename === '0018_tasks.sql')?.baseline).toBe(false);

    // Segunda corrida sobre base ya migrada: no hace nada.
    const r2 = await runOn(url);
    expect(r2).toEqual({ applied: [], skipped: [], failed: null });
  });

  it('0018 ya aplicada a mano: la registra y sigue sin fallar', async () => {
    const url = await freshDb('qa_mig_hand18');
    await applyByHand(url, '0018');

    const r = await runOn(url);
    expect(r.failed).toBeNull();
    expect(r.applied).toEqual([]);
    expect(r.skipped).toContain('0018_tasks.sql');
    expect(r.skipped.length).toBe(FILES.length);

    const [{ n }] = await query<{ n: string }>(
      url,
      'SELECT count(*)::int AS n FROM schema_migrations',
    );
    expect(Number(n)).toBe(FILES.length);
  });

  it('base vacía: aplica la cadena entera sin baseline', async () => {
    const url = await freshDb('qa_mig_empty');
    const r = await runOn(url);
    expect(r.failed).toBeNull();
    expect(r.applied).toEqual(FILES);
    expect(r.skipped).toEqual([]);
    const tabla = await query<{ ok: boolean }>(
      url,
      "SELECT to_regclass('public.task_automation_rules') IS NOT NULL AS ok",
    );
    expect(tabla[0]!.ok).toBe(true);
  });

  it('base parcial (solo 0000 a mano): el baseline la deja trabada para siempre', async () => {
    const url = await freshDb('qa_mig_partial');
    await applyByHand(url, '0000');
    const r = await runOn(url);
    // El baseline se dispara con la sola existencia de `tenants`: marca
    // 0000..0017 como aplicadas aunque 0001..0017 nunca corrieron.
    expect(r.skipped.length).toBe(FILES.length - 1);
    expect(r.applied).toEqual([]);
    expect(r.failed?.file).toBe('0018_tasks.sql');
    expect(r.failed?.error).toMatch(/whatsapp_conversations.*does not exist/);

    // Y queda envenenada: 0014 nunca correrá porque figura como aplicada.
    const tabla = await query<{ ok: boolean }>(
      url,
      "SELECT to_regclass('public.waitlist_entries') IS NOT NULL AS ok",
    );
    expect(tabla[0]!.ok).toBe(false);
    const r2 = await runOn(url);
    expect(r2.applied).toEqual([]);
    expect(r2.failed?.file).toBe('0018_tasks.sql');
  });
});
