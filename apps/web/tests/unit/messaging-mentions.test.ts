import { describe, expect, it } from 'vitest';

import {
  extractMentionTokens,
  mentionKeysFor,
  normalizeMentionKey,
  stripCodeSpans,
} from '@/lib/messaging/mentions';

// Parseo de @menciones. Todo lo que se prueba acá es PURO: no toca la base, no
// necesita Redis y no depende de Clerk. Es la capa que decide a quién le suena
// el teléfono, así que un falso positivo se paga en notificaciones a media
// clínica y un falso negativo en un aviso que nadie ve.

describe('normalizeMentionKey', () => {
  it('baja a minúsculas y saca acentos', () => {
    expect(normalizeMentionKey('María')).toBe('maria');
    expect(normalizeMentionKey('PÉREZ')).toBe('perez');
    expect(normalizeMentionKey('Ñoño')).toBe('nono');
  });

  it('recorta espacios de los bordes pero conserva los internos', () => {
    expect(normalizeMentionKey('  Ana Gómez  ')).toBe('ana gómez'.normalize('NFD').replace(/\p{M}+/gu, ''));
    expect(normalizeMentionKey('  Ana Gómez  ')).toBe('ana gomez');
  });

  it('devuelve cadena vacía para entrada vacía', () => {
    expect(normalizeMentionKey('')).toBe('');
    expect(normalizeMentionKey('   ')).toBe('');
  });
});

describe('stripCodeSpans', () => {
  it('deja intacto un texto sin código', () => {
    const body = 'Hola @ana, ¿podés mirar la agenda de mañana?';
    expect(stripCodeSpans(body)).toBe(body);
  });

  it('quita tramos en línea con backticks', () => {
    const out = stripCodeSpans('usá `npm run @todos` y listo');
    expect(out).not.toContain('@todos');
    expect(out).toContain('usá');
    expect(out).toContain('y listo');
  });

  it('quita bloques cerrados de varias líneas', () => {
    const out = stripCodeSpans('antes\n```\nconst x = 1; // @ana\nmás @bea\n```\ndespués');
    expect(out).not.toContain('@ana');
    expect(out).not.toContain('@bea');
    expect(out).toContain('antes');
    expect(out).toContain('después');
  });

  it('quita un bloque abierto sin cerrar hasta el final del cuerpo', () => {
    const out = stripCodeSpans('mirá esto\n```js\nfoo(@ana)\ntodavía dentro @bea');
    expect(out).not.toContain('@ana');
    expect(out).not.toContain('@bea');
    expect(out).toContain('mirá esto');
  });

  it('con un backtick abierto borra hasta el fin de LÍNEA, no del cuerpo', () => {
    const out = stripCodeSpans('valor ` roto @ana\nlínea nueva @bea');
    expect(out).not.toContain('@ana');
    // La segunda línea sobrevive: sólo se come la línea del backtick huérfano.
    expect(out).toContain('@bea');
  });

  it('maneja varios tramos en línea en la misma frase', () => {
    const out = stripCodeSpans('`a @uno` texto `b @dos` fin');
    expect(out).not.toContain('@uno');
    expect(out).not.toContain('@dos');
    expect(out).toContain('texto');
    expect(out).toContain('fin');
  });
});

