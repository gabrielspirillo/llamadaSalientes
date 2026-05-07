import { db } from '@/lib/db/client';
import { clinicSettings, faqs, tenants, treatments, users, webhookLogs } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { SEED_FAQS, SEED_TREATMENTS } from '@/lib/seed-data';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Eventos que escuchamos según configuración del webhook en el dashboard de Clerk.
type ClerkOrgEvent = {
  type: 'organization.created' | 'organization.updated' | 'organization.deleted';
  data: { id: string; name: string; slug: string | null; created_by?: string };
};
type ClerkUserEvent = {
  type: 'user.created' | 'user.updated';
  data: { id: string; email_addresses: { email_address: string }[] };
};
type ClerkEvent = ClerkOrgEvent | ClerkUserEvent;

const DEFAULT_RECORDING_CONSENT =
  'Esta llamada se está grabando para mejorar la calidad del servicio. Si no querés que se grabe, podés colgar y nuestra recepción te llamará de vuelta.';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headerPayload = await headers();
  const svixId = headerPayload.get('svix-id');
  const svixTimestamp = headerPayload.get('svix-timestamp');
  const svixSignature = headerPayload.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    await logWebhook(null, null, 400, false, { error: 'missing svix headers' });
    return NextResponse.json({ error: 'missing svix headers' }, { status: 400 });
  }

  const wh = new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET);
  let evt: ClerkEvent;
  try {
    evt = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    await logWebhook(null, null, 401, false, { error: 'invalid signature' });
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  try {
    switch (evt.type) {
      case 'organization.created':
        await handleOrgCreated(evt);
        break;
      case 'organization.updated':
        await handleOrgUpdated(evt);
        break;
      case 'organization.deleted':
        await handleOrgDeleted(evt);
        break;
      case 'user.created':
      case 'user.updated':
        await handleUserUpsert(evt);
        break;
    }

    await logWebhook(evt.type, null, 200, true, evt.data);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = (err as Error).message;
    await logWebhook(evt.type, null, 500, true, { error: message });
    return NextResponse.json({ error: 'processing failed', message }, { status: 500 });
  }
}

async function handleOrgCreated(evt: ClerkOrgEvent) {
  // Idempotente: si ya existe un tenant con ese clerk_organization_id, no hacemos nada.
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.clerkOrganizationId, evt.data.id))
    .limit(1);
  if (existing.length > 0) return;

  const slug = evt.data.slug ?? slugify(evt.data.name);

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: evt.data.name,
      slug,
      clerkOrganizationId: evt.data.id,
      plan: 'starter',
      status: 'trial',
    })
    .returning({ id: tenants.id });

  if (!tenant) throw new Error('failed to insert tenant');

  // Defaults sensatos para que el tenant pueda navegar el dashboard sin completar todo.
  await db.insert(clinicSettings).values({
    tenantId: tenant.id,
    timezone: 'America/Mexico_City',
    defaultLanguage: 'es',
    recordingConsentText: DEFAULT_RECORDING_CONSENT,
    workingHours: {
      monday: { open: '09:00', close: '19:00' },
      tuesday: { open: '09:00', close: '19:00' },
      wednesday: { open: '09:00', close: '19:00' },
      thursday: { open: '09:00', close: '19:00' },
      friday: { open: '09:00', close: '19:00' },
      saturday: { open: '10:00', close: '14:00' },
      sunday: null,
    },
  });

  // Auto-seed: 8 tratamientos + 7 FAQs para que el dashboard arranque vivo.
  // El usuario puede editarlos / borrarlos desde la UI.
  await db
    .insert(treatments)
    .values(SEED_TREATMENTS.map((t) => ({ tenantId: tenant.id, ...t, currency: 'USD' })));
  await db.insert(faqs).values(SEED_FAQS.map((f) => ({ tenantId: tenant.id, ...f })));
}

async function handleOrgUpdated(evt: ClerkOrgEvent) {
  await db
    .update(tenants)
    .set({
      name: evt.data.name,
      slug: evt.data.slug ?? slugify(evt.data.name),
    })
    .where(eq(tenants.clerkOrganizationId, evt.data.id));
}

async function handleOrgDeleted(evt: ClerkOrgEvent) {
  // Soft delete: status = suspended. La cascada de FK borraría datos críticos.
  await db
    .update(tenants)
    .set({ status: 'suspended' })
    .where(eq(tenants.clerkOrganizationId, evt.data.id));
}

async function handleUserUpsert(evt: ClerkUserEvent) {
  const email = evt.data.email_addresses[0]?.email_address;
  if (!email) return;

  // upsert manual por clerk_user_id
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, evt.data.id))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(users).values({ clerkUserId: evt.data.id, email });
  } else {
    await db.update(users).set({ email }).where(eq(users.clerkUserId, evt.data.id));
  }
}

async function logWebhook(
  event: string | null,
  tenantId: string | null,
  statusCode: number,
  signatureValid: boolean,
  body: unknown,
) {
  try {
    await db.insert(webhookLogs).values({
      tenantId,
      source: 'clerk',
      event,
      signatureValid,
      statusCode,
      body: body as Record<string, unknown>,
    });
  } catch {
    // Logging no debe nunca tirar el webhook abajo.
  }
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '') // strip combining diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `tenant-${Date.now()}`
  );
}
