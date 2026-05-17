# DentalVoice

SaaS multi-tenant que provee a clínicas estéticas odontológicas un agente de voz con IA para llamadas entrantes. Atiende, identifica al paciente, agenda/cancela/reagenda citas, responde FAQs y transfiere a humano cuando hace falta. Sincroniza con GoHighLevel.

## Stack

- Node.js 20 + TypeScript 5.7 (estricto, `noUncheckedIndexedAccess`)
- Next.js 15 (App Router)
- Tailwind v4 + shadcn/ui (a partir de Fase 1)
- Postgres (Supabase) + Drizzle ORM
- Clerk (Auth + Organizations)
- Inngest (cola serverless)
- Cloudflare R2 (storage)
- Sentry + Axiom (observabilidad)
- Biome (lint + format)
- Vitest + Playwright (tests)

## Arrancar local

### Requisitos
- Node 20+
- pnpm 9+ (`curl -fsSL https://get.pnpm.io/install.sh | sh -`)

### Setup
```bash
# 1. Clonar
git clone https://github.com/gabrielspirillo/llamadaSalientes.git dental-voice
cd dental-voice

# 2. Instalar deps
pnpm install

# 3. Copiar env vars
cp .env.example .env.local
# Llenar las claves (ver "Cuentas externas" abajo)

# 4. Dev server
pnpm dev
# http://localhost:3000

# 5. Verificación
curl http://localhost:3000/api/health
# {"ok":true,"service":"dental-voice","timestamp":"..."}
```

### Comandos
| Comando | Descripción |
|---|---|
| `pnpm dev` | Dev server Next.js en :3000 |
| `pnpm build` | Build de producción |
| `pnpm typecheck` | TypeScript strict check |
| `pnpm test` | Vitest (unit + integration) |
| `pnpm test:e2e` | Playwright (e2e) |
| `pnpm check` | Biome lint + format check |
| `pnpm format` | Biome auto-fix format |
| `pnpm db:generate` | Drizzle: generar migración desde schema |
| `pnpm db:push` | Drizzle: push schema (dev only) |
| `pnpm db:studio` | Drizzle Studio (UI DB) |

## Cuentas externas necesarias

Las creamos cuando se necesiten (no en Fase 0):

| Servicio | Para qué | Cuándo |
|---|---|---|
| [Supabase](https://supabase.com) | Postgres + auth backup | Fase 1 |
| [Clerk](https://clerk.com) | Auth + Organizations | Fase 1 |
| [Sentry](https://sentry.io) | Error tracking | Fase 1 (opcional) |
| [Axiom](https://axiom.co) | Logs estructurados | Fase 1 (opcional) |
| [GoHighLevel Marketplace](https://marketplace.gohighlevel.com) | OAuth app | Fase 3 |
| [Retell AI](https://retellai.com) | Motor de voz | Fase 4 |
| [Twilio](https://twilio.com) | Telefonía | Fase 4 |
| [Cloudflare R2](https://developers.cloudflare.com/r2) | Storage grabaciones | Fase 5 |
| [OpenAI](https://platform.openai.com) | Resúmenes | Fase 5 |
| [Stripe](https://stripe.com) | Billing | Fase 8 |

## Deploy a Vercel

1. Empujar el código a GitHub (ya configurado: `https://github.com/gabrielspirillo/llamadaSalientes`).
2. Ir a [vercel.com/new](https://vercel.com/new) e importar el repo.
3. **Root Directory**: `apps/web` (importante).
4. **Framework Preset**: Next.js (autodetectado).
5. **Build Command**: `cd ../.. && pnpm install && pnpm --filter web build` (Vercel autodetecta pnpm).
6. **Environment Variables**: copiar todas las claves de `.env.local`.
7. Deploy.

## Estructura

```
dental-voice/
├── apps/web/                  # Next.js app
│   ├── app/                   # App Router (marketing, auth, dashboard, api)
│   ├── components/            # UI components
│   ├── lib/                   # env, db, retell, ghl, etc.
│   ├── inngest/               # Background jobs
│   └── tests/                 # unit, integration, e2e
├── packages/
│   ├── db-schema/             # Drizzle schema compartible
│   └── shared-types/          # Tipos comunes (Intent, Role)
├── supabase/migrations/       # SQL versionado con RLS
├── scripts/                   # seed, rotate-keys, etc.
└── .github/workflows/         # CI
```

## Telefonía multi-tenant (Caller ID + número entrante)

Cada clínica conserva su número público y recibe llamadas como antes; Twilio sólo es el medio.

**Salientes** (clínica como Caller ID):
1. Settings → Telefonía → cargar Account SID + Auth Token del subaccount Twilio del tenant.
2. "Caller ID saliente" → ingresar el número público de la clínica → Twilio llama y dicta un código de 6 dígitos → la persona en la clínica lo tipea por DTMF → queda verificado.
3. Las salientes (`triggerCallback`, batch campaigns) pasan `override_from_number` con ese número a Retell. **Requisito**: el subaccount Twilio del tenant tiene que estar registrado en Retell como BYOT (importing phone numbers from Twilio).

**Entrantes** (desvío al número Twilio):
1. Settings → Telefonía → "Número entrante" → elegir un IncomingPhoneNumber del subaccount.
2. Decidir routing: `agent` (Retell vía SIP) o `forward` (a un humano).
3. Configurar webhooks lo hace la app sola: setea `VoiceUrl = /api/twilio/inbound-voice` y `SmsUrl = /api/twilio/sms-passthrough`.
4. La clínica activa "desvío de llamadas" en su operador apuntando al Twilio number elegido. Las entrantes llegan a `/api/twilio/inbound-voice`, se resuelve el tenant por `To`, y devolvemos TwiML que conecta al agente Retell vía SIP (o un `<Dial>` directo al humano).

Long-term alternativa: portar el número de la clínica directamente a Twilio en lugar de usar desvío.

Tablas/archivos clave:
- `supabase/migrations/0006_tenant_telephony.sql` — esquema
- `apps/web/lib/twilio/client.ts` — wrapper REST (Verified Caller IDs + IncomingPhoneNumbers)
- `apps/web/app/api/telephony/*` — endpoints autenticados (Clerk org)
- `apps/web/app/api/twilio/inbound-voice/route.ts` — webhook público (multi-tenant)
- `apps/web/app/(dashboard)/dashboard/settings/telephony/page.tsx` — UI

## Roadmap

Ver `PRD.md` y `CLAUDE_CODE_PROMPT.md` (ambos fuera de este repo). Resumen:

- **Fase 0** (actual): Setup, scaffolding, CI verde.
- **Fase 1**: Schema completo, Clerk Orgs, multi-tenancy básico.
- **Fase 2**: CRUD settings/treatments/FAQs.
- **Fase 3**: OAuth GHL + crypto + token refresh.
- **Fase 4**: Retell + Twilio + tools del agente.
- **Fase 5**: Procesamiento async + R2 + resúmenes IA.
- **Fase 6**: Dashboard llamadas + analytics.
- **Fase 7**: RLS endurecido + tests de aislamiento.
- **Fase 8**: Stripe billing + roles + audit.
- **Fase 9**: Pulido pre-launch.

## Licencia

Privado.
