import type postgres from 'postgres';

// OIDs de fecha/hora de Postgres: date, time, timestamp, timestamptz.
const DATE_OIDS = [1082, 1083, 1114, 1184];

/**
 * drizzle-orm/postgres-js pisa los serializers de fecha de postgres.js con la
 * identidad (`transparentParser`), porque sus columnas ya mandan strings.
 * Efecto colateral: un Date crudo interpolado en un sql`` llega sin convertir
 * hasta Buffer.byteLength() y tira "The string argument must be of type string
 * or an instance of Buffer... Received an instance of Date", que revienta el
 * render entero del Server Component.
 *
 * Restauramos la conversión Date → ISO dejando pasar los strings de drizzle.
 * Hay que llamarla DESPUÉS de drizzle(), que es quien los pisa.
 */
export function restoreDateSerializers(client: ReturnType<typeof postgres>) {
  for (const oid of DATE_OIDS) {
    client.options.serializers[oid] = (value: unknown) =>
      value instanceof Date ? value.toISOString() : value;
  }
}
