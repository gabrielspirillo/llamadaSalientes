// Construcción + interpolación de variables para templates de waitlist.
// Mismo formato `{{path.al.dato}}` que reminders. Comparte resolver con interpolate().

import type { WaitlistVars } from '@/lib/waitlist/types';

export type BuildWaitlistVarsInput = {
  oldAppointmentStartTime: Date;
  newSlotStartTime: Date;
  newSlotDurationMinutes: number | null;
  treatmentName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhoneE164: string | null;
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  clinicTimezone: string;
  offerId: string;
};

function safe(s: string | null | undefined, fallback = ''): string {
  return (s ?? '').trim() || fallback;
}

function formatDateTime(d: Date, tz: string) {
  const date = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  }).format(d);
  const time = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).format(d);
  return { date, time, dateTime: `${date} a las ${time}` };
}

export function buildWaitlistVars(input: BuildWaitlistVarsInput): WaitlistVars {
  const tz = input.clinicTimezone || 'Europe/Madrid';
  const firstName = safe(input.contactFirstName);
  const lastName = safe(input.contactLastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  const old = formatDateTime(input.oldAppointmentStartTime, tz);
  const neu = formatDateTime(input.newSlotStartTime, tz);

  return {
    contact: {
      firstName,
      lastName,
      fullName: fullName || 'paciente',
      phone: safe(input.contactPhoneE164),
    },
    oldAppointment: old,
    newSlot: {
      ...neu,
      durationMinutes:
        input.newSlotDurationMinutes != null ? String(input.newSlotDurationMinutes) : '',
    },
    treatment: safe(input.treatmentName, 'tu cita'),
    clinic: {
      name: safe(input.clinicName, 'la clínica'),
      address: safe(input.clinicAddress),
      phone: safe(input.clinicPhone),
      timezone: tz,
    },
    offerId: input.offerId,
  };
}

export function resolveWaitlistVar(path: string, vars: WaitlistVars): string {
  const segments = path
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cursor: any = vars;
  for (const raw of segments) {
    const camel = raw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (cursor == null || typeof cursor !== 'object') return '';
    cursor = cursor[camel] ?? cursor[raw];
  }
  if (cursor == null) return '';
  return typeof cursor === 'string' ? cursor : String(cursor);
}

export function interpolateWaitlist(text: string, vars: WaitlistVars): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) =>
    resolveWaitlistVar(path, vars),
  );
}
