// Cómo se cuenta la agenda de un profesional con palabras.
//
// Lo consumen los agentes virtuales (voz y WhatsApp) y el prompt que se les
// inyecta, así que sale en castellano llano y en hora local de la clínica: si
// el paciente pregunta "¿qué días está la doctora Ruiz?", el agente tiene que
// poder responderlo sin inventarse nada.
//
// Todo lo de este archivo es puro: se testea sin base ni red.

import { WEEKDAY_LABELS, minutesToHHMM } from '@/lib/agenda/shared';
import { localDateKey } from '@/lib/tasks/tz';

export interface ShiftLike {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** "9:00 a 14:00 y de 16:00 a 20:00" */
function rangosDeUnDia(shifts: ShiftLike[]): string {
  return shifts
    .slice()
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((s) => `${minutesToHHMM(s.startMinute)} a ${minutesToHHMM(s.endMinute)}`)
    .join(' y de ');
}

/**
 * Horario semanal en una línea, agrupando los días seguidos que coinciden.
 *
 * "lunes a viernes de 09:00 a 14:00 y de 16:00 a 20:00; sábados de 10:00 a
 * 14:00". Agrupar importa: leerle al paciente siete líneas por teléfono es
 * insufrible, y el agente acaba resumiendo por su cuenta —que es cuando se
 * inventa cosas—.
 */
export function describeWeeklySchedule(shifts: ShiftLike[]): string {
  if (shifts.length === 0) return 'sin horario cargado';

  const porDia = new Map<number, ShiftLike[]>();
  for (const s of shifts) {
    const dia = porDia.get(s.weekday);
    if (dia) dia.push(s);
    else porDia.set(s.weekday, [s]);
  }

  const dias = [...porDia.keys()].sort((a, b) => a - b);
  const grupos: { desde: number; hasta: number; texto: string }[] = [];

  for (const dia of dias) {
    const texto = rangosDeUnDia(porDia.get(dia) ?? []);
    const ultimo = grupos[grupos.length - 1];
    // Se agrupan sólo los días CONSECUTIVOS con el mismo horario: juntar el
    // lunes con el jueves saltándose el martes diría algo que no es verdad.
    if (ultimo && ultimo.texto === texto && ultimo.hasta === dia - 1) {
      ultimo.hasta = dia;
    } else {
      grupos.push({ desde: dia, hasta: dia, texto });
    }
  }

  return grupos
    .map((g) => {
      const desde = WEEKDAY_LABELS[g.desde]?.toLowerCase() ?? '';
      const hasta = WEEKDAY_LABELS[g.hasta]?.toLowerCase() ?? '';
      const dias = g.desde === g.hasta ? desde : `${desde} a ${hasta}`;
      return `${dias} de ${g.texto}`;
    })
    .join('; ');
}

export interface AbsenceLike {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reason: string | null;
}

/**
 * Las ausencias que le importan a quien está pidiendo cita: las que aún no han
 * pasado y caen dentro del horizonte que se reserva.
 *
 * No se dice el motivo: "está de vacaciones" o "está de baja" es asunto del
 * profesional, no del paciente que llama. Basta con que no está.
 */
export function describeAbsences(
  blocks: AbsenceLike[],
  timezone: string,
  now: Date = new Date(),
  maxDias = 60,
): string {
  const hasta = new Date(now.getTime() + maxDias * 86_400_000);
  const vigentes = blocks
    .filter((b) => b.endsAt.getTime() > now.getTime() && b.startsAt.getTime() < hasta.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 4);

  if (vigentes.length === 0) return '';

  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
  });
  const hora = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  return vigentes
    .map((b) => {
      const desde = localDateKey(b.startsAt, timezone);
      // El final es exclusivo: un bloqueo que acaba a las 00:00 del día
      // siguiente cubre el día anterior, no el siguiente.
      const hastaKey = localDateKey(new Date(b.endsAt.getTime() - 1), timezone);

      if (b.allDay || desde !== hastaKey) {
        return desde === hastaKey
          ? `el ${fmt.format(b.startsAt)}`
          : `del ${fmt.format(b.startsAt)} al ${fmt.format(new Date(b.endsAt.getTime() - 1))}`;
      }
      return `el ${fmt.format(b.startsAt)} de ${hora.format(b.startsAt)} a ${hora.format(b.endsAt)}`;
    })
    .join(', ');
}
