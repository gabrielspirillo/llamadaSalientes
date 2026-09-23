import { type WatchoutItem, formatWatchout } from '@/lib/care-profile/policy';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import Link from 'next/link';

/**
 * "A tener en cuenta", a ancho completo y sin recortes: cada alerta es un
 * chip (Asma · RGE · Ingresos) con su detalle. Es la información clínica que
 * más importa al atender, así que no va como una columna más de la tira de
 * datos donde se cortaba con puntos suspensivos.
 *
 * Con la anamnesis a medias, el banner también lo dice: es donde nacen las
 * alertas y no completarla es la forma más fácil de que falte una.
 */
export function PatientAlertsBanner({
  items,
  pendingAnamnesis = 0,
  anamnesisHref,
}: {
  items: WatchoutItem[];
  pendingAnamnesis?: number;
  anamnesisHref?: string;
}) {
  if (items.length === 0 && pendingAnamnesis === 0) return null;
  const hasAlerts = items.length > 0;
  return (
    <section
      aria-label="Alertas clínicas"
      className={
        hasAlerts
          ? 'flex flex-wrap items-start gap-3 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3'
          : 'flex flex-wrap items-start gap-3 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3'
      }
    >
      <span
        className={
          hasAlerts
            ? 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700'
            : 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700'
        }
      >
        {hasAlerts ? (
          <AlertTriangle className="h-4 w-4" aria-hidden />
        ) : (
          <ClipboardList className="h-4 w-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={
            hasAlerts
              ? 'text-[13px] font-bold text-rose-900'
              : 'text-[13px] font-bold text-amber-900'
          }
        >
          {hasAlerts ? 'A tener en cuenta' : 'Anamnesis sin completar'}
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {items.map((it) => (
            <li
              key={it.key}
              className="inline-flex max-w-full items-baseline gap-1 rounded-full bg-white px-2.5 py-1 text-[13px] font-semibold text-rose-900 ring-1 ring-rose-200"
              title={formatWatchout(it)}
            >
              <span>{it.label}</span>
              {it.detail && <span className="truncate font-medium text-rose-700">· {it.detail}</span>}
            </li>
          ))}
          {pendingAnamnesis > 0 && anamnesisHref && (
            <li>
              <Link
                href={anamnesisHref}
                prefetch={false}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400 bg-white px-2.5 py-1 text-[13px] font-semibold text-amber-800 hover:bg-amber-100"
              >
                Anamnesis: {pendingAnamnesis} sin contestar
                <span aria-hidden>→</span>
              </Link>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
