import { describe, expect, it } from 'vitest';

import {
  type ChannelRow,
  DEGRADED_WINDOW_MS,
  channelProblem,
  inboundLagMs,
  isLagged,
  isQuietMinute,
  receivingSince,
} from '@/lib/whatsapp/health-model';

const now = new Date('2026-11-12T11:30:00Z'); // 12:30 en Madrid
const min = (n: number) => n * 60_000;
const ago = (ms: number) => new Date(now.getTime() - ms);

const evo = (over: Partial<ChannelRow> = {}): ChannelRow => ({
  mode: 'EVOLUTION',
  status: 'CONNECTED',
  lastFreshInboundAt: ago(min(5)),
  lastLaggedInboundAt: null,
  ...over,
});

describe('retraso de un entrante', () => {
  it('mide desde que se escribió hasta que llega', () => {
    expect(inboundLagMs(ago(min(3)), now)).toBe(min(3));
    expect(inboundLagMs(null, now)).toBeNull();
    expect(inboundLagMs(new Date('x'), now)).toBeNull();
  });

  it('más de 10 minutos es retraso; un reloj adelantado no da negativo', () => {
    expect(isLagged(min(9))).toBe(false);
    expect(isLagged(min(11))).toBe(true);
    expect(isLagged(null)).toBe(false);
    expect(inboundLagMs(new Date(now.getTime() + 5000), now)).toBe(0);
  });
});

describe('estado del canal', () => {
  it('sin conexión o desconectado no es fiable', () => {
    expect(channelProblem(null, now)).toBe('NO_CONNECTION');
    expect(channelProblem(evo({ status: 'DISCONNECTED' }), now)).toBe('DISCONNECTED');
    expect(channelProblem(evo({ status: 'PENDING' }), now)).toBe('DISCONNECTED');
  });

  it('un entrante con retraso lo marca durante 3 h', () => {
    expect(channelProblem(evo({ lastLaggedInboundAt: ago(min(30)) }), now)).toBe('DELAYED');
    expect(
      channelProblem(evo({ lastLaggedInboundAt: ago(DEGRADED_WINDOW_MS + min(1)) }), now),
    ).toBeNull();
  });

  it('Cloud API / Twilio conectados cuentan como sanos', () => {
    expect(channelProblem(evo({ mode: 'CLOUD', lastLaggedInboundAt: ago(min(1)) }), now)).toBe(
      null,
    );
  });
});

describe('prueba de que el canal recibe (condición para anular una cita)', () => {
  const reminder = ago(min(270)); // 08:00

  it('hace falta un entrante a tiempo después del recordatorio', () => {
    expect(receivingSince(evo({ lastFreshInboundAt: ago(min(20)) }), reminder, now)).toBe(true);
    // 12/11: lo último que llegó a tiempo fue el día anterior.
    expect(receivingSince(evo({ lastFreshInboundAt: ago(min(1200)) }), reminder, now)).toBe(false);
    expect(receivingSince(evo({ lastFreshInboundAt: null }), reminder, now)).toBe(false);
  });

  it('un entrante con retraso desde el recordatorio lo invalida', () => {
    const row = evo({ lastFreshInboundAt: ago(min(10)), lastLaggedInboundAt: ago(min(200)) });
    expect(receivingSince(row, reminder, now)).toBe(false);
  });

  it('desconectado nunca da prueba de recepción', () => {
    expect(receivingSince(evo({ status: 'DISCONNECTED' }), reminder, now)).toBe(false);
    expect(receivingSince(null, reminder, now)).toBe(false);
  });

  it('Cloud API conectado basta', () => {
    expect(receivingSince(evo({ mode: 'CLOUD', lastFreshInboundAt: null }), reminder, now)).toBe(
      true,
    );
  });
});

describe('noche', () => {
  it('de 23:00 a 08:00 cruzando medianoche', () => {
    expect(isQuietMinute(22 * 60 + 59)).toBe(false);
    expect(isQuietMinute(23 * 60)).toBe(true);
    expect(isQuietMinute(4 * 60)).toBe(true);
    expect(isQuietMinute(7 * 60 + 59)).toBe(true);
    expect(isQuietMinute(8 * 60)).toBe(false);
  });
});
