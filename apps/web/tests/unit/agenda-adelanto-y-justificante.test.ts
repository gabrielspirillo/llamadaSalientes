import { describe, expect, it } from 'vitest';

import { renderAttendancePdf } from '@/lib/agenda/attendance-pdf';

describe('justificante de asistencia', () => {
  it('genera un PDF de una página con los datos de la cita', async () => {
    const bytes = await renderAttendancePdf({
      clinic: {
        name: 'Clínica Ejemplo',
        address: 'Calle Mayor 1, Madrid',
        taxId: 'B12345678',
        phone: null,
      },
      professionalName: 'Dra. Ejemplo',
      patientName: 'Peque Ejemplo',
      guardianName: 'Tutora Ejemplo',
      dateLong: 'miércoles, 4 de noviembre de 2026',
      startTime: '16:30',
      endTime: '17:00',
      issuedOn: '4 de noviembre de 2026',
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('no revienta con emojis o rarezas en los nombres', async () => {
    const bytes = await renderAttendancePdf({
      clinic: { name: 'Clínica 🌈', address: null, taxId: null, phone: null },
      professionalName: 'Dra. → Ejemplo',
      patientName: 'Peque “Ejemplo”',
      guardianName: null,
      dateLong: 'lunes, 2 de noviembre de 2026',
      startTime: '10:00',
      endTime: '10:45',
      issuedOn: '2 de noviembre de 2026',
      logo: null,
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
