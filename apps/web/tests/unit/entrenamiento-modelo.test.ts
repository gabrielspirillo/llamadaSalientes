import { describe, expect, it } from 'vitest';

import {
  type LessonLine,
  formatLessonsForPrompt,
  parseProposals,
} from '@/lib/agent-training/model';

describe('formatLessonsForPrompt', () => {
  it('sin enseñanzas no añade nada al prompt', () => {
    expect(formatLessonsForPrompt([])).toBe('');
  });

  it('agrupa por tipo y antepone la situación', () => {
    const lessons: LessonLine[] = [
      {
        kind: 'ANSWER',
        title: 'Precio de implantes',
        situation: 'preguntan el precio de los implantes',
        instruction: 'No des la cifra: ofrece una primera valoración sin coste.',
      },
      {
        kind: 'BOUNDARY',
        title: 'Nada de garantías',
        situation: null,
        instruction: 'No prometas resultados ni plazos de curación.',
      },
    ];

    const out = formatLessonsForPrompt(lessons);
    expect(out).toContain('# Lo que te ha enseñado la clínica');
    expect(out).toContain('Qué responder:');
    expect(out).toContain('- Cuando preguntan el precio de los implantes: No des la cifra');
    expect(out).toContain('Lo que NO debes hacer ni decir:');
    expect(out).toContain('- No prometas resultados');
    // Un tipo sin enseñanzas no deja su encabezado suelto.
    expect(out).not.toContain('Tono y trato:');
  });

  it('deja claro que no manda sobre los datos oficiales', () => {
    const out = formatLessonsForPrompt([
      { kind: 'RULE', title: 'x', situation: null, instruction: 'Ofrece cita esta semana.' },
    ]);
    expect(out).toContain('OFICIALES (precios, horarios, agenda, tratamientos)');
    expect(out).toContain('"Reglas duras"');
    expect(out).toContain('manda lo oficial');
  });
});

describe('parseProposals', () => {
  it('descarta lo que no tiene instrucción y numera las refs', () => {
    const out = parseProposals(
      [
        { kind: 'RULE', title: 'Una', instruction: 'Ofrece valoración gratuita.' },
        { kind: 'RULE', title: 'Vacía', instruction: '   ' },
        { kind: 'ANSWER', title: 'Dos', instruction: 'Di que hay parking en la calle.' },
        'basura',
      ],
      'msg1',
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.ref).toBe('msg1-0');
    expect(out[1]?.ref).toBe('msg1-1');
  });

  it('un tipo inventado cae a RULE y el título largo se recorta', () => {
    const out = parseProposals(
      [{ kind: 'INVENTADO', title: 'T'.repeat(300), instruction: 'Haz esto siempre.' }],
      'm',
    );
    expect(out[0]?.kind).toBe('RULE');
    expect(out[0]?.title.length).toBeLessThanOrEqual(120);
  });

  it('sin título usa la instrucción, y normaliza los espacios', () => {
    const out = parseProposals([{ kind: 'STYLE', instruction: 'Habla   de\n  tú.' }], 'm');
    expect(out[0]?.title).toBe('Habla de tú.');
    expect(out[0]?.instruction).toBe('Habla de tú.');
  });

  it('nunca devuelve más de seis tarjetas en un turno', () => {
    const muchas = Array.from({ length: 12 }, (_, i) => ({
      kind: 'RULE',
      title: `T${i}`,
      instruction: `Instrucción número ${i}.`,
    }));
    expect(parseProposals(muchas, 'm')).toHaveLength(6);
  });

  it('lo que no es un array se ignora sin romper', () => {
    expect(parseProposals(undefined, 'm')).toEqual([]);
    expect(parseProposals({ lessons: [] }, 'm')).toEqual([]);
  });
});
