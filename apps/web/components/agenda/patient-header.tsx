import { cn } from '@/lib/cn';
import { Baby } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export interface PatientFact {
  label: string;
  value: string;
  /** Segunda línea, más pequeña: la fecha de nacimiento bajo la edad. */
  sub?: string | null;
  /** El dato que se mira primero: va más grande. */
  emphasis?: boolean;
  tone?: 'default' | 'warn' | 'muted';
  /** Un enlace de acción al lado del valor ("Agendar"). */
  action?: ReactNode;
  /** Ocupa las dos columnas en móvil. */
  wide?: boolean;
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * La cabecera de la ficha: ruta de migas, avatar con iniciales, nombre,
 * badges, acciones rápidas (llamar, WhatsApp, agendar, editar) y una tira de
 * datos con jerarquía: la edad pesa más que la fecha de nacimiento.
 *
 * El icono de bebé ya no es el avatar: es una marca pequeña que dice
 * "paciente pediátrico" y sólo sale en las clínicas con perfil.
 */
export function PatientHeader({
  breadcrumb,
  initials,
  name,
  pediatric,
  badges,
  actions,
  facts,
  id,
}: {
  breadcrumb: Crumb[];
  initials: string;
  name: string;
  pediatric: boolean;
  badges?: ReactNode;
  actions?: ReactNode;
  facts: PatientFact[];
  /** Ancla para la barra compacta de las pestañas. */
  id?: string;
}) {
  return (
    <section
      id={id}
      className="overflow-hidden rounded-[22px] border border-(--color-border) bg-white shadow-[var(--shadow-soft)]"
    >
      <div className="flex flex-col gap-3 p-4 md:px-6 md:py-5">
        <nav
          aria-label="Ruta"
          className="flex flex-wrap items-center gap-1 text-[12px] text-zinc-600"
        >
          {breadcrumb.map((c, i) => {
            const last = i === breadcrumb.length - 1;
            return (
              <span key={c.label} className="inline-flex items-center gap-1">
                {i > 0 && (
                  <span aria-hidden className="text-zinc-400">
                    ›
                  </span>
                )}
                {c.href && !last ? (
                  <Link
                    href={c.href}
                    prefetch={false}
                    className="hover:text-brand-700 hover:underline"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    className={cn(last && 'font-semibold text-zinc-800')}
                    aria-current={last ? 'page' : undefined}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-3.5">
          <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#37766a,#5fa896)] text-[16px] font-bold text-white shadow-[0_8px_18px_-10px_rgba(55,118,106,0.8)]">
            {initials || '·'}
            {pediatric && (
              <span
                title="Paciente pediátrico"
                className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-brand-700 ring-2 ring-white"
              >
                <Baby className="h-3 w-3" aria-hidden />
                <span className="sr-only">Paciente pediátrico</span>
              </span>
            )}
          </span>
          <div className="min-w-[180px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-zinc-900 md:text-[26px]">
                {name}
              </h1>
              {badges}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>

      {facts.length > 0 && (
        <dl
          className="grid grid-cols-2 gap-px border-t border-(--color-border-subtle) bg-(--color-border-subtle) md:[grid-template-columns:repeat(var(--facts),minmax(0,1fr))]"
          style={{ '--facts': facts.length } as CSSProperties}
        >
          {facts.map((f) => (
            <div
              key={f.label}
              className={cn(
                'flex min-w-0 flex-col gap-[3px] bg-[#fbfcfc] px-4 py-3 md:px-5',
                f.wide && 'col-span-2 md:col-span-1',
              )}
            >
              <dt className="text-[12px] font-semibold text-zinc-600">{f.label}</dt>
              <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    'line-clamp-2',
                    f.emphasis
                      ? 'text-[20px] font-extrabold md:text-[22px]'
                      : 'text-[15px] font-bold',
                    f.tone === 'warn'
                      ? 'text-amber-700'
                      : f.tone === 'muted'
                        ? 'font-semibold text-zinc-500'
                        : 'text-zinc-900',
                  )}
                  title={f.value}
                >
                  {f.value}
                </span>
                {f.action}
              </dd>
              {f.sub && <dd className="text-[12px] text-zinc-500">{f.sub}</dd>}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
