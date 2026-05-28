// Resuelve qué plantilla aplicar para un (regla, canal, driver activo del tenant).
//
// Reglas:
//   - Match exacto por driverScope.
//   - Si no hay match exacto y el canal es WHATSAPP, intentar fallback a
//     cualquier template de WhatsApp del mismo rule (mismo channel).
//   - Si no hay nada → null.

import type { ReminderButton, ReminderDriverScope, ReminderTemplateParam } from '@/lib/db/schema';

export type ReminderTemplateRow = {
  id: string;
  ruleId: string;
  channel: 'WHATSAPP' | 'VOICE';
  driverScope: ReminderDriverScope;
  templateName: string | null;
  templateLanguage: string;
  templateParamsMap: ReminderTemplateParam[];
  freeText: string | null;
  buttons: ReminderButton[];
  voicePromptOverride: string | null;
  enabled: boolean;
};

export function driverScopeForWhatsAppMode(
  mode: 'CLOUD' | 'EVOLUTION' | 'TWILIO',
): ReminderDriverScope {
  switch (mode) {
    case 'CLOUD':
      return 'whatsapp_cloud';
    case 'EVOLUTION':
      return 'whatsapp_evolution';
    case 'TWILIO':
      return 'whatsapp_twilio';
  }
}

export function resolveTemplate(
  templates: ReminderTemplateRow[],
  channel: 'WHATSAPP' | 'VOICE',
  driverScope: ReminderDriverScope,
): ReminderTemplateRow | null {
  const enabled = templates.filter((t) => t.enabled);
  const exact = enabled.find((t) => t.channel === channel && t.driverScope === driverScope);
  if (exact) return exact;
  if (channel === 'WHATSAPP') {
    // Fallback: cualquier template WhatsApp del mismo rule, útil si el operador
    // configuró solo Evolution y luego cambió a Cloud sin actualizar plantillas.
    return enabled.find((t) => t.channel === 'WHATSAPP') ?? null;
  }
  return null;
}

// Default buttons (3 quick-replies) cuando el template no override `buttons`.
export function defaultReminderButtons(reminderId: string): ReminderButton[] {
  return [
    { id: `rem:confirm:${reminderId}`, title: 'Confirmar' },
    { id: `rem:reschedule:${reminderId}`, title: 'Reagendar' },
    { id: `rem:cancel:${reminderId}`, title: 'Cancelar' },
  ];
}
