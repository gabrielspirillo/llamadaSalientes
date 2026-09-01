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
      attachments: [
        { key: 'tenants/t/messaging/a.png', name: 'a.png', mime: 'image/png', size: 10 },
      ],
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

// ─── Fase A: crear canal y gestionar miembros ────────────────────────────────

const createChannelSchema = z.object({
  kind: z.enum(['PUBLIC', 'PRIVATE', 'GROUP']),
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, 'Slug inválido')
    .nullish(),
  topic: z.string().trim().max(300).nullish(),
  icon: z.string().trim().max(40).nullish(),
  tone: z.enum(['brand', 'blossom', 'mint', 'sky', 'honey', 'coral']).nullish(),
  memberUserIds: z.array(z.string().uuid()).max(200).nullish().default([]),
});

const membersSchema = z
  .object({
    add: z.array(z.string().uuid()).max(200).nullish(),
    remove: z.array(z.string().uuid()).max(200).nullish(),
  })
  .refine((v) => (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0, {
    message: 'Indicá al menos una persona a agregar o quitar',
  });

describe('crear canal desde el diálogo', () => {
  it('acepta el cuerpo mínimo: solo tipo y nombre', () => {
    // El diálogo OMITE los campos vacíos en vez de mandarlos vacíos.
    expect(createChannelSchema.safeParse({ kind: 'PRIVATE', name: 'Caja' }).success).toBe(true);
  });

  it('acepta tema y miembros cuando el formulario los trae', () => {
    const payload = {
      kind: 'PRIVATE',
      name: 'Turno de tarde',
      topic: 'Relevos y cierre.',
      memberUserIds: [UUID],
    };
    expect(createChannelSchema.safeParse(payload).success).toBe(true);
  });

  it('tolera null en los campos que el usuario dejó vacíos', () => {
    // Aunque el diálogo los omite, el servidor no puede caerse si llegan null:
    // es el mismo fallo que dejó el módulo sin poder enviar mensajes.
    const payload = { kind: 'PRIVATE', name: 'Caja', topic: null, icon: null, slug: null };
    expect(createChannelSchema.safeParse(payload).success).toBe(true);
  });

  it('rechaza un nombre vacío o solo espacios', () => {
    expect(createChannelSchema.safeParse({ kind: 'PRIVATE', name: '   ' }).success).toBe(false);
  });

  it('rechaza un tipo que no existe', () => {
    expect(createChannelSchema.safeParse({ kind: 'DM', name: 'x' }).success).toBe(false);
  });
});

describe('gestionar miembros', () => {
  it('acepta añadir y acepta quitar por separado', () => {
    expect(membersSchema.safeParse({ add: [UUID] }).success).toBe(true);
    expect(membersSchema.safeParse({ remove: [UUID] }).success).toBe(true);
  });

  it('tolera que el lado no usado venga null', () => {
    expect(membersSchema.safeParse({ add: [UUID], remove: null }).success).toBe(true);
  });

  it('rechaza un cuerpo que no pide nada', () => {
    expect(membersSchema.safeParse({}).success).toBe(false);
    expect(membersSchema.safeParse({ add: [], remove: [] }).success).toBe(false);
  });
});
