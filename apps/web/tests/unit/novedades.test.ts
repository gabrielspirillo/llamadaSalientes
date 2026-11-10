import { describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENTS,
  type Announcement,
  SNOOZE_HOURS,
  matchesPath,
  pendingAnnouncements,
  snoozeUntil,
} from '@/lib/announcements/catalog';

const base: Announcement = {
  id: 'a1',
  publishedAt: '2026-11-01T00:00:00Z',
  audience: 'all',
  eyebrow: 'Novedad',
  title: 'T',
  body: 'B',
};
const now = new Date('2026-11-10T12:00:00Z');

describe('novedades del panel', () => {
  it('sale si nadie lo vio', () => {
    expect(pendingAnnouncements([base], { hasCareProfile: false, now }, [])).toHaveLength(1);
  });
  it('"Entendido" no vuelve a salir', () => {
    const r = pendingAnnouncements([base], { hasCareProfile: false, now }, [
      { announcementId: 'a1', status: 'DISMISSED', snoozeUntil: null },
    ]);
    expect(r).toHaveLength(0);
  });
  it('"Recordar más tarde" vuelve pasado el plazo', () => {
    const until = snoozeUntil(now);
    const st = [{ announcementId: 'a1', status: 'SNOOZED' as const, snoozeUntil: until }];
    expect(pendingAnnouncements([base], { hasCareProfile: false, now }, st)).toHaveLength(0);
    const later = new Date(now.getTime() + SNOOZE_HOURS * 3_600_000 + 1);
    expect(pendingAnnouncements([base], { hasCareProfile: false, now: later }, st)).toHaveLength(1);
  });
  it('respeta publicación, caducidad y público', () => {
    expect(
      pendingAnnouncements(
        [{ ...base, publishedAt: '2026-12-01T00:00:00Z' }],
        { hasCareProfile: true, now },
        [],
      ),
    ).toHaveLength(0);
    expect(
      pendingAnnouncements(
        [{ ...base, expiresAt: '2026-11-05T00:00:00Z' }],
        { hasCareProfile: true, now },
        [],
      ),
    ).toHaveLength(0);
    expect(
      pendingAnnouncements(
        [{ ...base, audience: 'care_profile' }],
        { hasCareProfile: false, now },
        [],
      ),
    ).toHaveLength(0);
  });
  it('sale sólo en sus rutas', () => {
    const a = { paths: ['/dashboard/agenda'] };
    expect(matchesPath(a, '/dashboard/agenda')).toBe(true);
    expect(matchesPath(a, '/dashboard/agenda/pacientes/pat:1')).toBe(true);
    expect(matchesPath(a, '/dashboard/agendas')).toBe(false);
    expect(matchesPath({}, '/dashboard/tasks')).toBe(true);
  });
  it('los ids del catálogo no se repiten', () => {
    const ids = ANNOUNCEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
