import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RichText } from '@/components/messaging/shared';

describe('RichText del chat interno', () => {
  // Regresión: negrita dentro de un mensaje dejaba el parser en bucle infinito
  // y /dashboard/messages colgaba el navegador.
  it('pinta negrita y cursiva anidadas sin colgarse', () => {
    const html = renderToStaticMarkup(
      <RichText text="Hola **negrita con _cursiva_** y `código` y https://futura.es" />,
    );
    expect(html).toContain('<strong');
    expect(html).toContain('<em');
    expect(html).toContain('<code');
  });
});
