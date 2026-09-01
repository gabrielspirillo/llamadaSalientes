import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presenceKey, tenantChannel, typingKey, userChannel } from '@/lib/messaging/events';

// Estas cuatro funciones son el contrato de nombres entre procesos: la web
// publica y el worker escucha (y viceversa). Un cambio de formato NO rompe
// ningún tipo de TypeScript, rompe el runtime en producción y en silencio.
// Por eso los valores están escritos a mano acá: el test ES la especificación.

const ROOT = path.resolve(__dirname, '../..');

describe('claves de canal Redis', () => {
  it('userChannel', () => {
    expect(userChannel('u-1')).toBe('im:user:u-1');
  });

  it('tenantChannel', () => {
    expect(tenantChannel('t-1')).toBe('im:tenant:t-1');
  });

  it('typingKey', () => {
    expect(typingKey('c-1', 'u-1')).toBe('im:typing:c-1:u-1');
  });

  it('presenceKey', () => {
    expect(presenceKey('t-1', 'u-1')).toBe('im:presence:t-1:u-1');
  });

  it('todas viven bajo el prefijo im: para no chocar con las colas de BullMQ', () => {
    for (const key of [
      userChannel('x'),
      tenantChannel('x'),
      typingKey('x', 'y'),
      presenceKey('x', 'y'),
    ]) {
      expect(key.startsWith('im:')).toBe(true);
    }
  });

  it('los cuatro espacios de nombres son distintos entre sí', () => {
    const keys = [userChannel('a'), tenantChannel('a'), typingKey('a', 'b'), presenceKey('a', 'b')];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('el canal de usuario no colisiona con el de tenant para el mismo id', () => {
    expect(userChannel('same')).not.toBe(tenantChannel('same'));
  });

  it('son puras y estables: misma entrada, misma salida', () => {
    expect(userChannel('u-1')).toBe(userChannel('u-1'));
    expect(presenceKey('t', 'u')).toBe(presenceKey('t', 'u'));
  });

  it('typingKey y presenceKey no son simétricas (el orden de los ids importa)', () => {
    expect(typingKey('a', 'b')).not.toBe(typingKey('b', 'a'));
    expect(presenceKey('a', 'b')).not.toBe(presenceKey('b', 'a'));
  });
});

// ─── Contrato server ↔ cliente ──────────────────────────────────────────────
// El `kind` del payload se usa como nombre del `event:` de SSE (ver
// app/api/messages/stream/route.ts: `event: ${kind}`). Si el server emite un
// kind que el hook no escucha, el evento llega al navegador y se descarta sin
// error. Los tipos no lo detectan: `kind` es un string en el forward del SSE.

function kindsDeclaradosEnEvents(): Set<string> {
  const src = readFileSync(path.join(ROOT, 'lib/messaging/events.ts'), 'utf8');
  const kinds = new Set<string>();
  for (const m of src.matchAll(/kind:\s*'([a-z._]+)'/g)) kinds.add(m[1]!);
  return kinds;
}

function kindsEscuchadosPorElHook(): Set<string> {
  const src = readFileSync(path.join(ROOT, 'components/messaging/useMessagingStream.ts'), 'utf8');
  const kinds = new Set<string>();
  for (const m of src.matchAll(/bind\('([a-z._]+)'/g)) kinds.add(m[1]!);
  return kinds;
}

describe('ImRealtimeEvent ↔ useMessagingStream', () => {
  it('el archivo de eventos declara los kinds esperados', () => {
    const kinds = kindsDeclaradosEnEvents();
    expect([...kinds].sort()).toEqual([
      'channel.member_joined',
      'channel.member_left',
      'channel.updated',
      'mention.new',
      'message.deleted',
      'message.new',
      'message.updated',
      'presence.changed',
      'reaction.changed',
      'typing.start',
      'typing.stop',
      'unread.changed',
    ]);
  });

  it('el cliente escucha exactamente los kinds que el server puede emitir', () => {
    const server = kindsDeclaradosEnEvents();
    const cliente = kindsEscuchadosPorElHook();

    const sinEscuchar = [...server].filter((k) => !cliente.has(k)).sort();
    const escuchadosDeMas = [...cliente].filter((k) => !server.has(k)).sort();

    expect(sinEscuchar, 'kinds que el server emite y el cliente ignora').toEqual([]);
    expect(escuchadosDeMas, 'kinds que el cliente espera y nadie emite').toEqual([]);
  });

  it('el stream SSE usa el kind del payload como nombre de evento', () => {
    const src = readFileSync(path.join(ROOT, 'app/api/messages/stream/route.ts'), 'utf8');
    // Si esto cambia, el `bind(kind)` del hook deja de matchear.
    expect(src).toContain('event: ${kind}');
  });

  it('el stream SSE se suscribe al canal de usuario y al de tenant', () => {
    const src = readFileSync(path.join(ROOT, 'app/api/messages/stream/route.ts'), 'utf8');
    expect(src).toContain('userChannel(');
    expect(src).toContain('tenantChannel(');
  });
});
