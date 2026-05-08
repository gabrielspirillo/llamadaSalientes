'use server';

import { recordAudit } from '@/lib/audit';
import { upsertAgentConfig } from '@/lib/data/agent-config';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';

function emptyToNull(s: FormDataEntryValue | null): string | null {
  const v = (s ?? '').toString().trim();
  return v === '' ? null : v;
}

export async function saveAgentConfigAction(formData: FormData) {
  const { tenant } = await getCurrentTenant();

  const updated = await upsertAgentConfig({
    tenantId: tenant.id,
    retellAgentId: emptyToNull(formData.get('retellAgentId')),
    voiceId: emptyToNull(formData.get('voiceId')) ?? undefined,
    welcomeMessage: emptyToNull(formData.get('welcomeMessage')),
    transferNumber: emptyToNull(formData.get('transferNumber')),
    tone: emptyToNull(formData.get('tone')),
    currentPromptText: emptyToNull(formData.get('currentPromptText')) ?? undefined,
  });

  await recordAudit({
    tenantId: tenant.id,
    action: 'update',
    entity: 'agent_config',
    entityId: updated.id,
    after: { retellAgentId: updated.retellAgentId, voiceId: updated.voiceId },
  });

  revalidatePath('/dashboard/agent');
}
