import { cn } from '@/lib/cn';
import type { CSSProperties, ReactNode } from 'react';

export interface PatientFact {
  label: string;
  value: string;
  /** 'warn' pinta el valor en ámbar: "a tener en cuenta". */
  tone?: 'default' | 'warn' | 'muted';
  /** Ocupa las dos columnas en móvil. */
  wide?: boolean;
}

/**
 * La cabecera de la ficha: quién es, en una tarjeta, con los datos que se
 * miran antes de atender en una tira debajo (edad, nacimiento, tutores, cómo
 * fue la última sesión, qué tener en cuenta). Reemplaza al `PageHeader`
 * genérico: aquí el título es el paciente y los datos no son decoración.
 */
export function PatientHeader({
  eyebrow,
  icon,
  name,
  badges,
  action,
  facts,
}: {
  eyebrow: string;
  icon: ReactNode;
  name: string;
  badges?: ReactNode;
  action?: ReactNode;
  facts: PatientFact[];
}) {
  return (
    <section className="overflow-hidden rounded-[22px] border border-[--color-border] bg-white shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-3.5 p-4 md:px-6 md:py-5">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
          {icon}
        </span>
        <div className="min-w-[180px] flex-1">
          <p className="mb-0.5 hidden text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 md:block">
            {eyebrow}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-zinc-900 md:text-[26px]">
              {name}
            </h1>
            {badges}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {facts.length > 0 && (
        <dl
          className="grid grid-cols-2 gap-px border-t border-[--color-border-subtle] bg-[--color-border-subtle] md:[grid-template-columns:repeat(var(--facts),minmax(0,1fr))]"
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
              <dt className="text-[12px] text-zinc-500">{f.label}</dt>
              <dd
                className={cn(
                  'line-clamp-2 text-[15px] font-bold',
                  f.tone === 'warn'
                    ? 'text-amber-700'
                    : f.tone === 'muted'
                      ? 'font-semibold text-zinc-400'
                      : 'text-zinc-900',
                )}
                title={f.value}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
