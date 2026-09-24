import { describe, expect, it } from 'vitest';

import { LESSON_KINDS } from '@/lib/agent-training/model';
import { QUESTS, levelFor, pendingQuests, questById } from '@/lib/agent-training/quests';

describe('catálogo de retos', () => {
  it('los ids son únicos: el único parcial de la 0039 depende de eso', () => {
    const ids = QUESTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada reto trae un tipo válido y una instrucción utilizable', () => {
    for (const q of QUESTS) {
      expect(LESSON_KINDS).toContain(q.kind);
      expect(q.instruction.length).toBeGreaterThan(20);
      expect(q.instruction.length).toBeLessThanOrEqual(800);
      expect(q.title.length).toBeLessThanOrEqual(120);
      expect(q.why.length).toBeGreaterThan(10);
    }
  });

  it('questById devuelve null para un id que no existe', () => {
    expect(questById('no-existe')).toBeNull();
    expect(questById('saludo-nombre')?.kind).toBe('STYLE');
  });
});

describe('pendingQuests', () => {
  it('no vuelve a recomendar lo ya aplicado', () => {
    const pendientes = pendingQuests(['saludo-nombre', 'precio-valoracion']);
    expect(pendientes.map((q) => q.id)).not.toContain('saludo-nombre');
    expect(pendientes.map((q) => q.id)).not.toContain('precio-valoracion');
    expect(pendientes).toHaveLength(QUESTS.length - 2);
  });

  it('conserva el orden del catálogo', () => {
    const pendientes = pendingQuests([]);
    expect(pendientes.map((q) => q.id)).toEqual(QUESTS.map((q) => q.id));
  });

  it('un id desconocido no descuadra nada', () => {
    expect(pendingQuests(['reto-de-otra-version'])).toHaveLength(QUESTS.length);
  });
});

describe('levelFor', () => {
  it('sin enseñanzas está en el primer nivel y la barra vacía', () => {
    const l = levelFor(0);
    expect(l.level).toBe(1);
    expect(l.progress).toBe(0);
    expect(l.nextAt).toBe(1);
  });

  it('el nivel sube con las enseñanzas activas', () => {
    expect(levelFor(1).level).toBe(2);
    expect(levelFor(3).level).toBe(3);
    expect(levelFor(6).level).toBe(4);
    expect(levelFor(10).level).toBe(5);
  });

  it('en el último nivel la barra se llena y no hay siguiente', () => {
    const l = levelFor(40);
    expect(l.nextAt).toBeNull();
    expect(l.progress).toBe(1);
  });

  it('la barra avanza dentro del nivel', () => {
    // Nivel 3 va de 3 a 6: con 4 enseñanzas está a un tercio.
    expect(levelFor(4).progress).toBeCloseTo(1 / 3, 5);
  });

  it('un número imposible no rompe la tarjeta', () => {
    expect(levelFor(-5).level).toBe(1);
    expect(levelFor(-5).progress).toBe(0);
  });
});
