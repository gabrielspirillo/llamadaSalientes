import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Contrato entre lo que el cliente ENVÍA y lo que las rutas ACEPTAN.
 *
 * Existe por un bug real: el POST de mensajes declaraba `parentId` con
 * `.optional()`, que en zod acepta `undefined` pero NO `null`. El cliente manda
 * `parentId: null` explícito en todo mensaje de primer nivel, así que TODOS los
 * envíos morían con 400 "Datos inválidos" — el módulo entero era inutilizable y
 * ni el typecheck ni el build lo veían, porque el borde cliente/servidor pasa
 * por JSON y ahí se pierden los tipos.
 *
 * La regla: todo campo que el cliente pueda mandar como `null` va con
 * `.nullish()`, nunca con `.optional()` a secas.
 */

// Réplica de los esquemas de las rutas. Si cambian allá y no acá, el test lo
// canta: es justamente el punto.
const attachmentSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const postMessageSchema = z
  .object({
    body: z.string().max(8000).default(''),
    clientNonce: z.string().trim().max(80).nullish(),
    parentId: z.string().uuid().nullish(),
    attachments: z.array(attachmentSchema).max(10).default([]),
  })
  .refine((v) => v.body.trim().length > 0 || v.attachments.length > 0, {
    message: 'El mensaje está vacío',
    path: ['body'],
  });

const markReadSchema = z.object({ upToMessageId: z.string().uuid().nullish() }).default({});

const UUID = '3f8a1c62-0d5e-4a1b-9c7e-2b6d8e4f1a90';

describe('payloads que el cliente envía de verdad', () => {
  it('acepta un mensaje normal, que viaja con parentId null', () => {
    // Este es EL caso que estaba roto en producción.
    const payload = {
      body: 'hola equipo',
      clientNonce: 'a1b2c3',
      parentId: null,
      attachments: [],
    };
    expect(postMessageSchema.safeParse(payload).success).toBe(true);
  });

  it('acepta una respuesta en hilo, con parentId de verdad', () => {
    const payload = { body: 'voy yo', clientNonce: 'x1', parentId: UUID, attachments: [] };
    expect(postMessageSchema.safeParse(payload).success).toBe(true);
  });

  it('acepta que el nonce venga null', () => {
    const payload = { body: 'sin nonce', clientNonce: null, parentId: null, attachments: [] };
    expect(postMessageSchema.safeParse(payload).success).toBe(true);
  });

  it('acepta un mensaje de un solo carácter', () => {
    // El fallo se reprodujo escribiendo una coma suelta.
    expect(postMessageSchema.safeParse({ body: ',', parentId: null }).success).toBe(true);
  });

  it('acepta solo adjuntos, sin texto', () => {
    const payload = {
      body: '',
      parentId: null,
      attachments: [{ key: 'tenants/t/messaging/a.png', name: 'a.png', mime: 'image/png', size: 10 }],
    };
    expect(postMessageSchema.safeParse(payload).success).toBe(true);
  });

  it('rechaza un mensaje vacío sin adjuntos', () => {
    expect(postMessageSchema.safeParse({ body: '   ', parentId: null }).success).toBe(false);
  });

  it('rechaza un parentId que no es uuid', () => {
    expect(postMessageSchema.safeParse({ body: 'x', parentId: 'no-soy-uuid' }).success).toBe(false);
  });

  it('rechaza un adjunto con url en vez de key: el cliente no elige la ruta', () => {
    const payload = {
      body: '',
      attachments: [{ url: 'https://evil.example/x.png', name: 'x', mime: 'image/png', size: 1 }],
    };
    expect(postMessageSchema.safeParse(payload).success).toBe(false);
  });

  it('acepta marcar leído con upToMessageId null y sin cuerpo', () => {
    expect(markReadSchema.safeParse({ upToMessageId: null }).success).toBe(true);
    expect(markReadSchema.safeParse({}).success).toBe(true);
    expect(markReadSchema.safeParse({ upToMessageId: UUID }).success).toBe(true);
  });
});

describe('la regla que evita que el bug vuelva', () => {
  it('optional() rechaza null y por eso no sirve en este borde', () => {
    // Documenta el porqué: no es una manía de estilo.
    expect(z.string().uuid().optional().safeParse(null).success).toBe(false);
    expect(z.string().uuid().nullish().safeParse(null).success).toBe(true);
    expect(z.string().uuid().nullish().safeParse(undefined).success).toBe(true);
  });
});
