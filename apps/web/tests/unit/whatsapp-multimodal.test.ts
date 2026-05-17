import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock se hoistea al top del archivo; las variables top-level del test
// no están disponibles cuando corre la factory. vi.hoisted nos da un bag
// compartido que sí se hoistea junto con los mocks.
const mocks = vi.hoisted(() => ({
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  transcribeAudio: vi.fn(),
  describeImage: vi.fn(),
  describePdf: vi.fn(),
  supabaseUpload: vi.fn(async ({ path }: { path: string }) => ({
    path,
    publicUrl: `https://cdn.test/${path}`,
  })),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  db: {
    update: () => ({
      set: (patch: unknown) => {
        mocks.updateSet(patch);
        return { where: mocks.updateWhere };
      },
    }),
  },
}));

// Schema: el processor solo lo usa como "target" del update — placeholder OK.
vi.mock('@/lib/db/schema', () => ({
  whatsappMessages: { id: 'id-col' },
}));

vi.mock('@/lib/supabase/storage', () => ({
  buildWhatsappMediaPath: (tenantId: string, conversationId: string, ext: string) =>
    `tenants/${tenantId}/whatsapp/${conversationId}/mock.${ext}`,
  supabaseUpload: mocks.supabaseUpload,
}));

vi.mock('@/lib/whatsapp/agent/whisper', () => ({
  transcribeAudio: mocks.transcribeAudio,
}));
vi.mock('@/lib/whatsapp/agent/vision', () => ({
  describeImage: mocks.describeImage,
  describePdf: mocks.describePdf,
}));

import { processInboundMessages } from '@/lib/whatsapp/agent/multimodal';

type FakeMsg = {
  id: string;
  type:
    | 'TEXT'
    | 'AUDIO'
    | 'IMAGE'
    | 'PDF'
    | 'VIDEO'
    | 'STICKER'
    | 'LOCATION'
    | 'INTERACTIVE'
    | 'CONTACT'
    | 'TEMPLATE'
    | 'SYSTEM';
  contentText: string | null;
  externalId: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  transcription: string | null;
  rawJson: Record<string, unknown>;
  createdAt: Date;
};

function makeMsg(
  overrides: Partial<FakeMsg> & Pick<FakeMsg, 'id' | 'type' | 'createdAt'>,
): FakeMsg {
  return {
    contentText: null,
    externalId: null,
    mediaUrl: null,
    mediaType: null,
    transcription: null,
    rawJson: {},
    ...overrides,
  };
}

function makeConnector(downloadResult: { buffer: Buffer; mimeType: string } | Error) {
  const downloadMedia = vi.fn(async () => {
    if (downloadResult instanceof Error) throw downloadResult;
    return downloadResult;
  });
  return {
    downloadMedia,
    // Lo demás no se usa en estos tests, pero el type lo pide.
    channel: 'whatsapp_cloud' as const,
    sendText: vi.fn(),
    sendButtons: vi.fn(),
    sendList: vi.fn(),
    sendTemplate: vi.fn(),
    sendMedia: vi.fn(),
    sendTyping: vi.fn(),
  };
}

beforeEach(() => {
  mocks.updateSet.mockClear();
  mocks.updateWhere.mockClear();
  mocks.transcribeAudio.mockReset();
  mocks.describeImage.mockReset();
  mocks.describePdf.mockReset();
});

