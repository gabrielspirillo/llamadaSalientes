import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

/**
 * Convierte cualquier audio a OGG Opus mono 48kHz —
 * el formato que WhatsApp renderiza como nota de voz (PTT).
 */
export async function toVoiceNote(input: Buffer<ArrayBuffer>, inputMime: string): Promise<Buffer<ArrayBuffer>> {
  if (inputMime === 'audio/ogg' || inputMime === 'audio/ogg; codecs=opus' || inputMime === 'audio/ogg;codecs=opus') {
    return input;
  }

  const id = randomUUID();
  const ext = mimeToExt(inputMime);
  const inPath = join(tmpdir(), `voice-in-${id}.${ext}`);
  const outPath = join(tmpdir(), `voice-out-${id}.ogg`);

  try {
    await writeFile(inPath, input);
    await execFileAsync('ffmpeg', [
      '-i', inPath,
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ac', '1',
      '-ar', '48000',
      '-application', 'voip',
      '-y',
      outPath,
    ], { timeout: 30_000 });
    return await readFile(outPath);
  } finally {
    await Promise.allSettled([unlink(inPath), unlink(outPath)]);
  }
}

function mimeToExt(mime: string): string {
  const base = mime.split(';')[0]?.trim() ?? mime;
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
  };
  return map[base] ?? 'bin';
}
