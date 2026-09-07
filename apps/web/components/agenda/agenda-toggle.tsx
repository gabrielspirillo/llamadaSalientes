'use client';

import { setAgendaEnabledAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Switch } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * El interruptor de "habilitar la agenda" del profesional.
 *
 * Es optimista sobre el estado local para que no dé la sensación de estar
 * colgado, pero si el servidor lo rechaza (rol insuficiente, profesional de
 * otra clínica) vuelve atrás y enseña el motivo.
 */
export function AgendaEnabledToggle({
  professionalId,
  enabled,
  disabled,
}: {
  professionalId: string;
  enabled: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState(enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => setValue(enabled), [enabled]);

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={value}
        disabled={disabled || pending}
        label={value ? 'Agenda habilitada' : 'Agenda deshabilitada'}
        onCheckedChange={(next) => {
          setValue(next);
          setError(null);
          startTransition(async () => {
            const result = await setAgendaEnabledAction(professionalId, next);
            if (!result.ok) {
              setValue(!next);
              setError(result.error);
            } else {
              router.refresh();
            }
          });
        }}
      />
      <span className="text-[12px] text-zinc-500">{value ? 'Activa' : 'Apagada'}</span>
      {error && <span className="text-[12px] text-rose-600">{error}</span>}
    </div>
  );
}
