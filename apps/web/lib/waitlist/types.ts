// Tipos compartidos del módulo waitlist.
//
// Las filas crudas Drizzle se exponen vía $inferSelect; estos tipos son shapes
// "ligeros" para señales/contratos entre engine, senders y handlers.

import type {
  ReminderButton,
  ReminderDriverScope,
  ReminderTemplateParam,
} from '@/lib/db/schema';

export type WaitlistDriverScope = ReminderDriverScope;
export type WaitlistButton = ReminderButton;
export type WaitlistTemplateParam = ReminderTemplateParam;

export type WaitlistChannel = 'WHATSAPP' | 'VOICE';

export type WaitlistVarsContact = {
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
};

export type WaitlistVarsAppointment = {
  date: string;
  time: string;
  dateTime: string;
};

export type WaitlistVars = {
  contact: WaitlistVarsContact;
  // Cita original (la que el paciente tenía agendada).
  oldAppointment: WaitlistVarsAppointment;
  // Slot ofrecido (más temprano, liberado por cancelación).
  newSlot: WaitlistVarsAppointment & { durationMinutes: string };
  treatment: string;
  clinic: {
    name: string;
    address: string;
    phone: string;
    timezone: string;
  };
  offerId: string;
};

export type WaitlistTemplateRow = {
  id: string;
  tenantId: string;
  channel: WaitlistChannel;
  driverScope: WaitlistDriverScope;
  templateName: string | null;
  templateLanguage: string;
  templateParamsMap: WaitlistTemplateParam[];
  freeText: string | null;
  buttons: WaitlistButton[];
  voicePromptOverride: string | null;
  enabled: boolean;
};
