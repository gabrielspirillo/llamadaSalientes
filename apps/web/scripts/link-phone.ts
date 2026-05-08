import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../lib/db/schema';
import { phoneNumbers, tenants } from '../lib/db/schema';

config({ path: path.resolve(__dirname, '../.env.local') });

// Uso: pnpm tsx scripts/link-phone.ts <e164> [tenantSlug]
// Si no se pasa tenantSlug, usa el primer tenant que encuentre (single-tenant dev).

async function main() {
  const e164 = process.argv[2];
  const tenantSlug = process.argv[3];

  if (!e164) {
    console.error('❌ Uso: pnpm tsx scripts/link-phone.ts <e164> [tenantSlug]');
    console.error('   Ejemplo: pnpm tsx scripts/link-phone.ts +19706844968');
    process.exit(1);
  }

  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DIRECT_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30 });
  const db = drizzle(sql, { schema });

  try {
    let tenant: { id: string; name: string } | undefined;
    if (tenantSlug) {
      const found = await db
        .select({ id: tenants.id, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.slug, tenantSlug))
        .limit(1);
      tenant = found[0];
    } else {
      const all = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).limit(1);
      tenant = all[0];
    }

    if (!tenant) {
      console.error('❌ No se encontró tenant. Creá la organización en Clerk primero.');
      process.exit(1);
    }

    // ¿Ya existe el número?
    const existing = await db
      .select()
      .from(phoneNumbers)
      .where(eq(phoneNumbers.e164, e164))
      .limit(1);

    if (existing[0]) {
      if (existing[0].tenantId === tenant.id) {
        console.log(`✅ ${e164} ya está vinculado a ${tenant.name}`);
        return;
      }
      await db
        .update(phoneNumbers)
        .set({ tenantId: tenant.id })
        .where(eq(phoneNumbers.e164, e164));
      console.log(`✅ ${e164} reasignado a ${tenant.name}`);
      return;
    }

    await db.insert(phoneNumbers).values({
      tenantId: tenant.id,
      e164,
      twilioSid: 'manual-import',
      retellPhoneId: null,
      active: true,
    });
    console.log(`✅ ${e164} vinculado a ${tenant.name} (id: ${tenant.id})`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
