import { titleBase, withUnread } from '@/lib/notifications/title';
import { describe, expect, it } from 'vitest';

describe('contador en el título de la pestaña', () => {
  it('pone y quita el contador', () => {
    expect(withUnread('Agenda | Futura', 3)).toBe('(3) Agenda | Futura');
    expect(withUnread('Agenda | Futura', 58)).toBe('(9+) Agenda | Futura');
    expect(withUnread('Agenda | Futura', 0)).toBe('Agenda | Futura');
    expect(titleBase('(9+) Agenda | Futura')).toBe('Agenda | Futura');
    expect(titleBase('(3)  Agenda | Futura ')).toBe('Agenda | Futura');
  });

  it('un título vacío o sólo con el contador no da base (no se escribe nada)', () => {
    expect(titleBase('')).toBe('');
    expect(titleBase('(9+)')).toBe('');
    expect(titleBase('(9+) ')).toBe('');
  });

  it('lo que se escribe es un punto fijo: leerlo y volver a aplicarlo no cambia nada', () => {
    // Simula el observador: escribe, el navegador normaliza, se vuelve a leer.
    for (const start of ['Ficha del paciente | Futura', '(2) Agenda | Futura', 'Agenda  ']) {
      for (const n of [0, 1, 9, 10, 58]) {
        document.title = withUnread(titleBase(start), n);
        const after = document.title;
        expect(withUnread(titleBase(after), n)).toBe(after);
      }
    }
  });

  it('el caso del 17/11: título vacío al navegar no entra en bucle', () => {
    document.title = '';
    let writes = 0;
    for (let i = 0; i < 50; i++) {
      const base = titleBase(document.title);
      if (!base) break;
      const next = withUnread(base, 58);
      if (document.title === next) break;
      document.title = next;
      writes++;
    }
    expect(writes).toBe(0);
  });
});
