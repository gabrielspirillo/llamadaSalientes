import { z } from 'zod';

/**
 * Guiones de WhatsApp de la clínica (perfil de atención): lo que se contesta
 * al pedir cita, lo que se manda al reservar y las respuestas cortas de
 * siempre. Los de la reserva los manda la app con el texto exacto (fecha
 * escrita por el servidor, nunca por el modelo); el resto entra en el prompt.
 *
 * Variables: {{paciente}} (nombre del niño), {{fecha}} ("Lunes, 2 de
 * noviembre") y {{hora}} ("12:30").
 */
const scripts = z
  .object({
    greeting: z.string().optional(),
    firstVisitBooked: z.array(z.string()).optional(),
    returningBooked: z.array(z.string()).optional(),
    thanks: z.string().optional(),
    cancelled: z.string().optional(),
    sick: z.string().optional(),
    dayConfirmed: z.string().optional(),
  })
  .partial();

export type CareMessageScripts = z.infer<typeof scripts>;

export function parseMessageScripts(raw: unknown): CareMessageScripts | null {
  const parsed = scripts.safeParse(raw ?? {});
  if (!parsed.success) return null;
  const data = parsed.data;
  return Object.values(data).some((v) => (Array.isArray(v) ? v.length > 0 : !!v?.trim()))
    ? data
    : null;
}

export function fillScript(
  text: string,
  vars: { paciente?: string | null; fecha?: string; hora?: string },
): string {
  return text
    .replaceAll('{{paciente}}', vars.paciente?.trim() || 'tu peque')
    .replaceAll('{{fecha}}', vars.fecha ?? '')
    .replaceAll('{{hora}}', vars.hora ?? '');
}

/** "Lunes, 2 de noviembre" y "12:30" en la zona de la clínica. */
export function scriptDateParts(startsAt: Date, timezone: string): { fecha: string; hora: string } {
  const weekday = startsAt.toLocaleDateString('es-ES', { weekday: 'long', timeZone: timezone });
  const dayMonth = startsAt.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  });
  const hora = startsAt.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  });
  return { fecha: `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`, hora };
}

/**
 * Mensajes que salen tras reservar. Guion A sólo para quien empieza de cero
 * (primera visita y ningún hermano vino antes); guion B para el paciente que
 * vuelve y para la primera visita de un hermano de alguien que ya vino.
 */
export function bookingMessages(
  s: CareMessageScripts,
  booking: {
    patientFirstName: string | null;
    startsAt: Date;
    timezone: string;
    isFirstVisit: boolean;
    siblingCameBefore: boolean;
  },
): string[] {
  const fresh = booking.isFirstVisit && !booking.siblingCameBefore;
  const list = (fresh ? s.firstVisitBooked : s.returningBooked) ?? [];
  const parts = scriptDateParts(booking.startsAt, booking.timezone);
  return list
    .map((t) => fillScript(t, { paciente: booking.patientFirstName, ...parts }).trim())
    .filter(Boolean);
}

/** Sección del prompt de WhatsApp con los guiones que escribe el modelo. */
export function buildScriptsSection(s: CareMessageScripts): string {
  const lines = ['# Cómo escribe esta clínica por WhatsApp (copia sus palabras y sus emojis)'];
  if (s.greeting) {
    lines.push(
      '',
      'Cuando alguien pide cita y NO sabes si ya vino (no hay niños en el contexto), contesta con este mensaje tal cual, opciones incluidas:',
      s.greeting,
      'Según lo que responda: "primera visita" → primera visita; "ya he ido" → paciente que vuelve (búscalo y no repitas preguntas de primera visita); "con otro peque / hermano mayor" → es la primera visita de este niño pero un hermano ya vino.',
      'Si ya conoces a la familia (el contexto trae sus niños), no preguntes si es la primera vez: pregunta para cuál de sus peques es la cita, y recuerda igualmente el aviso de fiebre o dificultad respiratoria.',
    );
  }
  if (s.firstVisitBooked?.length || s.returningBooked?.length) {
    lines.push(
      '',
      'Al reservar con book_appointment, la confirmación (fecha, hora, ayuno, cambios con 6 horas, dirección) la envía el sistema con el texto de la clínica. NO la escribas tú ni repitas la fecha: si no tienes nada más que añadir, responde sólo "OK".',
    );
  }
  const short: [string, string | undefined][] = [
    ['Si dan las gracias', s.thanks],
    [
      'Si cancelan con antelación (después de cancelar la cita con cancel_appointment)',
      s.cancelled,
    ],
    ['Si dicen que el peque está malo', s.sick],
    ['Si el día de la sesión confirman que vienen', s.dayConfirmed],
  ];
  const present = short.filter(([, t]) => t?.trim());
  if (present.length) {
    lines.push('', 'Respuestas de siempre (cambia (nombre) por el del niño):');
    for (const [when, text] of present) lines.push(`- ${when}: "${text}"`);
  }
  return lines.join('\n');
}
