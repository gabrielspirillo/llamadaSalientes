import 'server-only';
import type { OnboardingPayload } from '@/lib/onboarding/schema';

export type OnboardingSummary = {
  tenant: string;
  clinicName: string;
  contactEmail: string;
  submittedAt: string;
  treatmentsCount: number;
  faqsCount: number;
  transferNumber: string;
};

export function buildSummary(payload: OnboardingPayload): OnboardingSummary {
  return {
    tenant: payload.tenant,
    clinicName: payload.clinic.name,
    contactEmail: payload.clinic.contactEmail,
    submittedAt: payload.submittedAt,
    treatmentsCount: payload.treatments.length,
    faqsCount: payload.faqs.length,
    transferNumber: payload.agent.transferNumber,
  };
}

/**
 * Aviso interno al equipo Futura cuando una clínica termina el onboarding.
 *
 * STUB a propósito: el prompt pide dejar preparado el punto de integración
 * sin acoplar un proveedor. Cuando se decida el canal (email transaccional,
 * WhatsApp interno, webhook de Slack…), implementar acá el envío real.
 *
 * TODO(futura): elegir canal y enviar el resumen. Opciones ya presentes en el
 * repo que se pueden reusar sin dependencias nuevas:
 *   - Email/WhatsApp: lib/twilio/*  (WhatsApp saliente).
 *   - Slack: fetch a un Incoming Webhook (env SLACK_ONBOARDING_WEBHOOK_URL).
 * De momento solo se loguea para no perder el evento.
 */
export async function notifyInternalTeam(summary: OnboardingSummary): Promise<void> {
  console.info('[onboarding] nuevo onboarding recibido:', JSON.stringify(summary));

  // TODO(futura): reemplazar el log por el envío real, p.ej.:
  //
  //   const url = process.env.SLACK_ONBOARDING_WEBHOOK_URL;
  //   if (url) {
  //     await fetch(url, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         text: `🦷 Nueva clínica onboardeada: *${summary.clinicName}* (${summary.tenant})\n` +
  //               `Contacto: ${summary.contactEmail} · ${summary.treatmentsCount} tratamientos, ` +
  //               `${summary.faqsCount} FAQs · transfer ${summary.transferNumber}`,
  //       }),
  //     });
  //   }
}
