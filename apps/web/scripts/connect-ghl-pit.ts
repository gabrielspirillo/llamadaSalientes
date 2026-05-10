import { createCipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../lib/db/schema';
import { ghlIntegrations, tenants } from '../lib/db/schema';

config({ path: path.resolve(__dirname, '../.env.local') });

// Uso: pnpm tsx scripts/connect-ghl-pit.ts <pit> <locationId> [tenantSlug]

const PIT_MARKER = '__PIT_NO_REFRESH__';
const IV_BYTES = 12;

// Inline crypto.encrypt — duplicado de lib/crypto.ts pero sin "server-only"
// para que tsx pueda ejecutar este script como CLI.
function encrypt(plaintext: string): string {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY no configurada');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`ENCRYPTION_KEY debe ser 32 bytes (es ${key.length})`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

async function main() {
  const pit = process.argv[2];
  const locationId = process.argv[3];
  const tenantSlug = process.argv[4];

  if (!pit || !locationId) {
    console.error('❌ Uso: pnpm tsx scripts/connect-ghl-pit.ts <pit> <locationId> [tenantSlug]');
    process.exit(1);
  }
  if (!pit.startsWith('pit-')) {
    console.error('❌ El token no parece un PIT (debería empezar con "pit-")');
    process.exit(1);
  }

  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DIRECT_URL or DATABASE_URL must be set');
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error('❌ ENCRYPTION_KEY no configurada en .env.local');
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
      console.error('❌ No se encontró tenant.');
      process.exit(1);
    }

    const values = {
      tenantId: tenant.id,
      locationId,
      companyId: null,
      accessTokenEnc: encrypt(pit),
      refreshTokenEnc: encrypt(PIT_MARKER),
      expiresAt: new Date('2099-12-31T00:00:00Z'),
      scopes: 'pit',
      connectedBy: null,
    };

    const existing = await db
      .select()
      .from(ghlIntegrations)
      .where(eq(ghlIntegrations.tenantId, tenant.id))
      .limit(1);

    if (existing[0]) {
      await db
        .update(ghlIntegrations)
        .set(values)
        .where(eq(ghlIntegrations.tenantId, tenant.id));
      console.log(`✅ GHL PIT actualizado para ${tenant.name} (location ${locationId})`);
    } else {
      await db.insert(ghlIntegrations).values(values);
      console.log(`✅ GHL PIT conectado para ${tenant.name} (location ${locationId})`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
