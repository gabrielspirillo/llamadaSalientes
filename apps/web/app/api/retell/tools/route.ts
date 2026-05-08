import { verifyRetellSignature } from '@/lib/retell/verify';
import { dispatchTool } from '@/lib/retell/tools';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Retell llama este endpoint cuando el agente invoca una tool durante la conversación.
// Body shape (Retell custom tool call):
// { tool_call_id, name, arguments: {...}, call: { call_id, metadata: { tenant_id } } }

type RetellToolCallBody = {
  tool_call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  call: {
    call_id: string;
    metadata?: { tenant_id?: string };
  };
};

export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-retell-signature');
  const signingKey = process.env.RETELL_WEBHOOK_SIGNING_KEY ?? '';

  if (!verifyRetellSignature(rawBody, signature, signingKey)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: RetellToolCallBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as RetellToolCallBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tenantId = body.call.metadata?.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant_id in call metadata' }, { status: 400 });
  }

  const toolResult = await dispatchTool(tenantId, body.name, body.arguments);

  // Retell espera { result: string } como respuesta del tool
  return NextResponse.json(toolResult);
}
