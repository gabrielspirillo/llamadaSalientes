import { z } from 'zod';

// Validación de variables de entorno. Crashea al boot si falta algo crítico.
// Las claves van pasando de `optional()` a `min(1)` a medida que avanzan
// las fases del roadmap.

// Vercel/CI a veces inyectan strings vacíos para vars no seteadas; los tratamos
// como undefined para que los `.default()` y `.optional()` se comporten bien.
const cleaned = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);

// URL coercer: acepta strings, prepende https:// si falta protocolo,
// vuelve al default si está vacío o es inválido.
const appUrlSchema = z
  .string()
  .transform((s) => {
    const trimmed = s.trim();
    if (!trimmed) return 'http://localhost:3000';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  })
  .default('http://localhost:3000');

const envSchema = z.object({
  // App
  NEXT_PUBLIC_APP_URL: appUrlSchema,
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

  // R2 — Fase 5 (recordings de Retell)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  // Supabase Storage — adjuntos del inbox de WhatsApp.
  // SUPABASE_URL = https://<project-ref>.supabase.co
  // SUPABASE_SERVICE_ROLE_KEY = clave service_role (NUNCA exponer al cliente).
  // Bucket público: whatsapp-media
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_WHATSAPP_BUCKET: z.string().default('whatsapp-media'),

  // Crypto — required desde Fase 3 (AES-256-GCM, 32 bytes base64)
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY es requerida (openssl rand -base64 32)'),

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

  // WhatsApp — opcional (se configura por-tenant en /dashboard/whatsapp/integrations)
  // WHATSAPP_VERIFY_TOKEN es el único requerido para el webhook handshake de Meta Cloud.
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().default('v21.0'),
  EVOLUTION_API_URL: z.string().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  // Feature flag global del agente IA de WhatsApp. Por seguridad arranca
  // apagado: los webhooks emiten el evento Inngest pero la función sale
  // inmediatamente sin invocar al LLM. Para encender en producción setear
  // WHATSAPP_AGENT_ENABLED=true y validar tenant por tenant.
  WHATSAPP_AGENT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // Demo público de la landing (Hostinger / cliniq.futuradigital.es)
  // Tenant que recibe las llamadas demo iniciadas desde el botón "Recibir llamada".
  FUTURA_DEMO_TENANT_ID: z.string().uuid().optional(),
  // Origen permitido para CORS del endpoint /api/public/demo-call.
  // Acepta lista separada por comas. Ej: "https://cliniq.futuradigital.es,https://www.cliniq.futuradigital.es"
  FUTURA_DEMO_ALLOWED_ORIGINS: z.string().optional(),
  // Retell agent_id que atiende las llamadas demo (Manuel — FUTURA Demo Outbound).
  // Se pasa como override en /api/public/demo-call para no interferir con el
  // agente outbound configurado por tenant en agent_configs (que es lo que
  // muestra /dashboard/outbound).
  FUTURA_DEMO_RETELL_AGENT_ID: z.string().optional(),
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
