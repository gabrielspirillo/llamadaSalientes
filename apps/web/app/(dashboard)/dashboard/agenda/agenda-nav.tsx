import { SegmentedNav } from '@/components/ui/tabs';

/**
 * Pestañas del módulo. La de Profesionales sólo la ve quien puede configurar
 * agendas: a un médico con acceso restringido no se le enseña una pestaña que
 * el servidor le va a negar igualmente.
 */
export function AgendaNav({
  active,
  ctx,
}: {
  active: 'calendario' | 'profesionales' | 'pacientes';
  ctx: { canManageProfessionals: boolean };
}) {
  const items = [
    { value: 'calendario', label: 'Calendario', href: '/dashboard/agenda' },
    { value: 'pacientes', label: 'Pacientes', href: '/dashboard/agenda/pacientes' },
    ...(ctx.canManageProfessionals
      ? [
          {
            value: 'profesionales',
            label: 'Profesionales',
            href: '/dashboard/agenda/profesionales',
          },
        ]
      : []),
  ];

  return <SegmentedNav items={items} activeValue={active} />;
}
