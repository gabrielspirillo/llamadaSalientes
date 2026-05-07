import { z } from 'zod';

// Validación de variables de entorno. Crashea al boot si falta algo crítico.
// Las claves van pasando de `optional()` a `min(1)` a medida que avanzan
// las fases del roadmap.

// Vercel/CI a veces inyectan strings vacíos para vars no seteadas; los tratamos
// como undefined para que los `.default()` y `.optional()` se comporten bien.
const cleaned = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);

const envSchema = z.object({
  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // DB — required desde Fase 1
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerido (Supabase)'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL es requerido (Supabase direct)'),

  // Auth Clerk — required desde Fase 1
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY es requerido'),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY es requerido'),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default('/sign-in'),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default('/sign-up'),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1, 'CLERK_WEBHOOK_SIGNING_SECRET es requerido'),

  // Retell — Fase 4
  RETELL_API_KEY: z.string().optional(),
  RETELL_WEBHOOK_SIGNING_KEY: z.string().optional(),

  // GoHighLevel — Fase 3
  GHL_CLIENT_ID: z.string().optional(),
  GHL_CLIENT_SECRET: z.string().optional(),
  GHL_REDIRECT_URI: z.string().optional(),
  GHL_WEBHOOK_PUBLIC_KEY: z.string().optional(),

  // Twilio — Fase 4
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_API_KEY: z.string().optional(),
  TWILIO_API_SECRET: z.string().optional(),

  // Inngest — Fase 3
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  // R2 — Fase 5
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  // Crypto — Fase 3
  ENCRYPTION_KEY: z.string().optional(),

  // Observabilidad — opcional
  SENTRY_DSN: z.string().optional(),
  AXIOM_TOKEN: z.string().optional(),
  AXIOM_DATASET: z.string().optional(),

  // Stripe — Fase 8
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // OpenAI — Fase 5
  OPENAI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables. See errors above.');
  }
  return parsed.data;
}

export const env = loadEnv();
