// Reglas puras de la salud del canal de WhatsApp. Sin base de datos: con tests.
//
// Lo que las motivó (11-12/11/2026): la sesión de Evolution de Respinens dejó
// de recibir en tiempo real y sólo entregaba los mensajes cada 50 minutos, al
// reconectarse, con 2-4 h de retraso. Los envíos seguían funcionando, así que
// desde la app todo parecía normal mientras las respuestas de las familias no
// llegaban. Estas reglas son las que deciden si el canal es fiable.

/** Hasta esto, un entrante llegó a tiempo: es prueba de que el canal recibe. */
export const LAG_THRESHOLD_MS = 10 * 60_000;
/**
 * Retraso que cuenta como fallo del canal. Alto a propósito: un retraso de
 * minutos (cobertura, WhatsApp lento un rato) no puede cambiar cómo funciona
 * la clínica. El 11/11 los retrasos eran de 100 a 220 minutos.
 */
export const DEGRADE_LAG_MS = 30 * 60_000;
/** Conversaciones DISTINTAS con ese retraso en la última hora para darlo por caído. */
export const DEGRADE_MIN_CONVERSATIONS = 3;
/** Tras confirmarse el fallo, el canal se trata como no fiable este rato. */
export const DEGRADED_WINDOW_MS = 90 * 60_000;
/** Reconexiones en 24 h a partir de las cuales la sesión se considera inestable. */
export const UNSTABLE_RECONNECTS_24H = 12;
/** Entre dos avisos al equipo por el mismo canal. */
export const ALERT_COOLDOWN_MS = 3 * 3_600_000;
/** Un mensaje que llega con más retraso que esto, de noche, se contesta por la mañana. */
export const NIGHT_DEFER_LAG_MS = DEGRADE_LAG_MS;

export type ChannelProblem = 'NO_CONNECTION' | 'DISCONNECTED' | 'DELAYED';

export type ChannelRow = {
  mode: string;
  status: string;
  lastFreshInboundAt: Date | null;
  lastLaggedInboundAt: Date | null;
};

/** Retraso de un entrante (ms) o null si no sabemos cuándo se escribió. */
export function inboundLagMs(writtenAt: Date | null | undefined, receivedAt: Date): number | null {
  if (!writtenAt || Number.isNaN(writtenAt.getTime())) return null;
  return Math.max(0, receivedAt.getTime() - writtenAt.getTime());
}

/** ¿Este entrante llegó con retraso? */
export function isLagged(lagMs: number | null): boolean {
  return lagMs !== null && lagMs > LAG_THRESHOLD_MS;
}

/**
 * Estado del canal para lo que se manda HOY. `null` = sano.
 *
 * Sólo Evolution mide el retraso (trae la hora en que se escribió cada
 * mensaje y es la vía no oficial, la que se rompe); Cloud API y Twilio cuentan
 * como sanos mientras estén conectados.
 */
export function channelProblem(row: ChannelRow | null, now: Date): ChannelProblem | null {
  if (!row) return 'NO_CONNECTION';
  // PENDING es el segundo que dura cada reconexión (o el emparejamiento por
  // QR): no cuenta. Si de verdad no conecta, los envíos fallan y cada flujo ya
  // lo trata como fallo de envío.
  if (row.status === 'DISCONNECTED' || row.status === 'ERROR') return 'DISCONNECTED';
  if (row.mode !== 'EVOLUTION') return null;
  if (
    row.lastLaggedInboundAt &&
    now.getTime() - row.lastLaggedInboundAt.getTime() < DEGRADED_WINDOW_MS
  ) {
    return 'DELAYED';
  }
  return null;
}

/**
 * ¿Hay prueba de que el canal RECIBE desde `since`? Es la condición para hacer
 * algo irreversible por no haber recibido respuesta (anular una cita): que no
 * contesten tiene que significar que no contestaron, no que no nos llegó.
 *
 * En Evolution exige un entrante a tiempo después de `since` y ninguno con
 * retraso en ese tramo. Cloud API / Twilio: basta con estar conectado.
 */
export function receivingSince(row: ChannelRow | null, since: Date, now: Date): boolean {
  if (channelProblem(row, now)) return false;
  if (!row || row.mode !== 'EVOLUTION') return true;
  if (!row.lastFreshInboundAt || row.lastFreshInboundAt < since) return false;
  if (row.lastLaggedInboundAt && row.lastLaggedInboundAt >= since) return false;
  return true;
}

/** Texto para Futura según el problema (la clínica no lo ve). */
export function channelProblemText(problem: ChannelProblem, lagMinutes?: number | null): string {
  switch (problem) {
    case 'NO_CONNECTION':
      return 'La clínica no tiene WhatsApp conectado.';
    case 'DISCONNECTED':
      return 'No entra ni sale ningún mensaje. Hay que volver a vincular el número (QR) en WhatsApp → Integraciones de la clínica.';
    case 'DELAYED':
      return `Los mensajes entrantes llegan con retraso${
        lagMinutes ? ` (hasta ${lagMinutes} min)` : ''
      } en varias conversaciones. Mientras dure, no se anulan citas por falta de confirmación (quedan para llamar) y los huecos que se liberen esperan a que el canal se recupere para ofrecerse. Revisar la instancia de Evolution; si sigue, desvincular y volver a vincular.`;
  }
}

/** ¿Es de noche para escribir a una familia? Ventana [startMin, endMin) que puede cruzar medianoche. */
export function isQuietMinute(minuteOfDay: number, startMin = 23 * 60, endMin = 8 * 60): boolean {
  return startMin > endMin
    ? minuteOfDay >= startMin || minuteOfDay < endMin
    : minuteOfDay >= startMin && minuteOfDay < endMin;
}

/**
 * Nota para el asistente cuando lo que contesta se escribió hace rato: "hoy" o
 * "mañana" en el mensaje se refieren a ese día, no al de la respuesta.
 */
export function lateMessageNote(writtenLabel: string): string {
  return `[Aviso del sistema: este mensaje se escribió ${writtenLabel} y nos ha llegado tarde por un fallo de conexión de WhatsApp. Interpreta "hoy", "mañana" o "esta tarde" respecto a cuándo se escribió. Si lo que pedía ya no es posible (una hora que ya pasó), dilo con naturalidad y ofrece lo siguiente; no pidas perdón ni des la razón.]`;
}
