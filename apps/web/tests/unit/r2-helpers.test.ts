import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

describe('R2 helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('buildRecordingKey produce ruta tenant-scoped', async () => {
    const { buildRecordingKey } = await import('@/lib/r2/client');
    const key = buildRecordingKey('tenant-abc', 'call-123', 'mp3');
    expect(key).toBe('tenants/tenant-abc/calls/call-123.mp3');
  });

  it('buildRecordingKey usa "wav" como extensión por defecto', async () => {
    const { buildRecordingKey } = await import('@/lib/r2/client');
    expect(buildRecordingKey('t', 'c')).toBe('tenants/t/calls/c.wav');
  });

  it('fetchAsBuffer descarga URL y retorna buffer + content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: (k: string) => (k === 'content-type' ? 'audio/wav' : null) },
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchAsBuffer } = await import('@/lib/r2/client');
    const result = await fetchAsBuffer('https://retell-recordings.example/abc.wav');

    expect(fetchMock).toHaveBeenCalledWith('https://retell-recordings.example/abc.wav');
    expect(result.contentType).toBe('audio/wav');
    expect(result.buffer.length).toBe(8);
  });

  it('fetchAsBuffer tira si la respuesta no es ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchAsBuffer } = await import('@/lib/r2/client');
    await expect(fetchAsBuffer('https://x')).rejects.toThrow(/403/);
  });
});
