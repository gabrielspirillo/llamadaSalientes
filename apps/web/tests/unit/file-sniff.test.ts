import { describe, expect, it } from 'vitest';

import { contentMatchesMime, sniffMime } from '@/lib/file-sniff';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('sniffMime', () => {
  it('reconoce PDF, PNG, JPEG, GIF y WEBP por sus bytes', () => {
    expect(sniffMime(bytes('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(bytes('GIF89a.....'))).toBe('image/gif');
    expect(sniffMime(bytes('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(bytes('\0\0\0\x18ftypheic'))).toBe('image/heic');
  });

  it('un SVG o un ejecutable no es ningún tipo admitido', () => {
    expect(sniffMime(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>'))).toBeNull();
    expect(sniffMime(bytes('MZ not a pdf'))).toBeNull();
  });
});

describe('contentMatchesMime', () => {
  it('rechaza un SVG declarado como PNG', () => {
    expect(contentMatchesMime('image/png', bytes('<svg><script>alert(1)</script></svg>'))).toBe(
      false,
    );
  });

  it('acepta las variantes del mismo formato', () => {
    expect(contentMatchesMime('image/pjpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe(true);
    expect(contentMatchesMime('image/heif', bytes('\0\0\0\x18ftypmif1'))).toBe(true);
  });
});
