/**
 * Tipo real de un archivo por sus primeros bytes. El MIME que manda el
 * navegador lo escribe el cliente: un SVG con <script> llamado .png pasaba por
 * imagen y acababa en el bucket público. Puro, para testearlo suelto.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  return null;
}

const FAMILY: Record<string, string> = {
  'image/pjpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/heif': 'image/heic',
};

/** Los bytes son de verdad del tipo declarado (variantes de un mismo formato incluidas). */
export function contentMatchesMime(declared: string, bytes: Uint8Array): boolean {
  const real = sniffMime(bytes);
  if (!real) return false;
  const want = FAMILY[declared] ?? declared;
  // Un HEIF puede llevar marca `mif1` y venir declarado como heic o heif.
  return (
    real === want || (want === 'image/heic' && real === 'image/avif' && declared === 'image/heif')
  );
}
