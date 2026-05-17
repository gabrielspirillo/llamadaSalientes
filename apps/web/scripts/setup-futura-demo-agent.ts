/**
 * Wire del agente Retell "FUTURA — Demo Outbound (Sofía)" al tenant demo.
 *
 * No CREA el agente en Retell (ya está creado: agent_b7c4de5748c40e118d193db2f6,
 * LLM llm_b7548a5a95b73561e5c65e550264). Sólo upsert-ea agent_configs(role='outbound')
 * para el tenant pasado por argumento, y verifica que el tenant tenga lo mínimo
 * para que el flow funcione (phone_numbers activo, ghl_integrations conectado).
 *
 * Uso:
 *   pnpm tsx apps/web/scripts/setup-futura-demo-agent.ts <tenantId>
 *
 * Requisitos previos:
 *   - Tenant creado en la DB (existe una org Clerk → fila en `tenants`).
 *   - Hay una fila en `phone_numbers` para ese tenant con un número Twilio activo.
 *   - GHL conectado vía /api/ghl/oauth (fila en `ghl_integrations`).
 *   - El calendario "Demo Futura" creado en GHL (lo resuelve por fuzzy match).
 */
import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../.env.local') });

const DEMO_AGENT_ID = 'agent_b7c4de5748c40e118d193db2f6';
const DEMO_LLM_ID = 'llm_b7548a5a95b73561e5c65e550264';
const DEMO_VOICE_ID = 'custom_voice_f823c5f8e830f233c09930e612';

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error('❌ Falta tenantId. Uso: pnpm tsx scripts/setup-futura-demo-agent.ts <tenantId>');
    process.exit(1);
  }

  const { db } = await import('../lib/db/client');
  const { tenants, phoneNumbers, ghlIntegrations } = await import('../lib/db/schema');
  const { upsertAgentConfig } = await import('../lib/data/agent-config');
  const { and, eq } = await import('drizzle-orm');

  // 1. Confirmar que existe el tenant
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) {
    console.error(`❌ Tenant ${tenantId} no existe en la DB.`);
    process.exit(1);
  }
  console.log(`✓ Tenant encontrado: ${tenant.name} (slug=${tenant.slug})`);

  // 2. Verificar número activo
  const [phone] = await db
    .select()
    .from(phoneNumbers)
    .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.active, true)))
    .limit(1);
  if (!phone) {
    console.warn(
      `⚠️  Sin número Twilio activo en phone_numbers para este tenant. La llamada va a fallar con reason=no_phone hasta que cargues uno.`,
    );
  } else {
    console.log(`✓ Número Twilio activo: ${phone.e164}`);
  }

  // 3. Verificar GHL conectado
  const [ghl] = await db
    .select()
    .from(ghlIntegrations)
    .where(eq(ghlIntegrations.tenantId, tenantId))
    .limit(1);
  if (!ghl) {
    console.warn(
      `⚠️  GHL no conectado para este tenant. El agente NO va a poder agendar la demo. Conectalo desde /dashboard → Integraciones → GoHighLevel.`,
    );
  } else {
    console.log(`✓ GHL conectado (locationId=${ghl.locationId})`);
  }

  // 4. Upsert agent_configs(role='outbound') apuntando al agente Sofía
  await upsertAgentConfig({
    tenantId,
    role: 'outbound',
    retellAgentId: DEMO_AGENT_ID,
    retellLlmId: DEMO_LLM_ID,
    voiceId: DEMO_VOICE_ID,
    currentPromptText: 'FUTURA Demo Outbound (Sofía) — prompt en Retell',
    published: true,
  });
  console.log(`✓ agent_configs(role='outbound') apunta a ${DEMO_AGENT_ID}`);

  console.log('\n✅ Listo. Pegá esto en Vercel → Environment Variables:\n');
  console.log(`FUTURA_DEMO_TENANT_ID=${tenantId}`);
  console.log(
    `FUTURA_DEMO_ALLOWED_ORIGINS=https://cliniq.futuradigital.es,https://www.cliniq.futuradigital.es\n`,
  );
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
