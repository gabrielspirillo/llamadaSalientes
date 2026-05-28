// Resuelve qué plantilla aplicar para un (canal, driver activo del tenant) en
// el módulo waitlist. Mismo algoritmo que el resolver de reminders.

import type { WaitlistDriverScope, WaitlistTemplateRow } from '@/lib/waitlist/types';

export function resolveWaitlistTemplate(
  templates: WaitlistTemplateRow[],
  channel: 'WHATSAPP' | 'VOICE',
  driverScope: WaitlistDriverScope,
): WaitlistTemplateRow | null {
  const enabled = templates.filter((t) => t.enabled);
  const exact = enabled.find((t) => t.channel === channel && t.driverScope === driverScope);
  if (exact) return exact;
  if (channel === 'WHATSAPP') {
    return enabled.find((t) => t.channel === 'WHATSAPP') ?? null;
  }
  return null;
}

export function defaultWaitlistButtons(offerId: string) {
  return [
    { id: `wlo:accept:${offerId}`, title: 'Acepto' },
    { id: `wlo:decline:${offerId}`, title: 'No puedo' },
  ];
}
