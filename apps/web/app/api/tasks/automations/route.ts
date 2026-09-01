import { NextResponse } from 'next/server';

import { taskErrorResponse } from '@/lib/tasks/api';
import { requireTaskRole } from '@/lib/tasks/auth';
import { ensureAutomationRules } from '@/lib/tasks/automation';
import { loadAutomationRules } from '@/lib/tasks/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireTaskRole('viewer');
    await ensureAutomationRules(auth.tenantId);
    return NextResponse.json({ rules: await loadAutomationRules(auth.tenantId) });
  } catch (err) {
    return taskErrorResponse(err);
  }
}
