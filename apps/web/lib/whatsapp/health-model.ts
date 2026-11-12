// Reglas puras de la salud del canal de WhatsApp. Sin base de datos: con tests.
//
// Lo que las motivó (11-12/11/2026): la sesión de Evolution de Respinens dejó
// de recibir en tiempo real y sólo entregaba los mensajes cada 50 minutos, al
// reconectarse, con 2-4 h de retraso. Los envíos seguían funcionando, así que
// desde la app todo parecía normal mientras las respuestas de las familias no
// llegaban. Estas reglas son las que deciden si el canal es fiable.

/** Un entrante escrito hace más de esto llegó tarde: el canal no es fiable. */
export const LAG_THRESHOLD_MS = 10 * 60_000;
/** Tras un entrante con retraso, el canal se trata como no fiable este rato. */
export const DEGRADED_WINDOW_MS = 3 * 3_600_000;
/** Reconexiones en 24 h a partir de las cuales la sesión se considera inestable. */
export const UNSTABLE_RECONNECTS_24H = 12;
/** Entre dos avisos al equipo por el mismo canal. */
export const ALERT_COOLDOWN_MS = 3 * 3_600_000;
/** Un mensaje que llega con más retraso que esto, de noche, se contesta por la mañana. */
export const NIGHT_DEFER_LAG_MS = 30 * 60_000;

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

/** Texto para el equipo según el problema. */
export function channelProblemText(problem: ChannelProblem, lagMinutes?: number | null): string {
  switch (problem) {
    case 'NO_CONNECTION':
      return 'La clínica no tiene WhatsApp conectado.';
    case 'DISCONNECTED':
      return 'El WhatsApp de la clínica está desconectado: no entra ni sale ningún mensaje. Hay que volver a vincularlo (escanear el QR) en WhatsApp → Integraciones.';
    case 'DELAYED':
      return `El WhatsApp de la clínica está recibiendo los mensajes con retraso${
        lagMinutes ? ` (hasta ${lagMinutes} min)` : ''
      }. Las familias pueden haber escrito y no haber recibido respuesta. Mientras dure no se anulan citas por falta de confirmación ni se ofrecen huecos por WhatsApp: confirmad por teléfono. Si sigue así, desvinculad y volved a vincular el WhatsApp.`;
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
