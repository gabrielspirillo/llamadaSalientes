import { describe, expect, it } from 'vitest';

import { cosineSimilarity } from '@/lib/rag/cosine';

describe('cosineSimilarity', () => {
  it('es 1 para vectores idénticos', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('es 0 para vectores ortogonales', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('es invariante a la escala', () => {
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1, 6);
  });

  it('ordena por similitud (más parecido = mayor)', () => {
    const q = [1, 0, 0];
    const cerca = cosineSimilarity(q, [0.9, 0.1, 0]);
    const lejos = cosineSimilarity(q, [0.1, 0.9, 0]);
    expect(cerca).toBeGreaterThan(lejos);
  });

  it('devuelve 0 ante vectores vacíos o de norma cero', () => {
    expect(cosineSimilarity([], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});
