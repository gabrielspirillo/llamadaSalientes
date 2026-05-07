import path from 'node:path';
import { config } from 'dotenv';
import type { Config } from 'drizzle-kit';

// .env.local vive en apps/web/ (Next.js lo carga automáticamente en runtime).
config({ path: path.resolve(__dirname, '.env.local') });

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
