import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { WaitlistSettingsForm } from '@/components/waitlist/SettingsForm';
import { TemplatesEditor } from '@/components/waitlist/TemplatesEditor';
import {
  TreatmentsToggle,
  type TreatmentToggleRow,
} from '@/components/waitlist/TreatmentsToggle';
import { db } from '@/lib/db/client';
import { treatments, waitlistMessageTemplates, whatsappConnections } from '@/lib/db/schema';
import { driverScopeForWhatsAppMode } from '@/lib/reminders/template-resolver';
import { getCurrentTenant } from '@/lib/tenant';
import { getOrCreateWaitlistSettings } from '@/lib/waitlist/settings';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function WaitlistSettingsPage() {
  const { tenant } = await getCurrentTenant();
  const settings = await getOrCreateWaitlistSettings(tenant.id);

  const [conn] = await db
    .select({ mode: whatsappConnections.mode })
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenant.id), eq(whatsappConnections.status, 'CONNECTED')),
    )
    .orderBy(desc(whatsappConnections.updatedAt))
    .limit(1);

  const activeWhatsappScope = conn ? driverScopeForWhatsAppMode(conn.mode) : null;

  const treatmentsRaw = await db
    .select({
      id: treatments.id,
      name: treatments.name,
      durationMinutes: treatments.durationMinutes,
      active: treatments.active,
      waitlistEligible: treatments.waitlistEligible,
    })
    .from(treatments)
    .where(eq(treatments.tenantId, tenant.id))
    .orderBy(treatments.name);

  const treatmentsRows: TreatmentToggleRow[] = treatmentsRaw.map((t) => ({
    id: t.id,
    name: t.name,
    durationMinutes: t.durationMinutes,
    active: t.active ?? true,
    waitlistEligible: t.waitlistEligible,
  }));

  const templates = await db
    .select({
      id: waitlistMessageTemplates.id,
      channel: waitlistMessageTemplates.channel,
      driverScope: waitlistMessageTemplates.driverScope,
      templateName: waitlistMessageTemplates.templateName,
      templateLanguage: waitlistMessageTemplates.templateLanguage,
      freeText: waitlistMessageTemplates.freeText,
      voicePromptOverride: waitlistMessageTemplates.voicePromptOverride,
      enabled: waitlistMessageTemplates.enabled,
    })
    .from(waitlistMessageTemplates)
    .where(eq(waitlistMessageTemplates.tenantId, tenant.id));

  return (
    <>
      <PageHeader
        title="Configuración de Waitlist"
        description="Ajustá el canal de oferta, TTL, umbrales de elegibilidad, tratamientos y plantillas."
        actions={
          <Link href="/dashboard/waitlist">
            <Button size="sm" variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Volver
            </Button>
          </Link>
        }
      />

      <div className="space-y-8">
        <WaitlistSettingsForm
          initial={{
            enabled: settings.enabled,
            channelMode: settings.channelMode,
            ttlMinutesDefault: settings.ttlMinutesDefault,
            ttlMinutesNearSlot: settings.ttlMinutesNearSlot,
            nearSlotHoursThreshold: settings.nearSlotHoursThreshold,
            minSkipHoursThreshold: settings.minSkipHoursThreshold,
            whatsappToVoiceWindowMinutes: settings.whatsappToVoiceWindowMinutes,
            minAppointmentDistanceDays: settings.minAppointmentDistanceDays,
            maxAppointmentDistanceDays: settings.maxAppointmentDistanceDays,
            minAdvanceDays: settings.minAdvanceDays,
            requireSameDentist: settings.requireSameDentist,
            respectTimeWindow: settings.respectTimeWindow,
          }}
        />

        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Tratamientos elegibles</h2>
            <p className="text-sm text-zinc-500">
              Activá los tratamientos para los que querés que el sistema gestione waitlist.
            </p>
          </div>
          <TreatmentsToggle rows={treatmentsRows} />
        </div>

        <TemplatesEditor
          initialTemplates={templates.map((t) => ({
            id: t.id,
            channel: t.channel as 'WHATSAPP' | 'VOICE',
            driverScope: t.driverScope as
              | 'whatsapp_cloud'
              | 'whatsapp_twilio'
              | 'whatsapp_evolution'
              | 'voice_retell',
            templateName: t.templateName,
            templateLanguage: t.templateLanguage,
            freeText: t.freeText,
            voicePromptOverride: t.voicePromptOverride,
            enabled: t.enabled,
          }))}
          activeWhatsappScope={activeWhatsappScope as
            | 'whatsapp_cloud'
            | 'whatsapp_twilio'
            | 'whatsapp_evolution'
            | null}
        />
      </div>
    </>
  );
}
