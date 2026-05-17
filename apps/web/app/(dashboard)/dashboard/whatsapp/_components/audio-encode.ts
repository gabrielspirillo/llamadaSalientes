// Encoder de MP3 client-side. Lo usamos porque WhatsApp NO acepta audio/webm
// (que es lo que produce MediaRecorder en Chrome/Edge por default). MP3 sí
// está aceptado por los 3 conectores (Cloud / Twilio / Evolution).
//
// Flujo: Blob webm → AudioContext.decodeAudioData → Float32Array PCM → Int16
// → lamejs.Mp3Encoder → Blob MP3.

import lamejs from '@breezystack/lamejs';

const SAMPLE_RATE_TARGET = 44100;
const KBPS = 128;

export async function encodeBlobToMp3(blob: Blob): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer();
  // AudioContext está disponible en navegadores modernos. Si no, el caller
  // debería detectar y mostrar error antes de llamar a esta función.
  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  const ctx = new AudioCtx();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    void ctx.close();
  }

  // Mono o estéreo (lamejs soporta ambos). Para mensajes de voz el típico es mono.
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate || SAMPLE_RATE_TARGET;
  const left = float32ToInt16(audioBuffer.getChannelData(0));
  const right =
    channels === 2 ? float32ToInt16(audioBuffer.getChannelData(1)) : undefined;

  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, KBPS);
  const blockSize = 1152; // tamaño de frame MP3 estándar
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const rightChunk = right ? right.subarray(i, i + blockSize) : undefined;
    const encoded = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const tail = mp3encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}

function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