describe('processInboundMessages', () => {
  it('usa contentText tal cual para mensajes TEXT', async () => {
    const t0 = new Date('2026-05-17T20:00:00Z');
    const t2 = new Date('2026-05-17T20:00:02Z');
    const out = await processInboundMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      messages: [
        makeMsg({ id: 'm1', type: 'TEXT', contentText: 'Hola', createdAt: t0 }) as never,
        makeMsg({
          id: 'm2',
          type: 'TEXT',
          contentText: 'quiero turno',
          createdAt: t2,
        }) as never,
      ],
      connector: null,
    });

    expect(out.combinedText).toBe('[t+0s] Hola\n[t+2s] quiero turno');
    expect(out.summaries.map((s) => s.summary)).toEqual(['Hola', 'quiero turno']);
    // TEXT no toca DB ni LLM.
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it('audio sin cache: descarga, transcribe, persiste cache y devuelve summary', async () => {
    mocks.transcribeAudio.mockResolvedValue({
      text: 'Hola necesito turno',
      model: 'whisper-1',
      latencyMs: 123,
    });
    const connector = makeConnector({ buffer: Buffer.from('audio-bytes'), mimeType: 'audio/ogg' });

    const out = await processInboundMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      messages: [
        makeMsg({
          id: 'm1',
          type: 'AUDIO',
          createdAt: new Date(),
          rawJson: { audio: { id: 'media-123' } },
        }) as never,
      ],
      connector: connector as never,
    });

    expect(connector.downloadMedia).toHaveBeenCalledWith('media-123');
    expect(mocks.transcribeAudio).toHaveBeenCalledTimes(1);
    expect(out.combinedText).toBe('[t+0s] (audio) Hola necesito turno');
    // Persiste transcripción + mediaUrl (de la subida fake) en DB.
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: 'Hola necesito turno',
        mediaUrl: expect.stringMatching(/^https:\/\/cdn\.test\//),
      }),
    );
  });

  it('audio con cache (transcription seteada): no descarga ni llama Whisper', async () => {
    const connector = makeConnector(new Error('no debería llamarse'));

    const out = await processInboundMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      messages: [
        makeMsg({
          id: 'm1',
          type: 'AUDIO',
          createdAt: new Date(),
          transcription: 'cache hit',
          mediaUrl: 'https://cdn.test/cached.ogg',
          rawJson: { audio: { id: 'media-123' } },
        }) as never,
      ],
      connector: connector as never,
    });

    expect(connector.downloadMedia).not.toHaveBeenCalled();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(out.summaries[0]).toEqual(
      expect.objectContaining({
        summary: 'cache hit',
        model: 'cache',
        mediaUrl: expect.any(String),
      }),
    );
  });

  it('imagen con connector null: placeholder, sin DB ni LLM', async () => {
    const out = await processInboundMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      messages: [
        makeMsg({
          id: 'm1',
          type: 'IMAGE',
          createdAt: new Date(),
          rawJson: { image: { id: 'media-xyz' } },
        }) as never,
      ],
      connector: null,
    });

    expect(out.combinedText).toContain('(image)');
    expect(mocks.describeImage).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('PDF: extrae media id de raw_json.document.id y llama describePdf', async () => {
    mocks.describePdf.mockResolvedValue({
      text: 'Parte médico del paciente Juan',
      model: 'gemini-flash-latest',
      latencyMs: 800,
    });
    const connector = makeConnector({
      buffer: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
    });

    const out = await processInboundMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      messages: [
        makeMsg({
          id: 'm1',
          type: 'PDF',
          createdAt: new Date(),
          rawJson: { document: { id: 'doc-1' } },
        }) as never,
      ],
      connector: connector as never,
    });

    expect(connector.downloadMedia).toHaveBeenCalledWith('doc-1');
    expect(mocks.describePdf).toHaveBeenCalledTimes(1);
    expect(out.combinedText).toContain('(document) Parte médico del paciente Juan');
  });

  it('twilio: usa MediaUrl0 como mediaId al descargar', async () => {
    mocks.transcribeAudio.mockResolvedValue({ text: 'ok', model: 'whisper-1', latencyMs: 50 });
    const connector = makeConnector({ buffer: Buffer.from('a'), mimeType: 'audio/ogg' });

    await processInboundMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      messages: [
        makeMsg({
          id: 'm1',
          type: 'AUDIO',
          createdAt: new Date(),
          rawJson: { MediaUrl0: 'https://api.twilio.com/.../MEabc' },
        }) as never,
      ],
      connector: connector as never,
    });

    expect(connector.downloadMedia).toHaveBeenCalledWith('https://api.twilio.com/.../MEabc');
  });

  it('respeta orden cronológico y calcula offsets desde el primer mensaje', async () => {
    const t0 = new Date('2026-05-17T20:00:05Z');
    const t1 = new Date('2026-05-17T20:00:00Z'); // primero en orden cronológico
    const out = await processInboundMessages({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      messages: [
        makeMsg({ id: 'b', type: 'TEXT', contentText: 'segundo', createdAt: t0 }) as never,
        makeMsg({ id: 'a', type: 'TEXT', contentText: 'primero', createdAt: t1 }) as never,
      ],
      connector: null,
    });

    expect(out.combinedText).toBe('[t+0s] primero\n[t+5s] segundo');
  });
});
