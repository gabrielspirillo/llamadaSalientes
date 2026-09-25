import {
  ContactsImportError,
  contactPhoneToE164,
  parseContactName,
  parseCsv,
  parseGoogleContacts,
  splitChildren,
} from '@/lib/patients/import-contacts';
import { describe, expect, it } from 'vitest';

const HEADER =
  'First Name,Middle Name,Last Name,Notes,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Phone 2 - Value,Phone 3 - Value';

function csv(...rows: string[]) {
  return [HEADER, ...rows].join('\n');
}

describe('CSV', () => {
  it('respeta comillas, comas y saltos de línea dentro de un campo', () => {
    const rows = parseCsv('a,b\n"x, y","línea 1\nlínea 2"\n"con ""comillas""",z\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'línea 1\nlínea 2'],
      ['con "comillas"', 'z'],
    ]);
  });

  it('quita el BOM y las líneas vacías', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('teléfono', () => {
  it('un móvil español de 9 cifras gana el +34', () => {
    expect(contactPhoneToE164('600 11 22 33')).toBe('+34600112233');
    expect(contactPhoneToE164('600-112-233')).toBe('+34600112233');
  });

  it('arregla el "22" que Google mete delante', () => {
    expect(contactPhoneToE164('226-001-12233')).toBe('+34600112233');
    expect(contactPhoneToE164('+3422600112233')).toBe('+34600112233');
  });

  it('respeta los internacionales y se queda con el primero', () => {
    expect(contactPhoneToE164('+41 77 000 00 00 ::: +34 600 11 22 33')).toBe('+41770000000');
  });

  it('lo que no es un teléfono da null', () => {
    expect(contactPhoneToE164('')).toBeNull();
    expect(contactPhoneToE164('12345')).toBeNull();
  });
});

describe('nombre del contacto', () => {
  it('rol, niño con apellidos y tutor', () => {
    expect(parseContactName('Mamá Lucas Pérez Gil (Ana)')).toMatchObject({
      role: 'MADRE',
      guardianName: 'Ana',
      children: [{ firstName: 'Lucas', lastName: 'Pérez Gil' }],
    });
  });

  it('ignora emojis y el número pegado al rol', () => {
    expect(parseContactName('⭐🤔Papa1 Leo Ruiz (Juan)')).toMatchObject({
      role: 'PADRE',
      guardianName: 'Juan',
      children: [{ firstName: 'Leo', lastName: 'Ruiz' }],
    });
  });

  it('hermanos con barra o "y" comparten apellidos', () => {
    expect(splitChildren('Sergio / Álvaro Peña Pascual')).toEqual([
      { firstName: 'Sergio', lastName: 'Peña Pascual' },
      { firstName: 'Álvaro', lastName: 'Peña Pascual' },
    ]);
    expect(splitChildren('Vera y Yulen Castro')).toEqual([
      { firstName: 'Vera', lastName: 'Castro' },
      { firstName: 'Yulen', lastName: 'Castro' },
    ]);
  });

  it('el tutor delante y el rol dentro del paréntesis', () => {
    expect(parseContactName('Jose Manuel (papá Nuño y Cayetana)')).toMatchObject({
      role: 'PADRE',
      guardianName: 'Jose Manuel',
      children: [
        { firstName: 'Nuño', lastName: '' },
        { firstName: 'Cayetana', lastName: '' },
      ],
    });
  });

  it('lo que va antes del rol se conserva aparte', () => {
    expect(parseContactName('Va a otra.. Mamá Eva Sanz (Rosa)')?.before).toBe('Va a otra');
  });

  it('sin mamá, papá, abuela… no es una familia', () => {
    expect(parseContactName('Extintores Toni')).toBeNull();
    // "Alobuela" contiene "abuela" pero no es la palabra.
    expect(parseContactName('Fontanero Alobuela')).toBeNull();
  });
});

describe('archivo completo', () => {
  it('marcas: 🤔 duda, cada 🚩 una bandera, 😡 o NO DAR bloquea', () => {
    const p = parseGoogleContacts(
      csv(
        ',,,,,Mobile,+34 600 000 001,,',
        '🤔🚩🚩Mamá Leo Ruiz (Ana),,,,,Mobile,+34 600 000 001,,',
        '😡NO DAR😡Papá Iker Gil (Luis),,,,,Mobile,600000002,,',
        'Revisión extintores,,,,,Work,+34 911 000 000,,',
      ),
    );
    expect(p.totalRows).toBe(4);
    expect(p.skipped.map((s) => s.row)).toEqual([2, 5]);
    const [leo, iker] = p.children;
    expect(leo).toMatchObject({ hesitant: true, priorRedFlags: 2, noBooking: false });
    expect(iker).toMatchObject({ hesitant: false, priorRedFlags: 0, noBooking: true });
    expect(iker?.guardian).toMatchObject({ role: 'PADRE', name: 'Luis', phone: '+34600000002' });
  });

  it('el nombre partido en tres columnas se junta; con paréntesis manda la primera', () => {
    const p = parseGoogleContacts(
      csv(
        'Mama Lluc,Surroca,(Montse),,,Mobile,600000003,,',
        'Papa Emma Luciana Rojas (Juan Carlos Rojas),Carlos,Rojas,,,Mobile,600000004,,',
      ),
    );
    expect(p.children.map((c) => [c.firstName, c.lastName, c.guardian.name])).toEqual([
      ['Lluc', 'Surroca', 'Montse'],
      ['Emma', 'Luciana Rojas', 'Juan Carlos Rojas'],
    ]);
  });

  it('el mismo niño dos veces con el mismo teléfono se fusiona', () => {
    const p = parseGoogleContacts(
      csv(
        'Mama Adda Roca (Vevi),,,,,Mobile,600000005,,',
        '🚩Mama Adda Roca (Vevi),,,,,Mobile,+34 600 000 005,,',
      ),
    );
    expect(p.children).toHaveLength(1);
    expect(p.children[0]?.priorRedFlags).toBe(1);
  });

  it('la nota guarda el nombre original y los otros teléfonos', () => {
    const p = parseGoogleContacts(
      csv('⭐Mamá Mia Paz (Eva),,,,,Mobile,600000006 ::: 600000007,611000000,'),
    );
    const notes = p.children[0]?.notes ?? '';
    expect(notes).toContain('«⭐Mamá Mia Paz (Eva)»');
    expect(notes).toContain('600000007');
    expect(notes).toContain('611000000');
  });

  it('un CSV que no es de Google Contactos se rechaza con un mensaje claro', () => {
    expect(() => parseGoogleContacts('nombre,telefono\nAna,600')).toThrow(ContactsImportError);
  });
});
