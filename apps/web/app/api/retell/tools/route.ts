import { resolveTenantId } from '@/lib/data/phone-tenant';
import { verifyRetellSignature } from '@/lib/retell/verify';
import { dispatchTool } from '@/lib/retell/tools';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Retell llama este endpoint cuando el agente invoca una tool durante la conversación.
// Body shape (custom function call):
// { name, args: {...}, call: { call_id, to_number, from_number, metadata: { tenant_id? } } }

type RetellToolCallBody = {
  name: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>; // alias por compat
  call: {
    call_id: string;
    to_number?: string;
    from_number?: string;
    metadata?: { tenant_id?: string };
  };
};

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-retell-signature');
  const apiKey = process.env.RETELL_API_KEY ?? '';

  if (!(await verifyRetellSignature(rawBody, signature, apiKey))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: RetellToolCallBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as RetellToolCallBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantId = await resolveTenantId({
    metadataTenantId: body.call.metadata?.tenant_id,
    toNumber: body.call.to_number,
  });
  if (!tenantId) {
    // Devolvemos 200 con un result entendible para que el agente no quede colgado
    return NextResponse.json({
      result:
        'No pude identificar la clínica para esta llamada. El equipo te contactará en breve.',
    });
  }

  const toolArgs = body.args ?? body.arguments ?? {};
  const toolResult = await dispatchTool(tenantId, body.name, toolArgs);

  // Retell espera { result: string } como respuesta del tool
  return NextResponse.json(toolResult);
}