describe('extractMentionTokens', () => {
  it('extrae una mención simple al principio', () => {
    expect(extractMentionTokens('@ana revisá esto')).toEqual({
      tokens: ['ana'],
      everyone: false,
    });
  });

  it('extrae varias menciones y respeta el orden de aparición', () => {
    const { tokens } = extractMentionTokens('ping @bea y @ana por el hueco');
    expect(tokens).toEqual(['bea', 'ana']);
  });

  it('deduplica el mismo nombre escrito distinto', () => {
    const { tokens } = extractMentionTokens('@Ana ojo, @ana, de nuevo @ANA');
    expect(tokens).toEqual(['ana']);
  });

  it('normaliza acentos: @María y @maria son la misma clave', () => {
    expect(extractMentionTokens('@María').tokens).toEqual(['maria']);
    expect(extractMentionTokens('@María y @maria').tokens).toEqual(['maria']);
  });

  it('recorta la puntuación pegada al final', () => {
    expect(extractMentionTokens('gracias @ana,').tokens).toEqual(['ana']);
    expect(extractMentionTokens('gracias @ana.').tokens).toEqual(['ana']);
    expect(extractMentionTokens('gracias @ana!').tokens).toEqual(['ana']);
    expect(extractMentionTokens('(@ana)').tokens).toEqual(['ana']);
    expect(extractMentionTokens('@ana: mirá').tokens).toEqual(['ana']);
  });

  it('conserva los puntos internos (mención por local part del email)', () => {
    expect(extractMentionTokens('@maria.perez mirá').tokens).toEqual(['maria.perez']);
  });

  it('NO confunde un email con una mención', () => {
    expect(extractMentionTokens('escribile a ana@clinica.com')).toEqual({
      tokens: [],
      everyone: false,
    });
    expect(extractMentionTokens('ana@clinica.com dijo que sí')).toEqual({
      tokens: [],
      everyone: false,
    });
  });

  it('detecta los alias de canal completo', () => {
    for (const alias of ['todos', 'todas', 'canal', 'equipo', 'everyone', 'channel', 'all', 'here', 'aqui']) {
      const res = extractMentionTokens(`@${alias} reunión a las 9`);
      expect(res.everyone, alias).toBe(true);
      expect(res.tokens, alias).toEqual([]);
    }
  });

  it('@todos con acento normalizado también cuenta como canal completo', () => {
    expect(extractMentionTokens('@aquí hay lío').everyone).toBe(true);
  });

  it('mezcla mención a persona y a canal', () => {
    expect(extractMentionTokens('@todos ojo, @ana lo cubre')).toEqual({
      tokens: ['ana'],
      everyone: true,
    });
  });

  it('NO cuenta menciones dentro de un tramo en línea', () => {
    expect(extractMentionTokens('el decorador `@ana` es de la librería')).toEqual({
      tokens: [],
      everyone: false,
    });
  });

  it('NO cuenta menciones dentro de un bloque de código', () => {
    const body = 'stack trace:\n```\nat @ana.handler\n@todos\n```\nnada más';
    expect(extractMentionTokens(body)).toEqual({ tokens: [], everyone: false });
  });

  it('sí cuenta la mención que está FUERA del bloque de código', () => {
    const body = '@bea mirá esto\n```\n@ana\n```';
    expect(extractMentionTokens(body)).toEqual({ tokens: ['bea'], everyone: false });
  });

  it('tolera cuerpo vacío, nulo o sin arrobas', () => {
    expect(extractMentionTokens('')).toEqual({ tokens: [], everyone: false });
    expect(extractMentionTokens(undefined as unknown as string)).toEqual({
      tokens: [],
      everyone: false,
    });
    expect(extractMentionTokens('sin menciones acá')).toEqual({
      tokens: [],
      everyone: false,
    });
  });

  it('ignora una arroba suelta o seguida de símbolo', () => {
    expect(extractMentionTokens('mandá un @ y ya')).toEqual({ tokens: [], everyone: false });
    expect(extractMentionTokens('@@ana')).toEqual({ tokens: [], everyone: false });
    expect(extractMentionTokens('@ -1')).toEqual({ tokens: [], everyone: false });
  });

  it('acepta menciones con guiones, guiones bajos y números', () => {
    expect(extractMentionTokens('@ana-lopez').tokens).toEqual(['ana-lopez']);
    expect(extractMentionTokens('@ana_lopez').tokens).toEqual(['ana_lopez']);
    expect(extractMentionTokens('@sala2').tokens).toEqual(['sala2']);
  });

  // Compromiso deliberado del parser: la arroba tiene que ABRIR palabra, y eso
  // es lo que impide que `ana@clinica.com` dispare una mención. El precio es que
  // en `@ana@bea` la segunda no se detecta. Se documenta para que un cambio del
  // regex sea una decisión y no un accidente.
  it('dos menciones pegadas sin separador: sólo cuenta la primera', () => {
    expect(extractMentionTokens('@ana@bea')).toEqual({ tokens: ['ana'], everyone: false });
    expect(extractMentionTokens('@ana@todos')).toEqual({ tokens: ['ana'], everyone: false });
    // Con cualquier separador no alfanumérico sí salen las dos.
    expect(extractMentionTokens('@ana/@bea').tokens).toEqual(['ana', 'bea']);
  });

  it('la sintaxis de negrita de markdown no estorba', () => {
    expect(extractMentionTokens('**@ana**').tokens).toEqual(['ana']);
    expect(extractMentionTokens('hola *@ana*').tokens).toEqual(['ana']);
  });

  it('mención al arrancar una línea intermedia', () => {
    expect(extractMentionTokens('primera línea\n@ana segunda').tokens).toEqual(['ana']);
  });
});

describe('mentionKeysFor', () => {
  it('genera nombre junto, palabras sueltas y local part del email', () => {
    const keys = mentionKeysFor({ name: 'María Pérez', email: 'maria.perez@clinica.com' });
    expect(keys).toContain('mariaperez');
    expect(keys).toContain('maria');
    expect(keys).toContain('perez');
    expect(keys).toContain('maria.perez');
  });

  it('normaliza acentos y mayúsculas en todas las claves', () => {
    const keys = mentionKeysFor({ name: 'JOSÉ Ángel', email: 'JOSE@Clinica.com' });
    for (const k of keys) expect(k).toBe(k.toLowerCase());
    expect(keys).toContain('jose');
    expect(keys).toContain('angel');
    expect(keys).toContain('joseangel');
  });

  it('no repite claves', () => {
    const keys = mentionKeysFor({ name: 'ana', email: 'ana@clinica.com' });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('descarta fragmentos de una sola letra del email', () => {
    const keys = mentionKeysFor({ name: '', email: 'a.lopez@clinica.com' });
    expect(keys).not.toContain('a');
    expect(keys).toContain('lopez');
    expect(keys).toContain('alopez');
    expect(keys).toContain('a.lopez');
  });

  it('sobrevive a nombre o email vacíos', () => {
    expect(mentionKeysFor({ name: '', email: '' })).toEqual([]);
    expect(
      mentionKeysFor({ name: null as unknown as string, email: null as unknown as string }),
    ).toEqual([]);
  });

  it('las claves generadas son alcanzables por el parser', () => {
    // Contrato entre las dos mitades: si `mentionKeysFor` produce una clave,
    // escribir `@esa-clave` tiene que resolver a esa persona.
    const keys = mentionKeysFor({ name: 'María Pérez', email: 'maria.perez@clinica.com' });
    for (const key of keys) {
      const { tokens } = extractMentionTokens(`hola @${key} qué tal`);
      // Las claves con espacio no son escribibles; el resto sí.
      if (key.includes(' ')) continue;
      expect(tokens, key).toContain(key);
    }
  });
});
