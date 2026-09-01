import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

const cardVariants = cva('relative rounded-[22px] transition-all duration-300', {
  variants: {
    tone: {
      /* Superficie base: blanca sobre canvas pastel */
      default: 'bg-white border border-[--color-border] shadow-[var(--shadow-soft)]',
      /* Vidrio esmerilado — para paneles sobre gradientes */
      glass: 'glass shadow-[var(--shadow-soft)]',
      /* Tarjetas pastel tipo tablero (referencia weihu) */
      grape: 'bg-[#f4f7f6] border border-[#cfe9dc]',
      blossom: 'bg-[#fdf0f7] border border-[#f9dcec]',
      mint: 'bg-[#e9f9f2] border border-[#cdf0e1]',
      sky: 'bg-[#e9f4fe] border border-[#d0e8fb]',
      honey: 'bg-[#fdf5e6] border border-[#f7e5c0]',
      coral: 'bg-[#fef0f2] border border-[#fbdbe1]',
      /* Panel oscuro para destacar un bloque hero */
      night:
        'bg-[linear-gradient(140deg,#171b1a_0%,#20302c_55%,#27403a_100%)] text-white border border-white/10 shadow-[var(--shadow-float)]',
      /* Sin fondo — sólo estructura */
      plain: 'bg-transparent',
    },
    interactive: {
      true: 'hover-lift cursor-pointer',
      false: '',
    },
  },
  defaultVariants: {
    tone: 'default',
    interactive: false,
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone, interactive, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ tone, interactive }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 p-5 pb-3 sm:p-6 sm:pb-4', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref as never}
      className={cn('text-[16px] font-semibold tracking-tight text-zinc-900', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-[14px] text-zinc-500', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'mt-4 flex items-center justify-between border-t border-[--color-border-subtle] p-5 pt-4 sm:p-6 sm:pt-4',
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

/**
 * Cabecera de tarjeta con icono en pastilla de color + acción a la derecha.
 * Unifica el patrón que se repetía a mano en casi todas las páginas.
 */
export function CardTopbar({
  icon,
  title,
  subtitle,
  action,
  tone = 'grape',
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'grape' | 'blossom' | 'mint' | 'sky' | 'honey' | 'coral' | 'zinc';
  className?: string;
}) {
  const tones: Record<string, string> = {
    grape: 'bg-brand-100 text-brand-600',
    blossom: 'bg-emerald-100 text-emerald-600',
    mint: 'bg-emerald-100 text-emerald-600',
    sky: 'bg-sky-100 text-sky-600',
    honey: 'bg-amber-100 text-amber-600',
    coral: 'bg-rose-100 text-rose-600',
    zinc: 'bg-zinc-100 text-zinc-600',
  };
  return (
    <div
      className={cn('flex items-start justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-4', className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span
            className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110',
              tones[tone],
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold tracking-tight text-zinc-900">
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 truncate text-[14px] text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
