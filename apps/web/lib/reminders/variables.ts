// Builder de variables para plantillas de recordatorio + interpolador.
//
// Las plantillas (Evolution free-text y nombres de plantillas Meta) referencian
// variables con `{{path.al.dato}}`. Esta capa centraliza la construcción de
// `vars` desde los datos de la cita + clínica + paciente + tratamiento, y la
// interpolación.

export type ReminderVarsContact = {
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
};

export type ReminderVarsAppointment = {
  date: string; // ej: "lunes, 25 de mayo de 2026"
  time: string; // ej: "10:30"
  dateTime: string; // ej: "lunes, 25 de mayo de 2026 a las 10:30"
  treatment: string; // nombre del tratamiento (o "tu cita" si no hay treatment)
  durationMinutes: string; // como string para interpolación directa
};

export type ReminderVarsClinic = {
  name: string;
  address: string;
  phone: string;
  timezone: string;
};

export type ReminderVars = {
  contact: ReminderVarsContact;
  appointment: ReminderVarsAppointment;
  clinic: ReminderVarsClinic;
  reminderId: string; // útil como literal en buttons / dynamicVars
};

export type BuildReminderVarsInput = {
  appointmentStartTime: Date;
  appointmentDurationMinutes: number | null;
  treatmentName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactPhoneE164: string | null;
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  clinicTimezone: string;
  reminderId: string;
};

function safe(s: string | null | undefined, fallback = ''): string {
  return (s ?? '').trim() || fallback;
}

export function buildReminderVars(input: BuildReminderVarsInput): ReminderVars {
  const tz = input.clinicTimezone || 'Europe/Madrid';
  const firstName = safe(input.contactFirstName);
  const lastName = safe(input.contactLastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  const dateFmt = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  });
  const timeFmt = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  });

  const dateStr = dateFmt.format(input.appointmentStartTime);
  const timeStr = timeFmt.format(input.appointmentStartTime);
  const dateTimeStr = `${dateStr} a las ${timeStr}`;

  return {
    contact: {
      firstName,
      lastName,
      fullName: fullName || 'paciente',
      phone: safe(input.contactPhoneE164),
    },
    appointment: {
      date: dateStr,
      time: timeStr,
      dateTime: dateTimeStr,
      treatment: safe(input.treatmentName, 'tu cita'),
      durationMinutes:
        input.appointmentDurationMinutes != null
          ? String(input.appointmentDurationMinutes)
          : '',
    },
    clinic: {
      name: safe(input.clinicName, 'la clínica'),
      address: safe(input.clinicAddress),
      phone: safe(input.clinicPhone),
      timezone: tz,
    },
    reminderId: input.reminderId,
  };
}

// Resuelve un path tipo "contact.first_name" o "appointment.date" contra
// las vars. Soporta camelCase y snake_case en el path (se normaliza a camelCase).
export function resolveVar(path: string, vars: ReminderVars): string {
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

// Interpola `{{var.path}}` en un texto libre. Vars no encontradas se
// reemplazan por '' (no dejar `{{x}}` visible).
export function interpolate(text: string, vars: ReminderVars): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => resolveVar(path, vars));
}
