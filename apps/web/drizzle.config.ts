import path from 'node:path';
import { config } from 'dotenv';
import type { Config } from 'drizzle-kit';

// Carga .env.local desde el root del repo (no desde apps/web)
config({ path: path.resolve(__dirname, '../../.env.local') });

export default {
  schema: './lib/db/schema.ts',
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
} satisfies Config;
