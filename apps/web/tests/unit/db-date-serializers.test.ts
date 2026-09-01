import { restoreDateSerializers } from '@/lib/db/date-serializers';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

// OID de timestamptz: es el tipo que postgres.js infiere para cualquier Date.
const TIMESTAMPTZ = 1184;

// postgres() no abre la conexión hasta la primera query, así que el test es
// puramente unitario: solo nos interesa cómo quedan los serializers.
function makeClient() {
  return postgres('postgres://u:p@127.0.0.1:5432/db', { prepare: false });
}

// El tipo de options.serializers los declara opcionales por OID.
function serializeTimestamptz(client: ReturnType<typeof postgres>, value: unknown) {
  const serializer = client.options.serializers[TIMESTAMPTZ];
  if (!serializer) throw new Error('sin serializer para timestamptz');
  return serializer(value);
}

describe('serializers de fecha del cliente Postgres', () => {
  it('drizzle deja los Date sin serializar (regresión del crash del dashboard)', () => {
    const client = makeClient();
    drizzle(client);

    // Esto es lo que rompía: el Date llega crudo a Buffer.byteLength().
    expect(serializeTimestamptz(client, new Date())).toBeInstanceOf(Date);
  });

  it('restoreDateSerializers convierte Date → ISO', () => {
    const client = makeClient();
    drizzle(client);
    restoreDateSerializers(client);

    const date = new Date('2026-09-01T02:08:03.000Z');
    expect(serializeTimestamptz(client, date)).toBe('2026-09-01T02:08:03.000Z');
  });

  it('restoreDateSerializers deja pasar los strings que ya mapea drizzle', () => {
    const client = makeClient();
    drizzle(client);
    restoreDateSerializers(client);

    expect(serializeTimestamptz(client, '2026-09-01 02:08:03+00')).toBe('2026-09-01 02:08:03+00');
  });
});
