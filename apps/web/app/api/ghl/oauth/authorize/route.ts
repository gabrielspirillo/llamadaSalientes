import { requireOrg } from '@/lib/auth';
import { buildAuthorizeUrl } from '@/lib/ghl/oauth';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  // Solo usuarios con org activa pueden iniciar el flow
  await requireOrg();
  const { tenant } = await getCurrentTenant();

  // El state lleva el tenant_id para asociar la respuesta. Lo firmamos con
  // un tag corto del clerk_organization_id para que solo el callback de la
  // misma sesión pueda usarlo (el callback re-valida con la auth de Clerk).
  const state = `${tenant.id}.${Math.random().toString(36).slice(2, 12)}`;

  const url = buildAuthorizeUrl(state);
  return NextResponse.redirect(url, 302);
}
