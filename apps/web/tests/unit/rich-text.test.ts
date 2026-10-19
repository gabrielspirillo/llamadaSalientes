import { describe, expect, it } from 'vitest';

import { isRich, parseRich, richToPlain, sanitizeRich } from '@/lib/rich-text';

describe('texto con formato de la historia clínica', () => {
  it('conserva negrita, color, resaltado y listas', () => {
    const v =
      '<b>Tos</b> y <span data-c="red">fiebre 39</span> <mark>ojo</mark><ul><li>uno</li></ul>';
    expect(sanitizeRich(v)).toBe(v);
    expect(isRich(v)).toBe(true);
  });

  it('nunca deja pasar otras etiquetas ni atributos', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(1)</script><b onclick="x">hola</b>';
    const clean = sanitizeRich(evil);
    expect(clean).not.toMatch(/<img|<script|<b onclick/i);
    expect(clean).toContain('&lt;img');
    expect(parseRich(evil).some((n) => n.type === 'b')).toBe(false);
  });

  it('las notas viejas en texto llano se leen igual', () => {
    expect(richToPlain('SatO2 < 95 & FR 40')).toBe('SatO2 < 95 & FR 40');
    expect(isRich('SatO2 < 95')).toBe(false);
    expect(sanitizeRich('SatO2 < 95')).toBe('SatO2 &lt; 95');
    expect(richToPlain(sanitizeRich('SatO2 < 95'))).toBe('SatO2 < 95');
  });

  it('a texto plano para los asistentes', () => {
    expect(richToPlain('<b>Nueva sesión</b> en <span data-c="red">48 h</span><br>lavados')).toBe(
      'Nueva sesión en 48 h\nlavados',
    );
    expect(richToPlain('<ul><li>uno</li><li>dos</li></ul>')).toBe('- uno\n- dos');
  });

  it('tolera etiquetas sin cerrar', () => {
    expect(richToPlain('<b>abierta')).toBe('abierta');
    expect(sanitizeRich('<b>abierta')).toBe('<b>abierta</b>');
  });
});
