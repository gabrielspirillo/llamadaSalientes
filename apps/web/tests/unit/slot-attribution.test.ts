import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Evitar levantar el cliente de DB en el módulo bajo test.
vi.mock('@/lib/db/client', () => ({ db: {} }));

import {
  pickBestAttribution,
  type AttributionCandidate,
} from '@/lib/analytics/slot-attribution';

const ts = (offsetMin: number) => new Date(Date.UTC(2025, 0, 1, 12, 0, 0) + offsetMin * 60_000);
const reference = ts(0);

function cand(
  source: AttributionCandidate['source'],
  offsetMin: number,
): AttributionCandidate {
  return { source, timestamp: ts(offsetMin) };
}

describe('pickBestAttribution', () => {
  it('devuelve null si no hay candidatos', () => {
    expect(pickBestAttribution([], reference)).toBeNull();
  });

  it('elige el candidato más cercano temporalmente', () => {
    const winner = pickBestAttribution(
      [cand('inbound', -60), cand('whatsapp', -10), cand('outbound', -120)],
      reference,
    );
    expect(winner?.source).toBe('whatsapp');
  });

  it('mide distancia en valor absoluto (también hacia el futuro)', () => {
    const winner = pickBestAttribution(
      [cand('outbound', -30), cand('whatsapp', 5)],
      reference,
    );
    expect(winner?.source).toBe('whatsapp');
  });

  it('en empate temporal, prioriza outbound > whatsapp > inbound', () => {
    const outboundWins = pickBestAttribution(
      [cand('inbound', -15), cand('whatsapp', -15), cand('outbound', -15)],
      reference,
    );
    expect(outboundWins?.source).toBe('outbound');

    const whatsappWins = pickBestAttribution(
      [cand('inbound', -15), cand('whatsapp', -15)],
      reference,
    );
    expect(whatsappWins?.source).toBe('whatsapp');
  });

  it('devuelve el único candidato si solo hay uno', () => {
    const single = pickBestAttribution([cand('inbound', -200)], reference);
    expect(single?.source).toBe('inbound');
  });
});
