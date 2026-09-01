import { cn } from '@/lib/cn';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

const buttonVariants = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold',
    'transition-[transform,box-shadow,background-color,border-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
    'disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97]',
    'select-none',
  ].join(' '),
  {
    variants: {
      variant: {
        /* Acción principal: gradiente violeta con halo y barrido de luz */
        primary:
          'sheen text-white bg-[linear-gradient(120deg,#37766a_0%,#479183_45%,#5fa896_100%)] shadow-[0_8px_24px_-10px_rgba(55,118,106,0.75)] hover:shadow-[0_16px_34px_-12px_rgba(55,118,106,0.8)] hover:-translate-y-0.5',
        /* Secundaria: superficie blanca con borde suave */
        secondary:
          'bg-white text-zinc-800 border border-[--color-border] shadow-[0_1px_2px_rgba(20,33,29,0.04)] hover:border-brand-200 hover:text-brand-700 hover:shadow-[0_10px_22px_-14px_rgba(20,33,29,0.45)] hover:-translate-y-0.5',
        /* Suave: pastel de marca, para acciones frecuentes no destructivas */
        soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 hover:-translate-y-0.5',
        ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-brand-700',
        outline:
          'border border-brand-200 text-brand-700 bg-transparent hover:bg-zinc-100 hover:border-brand-300',
        link: 'text-brand-700 underline-offset-4 hover:underline rounded-none p-0 h-auto shadow-none',
        danger:
          'sheen text-white bg-[linear-gradient(120deg,#f43f5e_0%,#fb7185_100%)] shadow-[0_8px_24px_-10px_rgba(244,63,94,0.7)] hover:-translate-y-0.5',
        success:
          'sheen text-white bg-[linear-gradient(120deg,#059669_0%,#10b981_100%)] shadow-[0_8px_24px_-10px_rgba(16,185,129,0.65)] hover:-translate-y-0.5',
        /* Vidrio: sobre fondos con color/imagen */
        glass:
          'glass text-zinc-800 hover:bg-white/90 shadow-[0_8px_24px_-14px_rgba(20,33,29,0.4)] hover:-translate-y-0.5',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs gap-1.5',
        sm: 'h-9 px-3.5 text-[13px]',
        md: 'h-11 px-5 text-sm',
        lg: 'h-12 px-7 text-[15px]',
        icon: 'h-10 w-10 p-0',
        'icon-sm': 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

/** Botón circular de icono con tooltip nativo — usado en cabeceras de tarjetas. */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ className, label, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      'inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400',
      'transition-all duration-300 hover:bg-zinc-100 hover:text-brand-600 hover:scale-110 active:scale-95',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
IconButton.displayName = 'IconButton';

export { buttonVariants };
