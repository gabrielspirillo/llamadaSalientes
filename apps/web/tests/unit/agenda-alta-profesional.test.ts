import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loQueFalta, pasosPara } from '@/components/agenda/professional-dialog';
import { buildTeamCandidates, nombreDesdeEmail } from '@/lib/agenda/team';

const BASE = {
  fullName: '',
  email: '',
  phone: '',
  specialty: '',
  licenseNumber: '',
  color: '#37766a',
  agendaEnabled: true,
  acceptsOnlineBooking: true,
  panelAccess: 'AGENDA_ONLY' as const,
  slotGranularityMinutes: 15,
  bufferMinutes: 0,
  minNoticeHours: 2,
  maxAdvanceDays: 90,
  linkUserEmail: '',
};

describe('pasos del alta', () => {
  it('el alta guía por los cinco pasos y la edición sólo por los suyos', () => {
    expect(pasosPara('alta')).toEqual(['persona', 'acceso', 'tratamientos', 'horario', 'huecos']);
    // Tratamientos y horario tienen su propio editor en la ficha: repetirlos
    // aquí daría dos sitios donde cambiar lo mismo.
    expect(pasosPara('edicion')).toEqual(['persona', 'acceso', 'huecos']);
  });

  it('no deja pasar del primer paso sin nombre', () => {
    expect(loQueFalta('persona', BASE)).toMatch(/nombre/i);
    expect(loQueFalta('persona', { ...BASE, fullName: 'Dra. Ruiz' })).toBeNull();
  });

  it('acepta el paso de acceso vacío, pero no un email a medias', () => {
    expect(loQueFalta('acceso', BASE)).toBeNull();
    expect(loQueFalta('acceso', { ...BASE, linkUserEmail: 'marta' })).toMatch(/no es válido/i);
    expect(loQueFalta('acceso', { ...BASE, linkUserEmail: 'marta@clinica.test' })).toBeNull();
  });

  it('los pasos sin validación propia dejan seguir', () => {
    expect(loQueFalta('tratamientos', BASE)).toBeNull();
    expect(loQueFalta('horario', BASE)).toBeNull();
    expect(loQueFalta('huecos', BASE)).toBeNull();
  });
});

describe('candidatos del equipo', () => {
  const members = [
    {
      clerkUserId: 'user_2',
      email: 'ivan.soler@clinica.test',
      firstName: 'Iván',
      lastName: 'Soler',
      role: 'member',
    },
    {
      clerkUserId: 'user_1',
      email: 'marta.ruiz@clinica.test',
      firstName: null,
      lastName: null,
      role: 'admin',
    },
    {
      clerkUserId: 'user_3',
      email: 'ana@clinica.test',
      firstName: 'Ana',
      lastName: 'Gil',
      role: 'member',
    },
  ];

  it('trae nombre, email y el teléfono principal de Clerk', () => {
    const out = buildTeamCandidates({
      members,
      clerkUsers: [
        {
          id: 'user_2',
          imageUrl: 'https://img/2',
          primaryPhoneNumberId: 'idp',
          phoneNumbers: [
            { id: 'otro', phoneNumber: '+34600000000' },
            { id: 'idp', phoneNumber: '+34611111111' },
          ],
        },
      ],
      professionalsByClerkUserId: new Map(),
    });

    const ivan = out.find((c) => c.clerkUserId === 'user_2');
    expect(ivan?.fullName).toBe('Iván Soler');
    expect(ivan?.phone).toBe('+34611111111'); // el principal, no el primero
    expect(ivan?.imageUrl).toBe('https://img/2');

    // Sin teléfono en Clerk no se inventa nada.
    expect(out.find((c) => c.clerkUserId === 'user_3')?.phone).toBeNull();
  });

  it('deduce el nombre del email cuando Clerk no lo tiene', () => {
    const out = buildTeamCandidates({
      members,
      clerkUsers: [],
      professionalsByClerkUserId: new Map(),
    });
    expect(out.find((c) => c.clerkUserId === 'user_1')?.fullName).toBe('Marta Ruiz');
    expect(nombreDesdeEmail('jose-luis@x.test')).toBe('Jose Luis');
    expect(nombreDesdeEmail('recepcion@x.test')).toBe('Recepcion');
  });

  it('marca a quien ya es profesional y lo manda al final de la lista', () => {
    const out = buildTeamCandidates({
      members,
      clerkUsers: [],
      professionalsByClerkUserId: new Map([['user_3', 'Dra. Ana Gil']]),
    });

    expect(out.map((c) => c.clerkUserId)).toEqual(['user_2', 'user_1', 'user_3']);
    const ana = out.find((c) => c.clerkUserId === 'user_3');
    expect(ana?.alreadyProfessional).toBe(true);
    expect(ana?.professionalName).toBe('Dra. Ana Gil');
    expect(out.find((c) => c.clerkUserId === 'user_1')?.alreadyProfessional).toBe(false);
  });
});
