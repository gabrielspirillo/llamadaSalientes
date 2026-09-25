import { Badge } from '@/components/ui/badge';
import {
  type RedFlagCounts,
  describeRedFlags,
  redFlagLevel,
  totalRedFlags,
} from '@/lib/care-profile/signals';
import { cn } from '@/lib/cn';
import { CircleHelp, Flag } from 'lucide-react';

/**
 * Las señales de conducta del paciente, en tres tamaños: la cabecera de la
 * ficha (`md`), la lista de pacientes (`sm`) y el chip del calendario (`xs`,
 * sólo iconos). Sin caritas: una bandera roja con el número de faltas y
 * cancelaciones, y un interrogante para la familia que duda. Nunca sólo
 * color: cada una lleva icono, número o texto, y el desglose en el `title`.
 */
export function PatientSignalBadges({
  redFlags,
  hesitant,
  hesitantNote,
  size = 'md',
  className,
}: {
  redFlags: RedFlagCounts;
  hesitant: boolean;
  hesitantNote?: string | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const total = totalRedFlags(redFlags);
  if (total === 0 && !hesitant) return null;

  const flagsTitle = `${total} ${total === 1 ? 'bandera roja' : 'banderas rojas'}: ${describeRedFlags(redFlags)}`;
  const hesitantTitle = hesitantNote
    ? `Familia que duda: ${hesitantNote}`
    : 'Familia que duda: pregunta y tarda en coger cita';

  if (size === 'xs') {
    return (
      <span className={cn('inline-flex items-center gap-1 align-middle', className)}>
        {total > 0 && (
          <span
            title={flagsTitle}
            className={cn(
              'inline-flex items-center gap-px rounded px-0.5 text-[10px] font-extrabold leading-none',
              redFlagLevel(total) === 'HIGH' ? 'bg-rose-600 text-white' : 'text-rose-600',
            )}
          >
            <Flag className="h-2.5 w-2.5 fill-current" aria-hidden />
            {total}
            <span className="sr-only">{flagsTitle}</span>
          </span>
        )}
        {hesitant && (
          <span title={hesitantTitle} className="inline-flex text-sky-600">
            <CircleHelp className="h-3 w-3" aria-hidden />
            <span className="sr-only">{hesitantTitle}</span>
          </span>
        )}
      </span>
    );
  }

  const level = redFlagLevel(total);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {total > 0 && (
        <Badge
          tone="danger"
          size={size === 'sm' ? 'sm' : 'md'}
          title={flagsTitle}
          className={cn(level === 'HIGH' && 'bg-rose-600 text-white')}
        >
          <RedFlagIcons total={total} withCount={size !== 'md'} />
          {size === 'md' && `${total} ${total === 1 ? 'bandera roja' : 'banderas rojas'}`}
          <span className="sr-only">{describeRedFlags(redFlags)}</span>
        </Badge>
      )}
      {hesitant && (
        <Badge tone="info" size={size === 'sm' ? 'sm' : 'md'} title={hesitantTitle}>
          <CircleHelp className="h-3 w-3" aria-hidden />
          Duda
        </Badge>
      )}
    </span>
  );
}

/**
 * Una bandera por falta o cancelación, como las ponía la clínica. A partir de
 * cuatro ya no se cuentan a ojo: una sola bandera y "×5".
 */
const FLAG_SLOTS = ['a', 'b', 'c'] as const;

function RedFlagIcons({ total, withCount }: { total: number; withCount: boolean }) {
  if (total > 3) {
    return (
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        <Flag className="h-3 w-3 fill-current" />
        {withCount && `×${total}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center" aria-hidden>
      {FLAG_SLOTS.slice(0, total).map((slot, i) => (
        <Flag key={slot} className={cn('h-3 w-3 fill-current', i > 0 && '-ml-1')} />
      ))}
    </span>
  );
}
