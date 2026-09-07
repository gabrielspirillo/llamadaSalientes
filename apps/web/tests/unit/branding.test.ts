import { describe, expect, it } from 'vitest';

import {
  ALLOWED_LOGO_MIMES,
  MAX_LOGO_BYTES,
  buildLogoPath,
  clinicNameSchema,
  normalizeMime,
} from '@/lib/branding';

const TENANT = 'f6c01830-6a8b-44e3-8cfb-38bee10a2b10';

describe('clinicNameSchema', () => {
  it('recorta los extremos y colapsa los espacios interiores', () => {
    // El nombre viaja a Clerk y se dibuja en el selector de organizaciones:
    // un doble espacio de un copiar-pegar canta ahí.
    const parsed = clinicNameSchema.parse('  Clínica   Dental  Ejemplo  ');
    expect(parsed).toBe('Clínica Dental Ejemplo');
  });

  it('rechaza un nombre que sólo son espacios', () => {
    // Sin el recorte previo esto pasaría por "tiene más de 2 caracteres".
    expect(clinicNameSchema.safeParse('    ').success).toBe(false);
  });

  it('rechaza nombres demasiado cortos o demasiado largos', () => {
    expect(clinicNameSchema.safeParse('A').success).toBe(false);
    expect(clinicNameSchema.safeParse('A'.repeat(81)).success).toBe(false);
    expect(clinicNameSchema.safeParse('A'.repeat(80)).success).toBe(true);
  });
});

describe('allowlist de logos', () => {
  it('no acepta SVG', () => {
    // Un SVG es HTML ejecutable y el logo se sirve desde un bucket público
    // y se pinta dentro del panel.
    expect(ALLOWED_LOGO_MIMES.has('image/svg+xml')).toBe(false);
  });

  it('acepta los formatos de imagen habituales', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']) {
      expect(ALLOWED_LOGO_MIMES.has(mime)).toBe(true);
    }
  });

  it('normaliza el mime que manda el navegador', () => {
    expect(normalizeMime('image/PNG; charset=binary')).toBe('image/png');
    expect(normalizeMime('')).toBe('application/octet-stream');
  });

  it('el tope son 2 MB', () => {
    expect(MAX_LOGO_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('buildLogoPath', () => {
  it('mete el logo bajo el prefijo del tenant', () => {
    const path = buildLogoPath(TENANT, 'image/png');
    expect(path.startsWith(`tenants/${TENANT}/branding/`)).toBe(true);
    expect(path.endsWith('.png')).toBe(true);
  });

  it('da una key distinta cada vez', () => {
    // El objeto se sirve con Cache-Control: reescribir la misma key dejaría el
    // logo anterior en el navegador hasta una hora después del cambio.
    expect(buildLogoPath(TENANT, 'image/png')).not.toBe(buildLogoPath(TENANT, 'image/png'));
  });

  it('cae a .bin con un mime que no está en la tabla', () => {
    expect(buildLogoPath(TENANT, 'application/octet-stream').endsWith('.bin')).toBe(true);
  });
});
