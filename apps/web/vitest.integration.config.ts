import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Pruebas de integración del módulo Tareas contra un Postgres REAL.
 *
 * No entran en `pnpm test` porque sin base no se pueden ni importar. Para
 * correrlas hace falta una instancia desechable y aplicarle las migraciones:
 *
 *   PGBIN=/usr/lib/postgresql/16/bin
 *   $PGBIN/initdb -D /tmp/pg-qa -A trust
 *   $PGBIN/pg_ctl -D /tmp/pg-qa -o '-p 5441' -l /tmp/pg-qa.log start
 *   createdb -h 127.0.0.1 -p 5441 -U postgres qa
 *   for f in ../../supabase/migrations/*.sql; do \
 *     psql -h 127.0.0.1 -p 5441 -U postgres -d qa -v ON_ERROR_STOP=1 -f "$f"; done
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5441/qa pnpm --filter web test:integration
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts'),
    },
  },
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    // Comparten base: en paralelo se pisan las siembras.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
