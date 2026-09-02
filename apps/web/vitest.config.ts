import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts'),
    },
  },
  // Skip PostCSS — los tests son unit, no necesitan CSS de Tailwind.
  // Sin esto, vitest intenta cargar lightningcss native binary y rompe.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'happy-dom',
    globals: true,
    // `tests/integration/**` queda fuera del run por defecto: esas pruebas
    // necesitan un Postgres vivo y sin él ni siquiera se pueden importar.
    // Se corren aparte con `pnpm test:integration`.
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'tests/integration/**', 'node_modules/**', '.next/**'],
    // lib/env.ts valida el esquema al importar, y basta con que un test
    // arrastre lib/db/client.ts para que la suite ni siquiera colecte. Estos
    // son valores dummy con el shape correcto: no abren ninguna conexión.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      DIRECT_URL: 'postgres://test:test@localhost:5432/test',
      CLERK_SECRET_KEY: 'sk_test_dummy',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_dummy',
      CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_dummy',
      ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    },
  },
});
