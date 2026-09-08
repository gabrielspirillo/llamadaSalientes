/**
 * De qué origen es el id de una cita.
 *
 * Las citas viven en dos sitios: la agenda de la plataforma
 * (`agenda_appointments`, ids UUID) y GoHighLevel (ids alfanuméricos de unos
 * 20 caracteres). Las tablas que las referencian —recordatorios, huecos
 * cancelados, lista de espera— tienen una única columna de texto para el id,
 * heredada de cuando GoHighLevel era el único origen posible.
 *
 * La forma del id es la que decide dónde buscar. Esta comprobación ya estaba
 * escrita a mano en la cancelación de citas de los agentes; aquí se centraliza
 * para que todos los sitios usen exactamente el mismo criterio.
 *
 * Puro: sin base de datos, para poder testearlo suelto.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La cita es de la agenda de la plataforma. */
export function isInternalAppointmentId(id: string | null | undefined): boolean {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

/** La cita es de GoHighLevel: alfanumérico, sin guiones. */
export function isCrmAppointmentId(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9]{15,30}$/.test(id.trim());
}

/**
 * La agenda de cada profesional hace de calendario.
 *
 * `cancelled_slots` y la atribución de huecos recuperados emparejan un hueco
 * que se libera con la cita que lo ocupa por (calendario, hora de inicio). Sin
 * un calendario, una cita propia nunca podía emparejarse con nada y la métrica
 * de huecos recuperados se quedaba a cero para toda clínica sin CRM.
 */
export function calendarRefForProfessional(professionalId: string): string {
  return `prof:${professionalId}`;
}

export function professionalFromCalendarRef(ref: string | null | undefined): string | null {
  return ref?.startsWith('prof:') ? ref.slice(5) : null;
}
