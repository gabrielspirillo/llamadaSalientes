import { recordAudit } from '@/lib/audit';
import { upsertGhlIntegration } from '@/lib/data/ghl-integration';
import { env } from '@/lib/env';
import { exchangeCodeForTokens } from '@/lib/ghl/oauth';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Re-validamos sesión: el usuario debe estar logueado con la misma org del state.
  let tenantId: string;
  try {
    const { tenant } = await getCurrentTenant();
    tenantId = tenant.id;
  } catch {
    return redirectError(env.NEXT_PUBLIC_APP_URL, 'session_lost');
  }

  if (error) {
    return redirectError(env.NEXT_PUBLIC_APP_URL, error);
  }
  if (!code || !state) {
    return redirectError(env.NEXT_PUBLIC_APP_URL, 'missing_code_or_state');
  }

  // El state debe empezar con el tenant_id actual.
  const [stateTenantId] = state.split('.');
  if (stateTenantId !== tenantId) {
    return redirectError(env.NEXT_PUBLIC_APP_URL, 'state_mismatch');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await upsertGhlIntegration({ tenantId, tokens });
    await recordAudit({
      tenantId,
      action: 'connect',
      entity: 'ghl_integration',
      entityId: tokens.locationId ?? null,
      after: { locationId: tokens.locationId, scopes: tokens.scope },
    });
    return NextResponse.redirect(`${env.NEXT_PUBLIC_APP_URL}/dashboard/settings?ghl=connected`);
  } catch (err) {
    console.error('ghl_oauth_callback_failed', err);
    return redirectError(env.NEXT_PUBLIC_APP_URL, 'token_exchange_failed');
  }
}

function redirectError(base: string, code: string) {
  return NextResponse.redirect(`${base}/dashboard/settings?ghl_error=${encodeURIComponent(code)}`);
}
