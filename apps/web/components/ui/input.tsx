import { cn } from '@/lib/cn';
import * as React from 'react';

const fieldBase = [
  'w-full rounded-[14px] border border-[--color-border] bg-white text-sm text-zinc-900',
  'placeholder:text-zinc-400',
  'transition-[border-color,box-shadow,background-color] duration-300',
  'hover:border-brand-200',
  'focus-visible:outline-none focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-500/12',
  'disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-60',
].join(' ');

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(fieldBase, 'h-11 px-4', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldBase, 'min-h-[124px] p-4 leading-relaxed', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBase, 'h-11 cursor-pointer px-4', className)} {...props} />
));
Select.displayName = 'Select';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: <Label> is a generic primitive; consumers wire htmlFor or wrap input
  <label
    ref={ref}
    className={cn('text-[14px] font-semibold tracking-tight text-zinc-700', className)}
    {...props}
  />
));
Label.displayName = 'Label';

/** Campo con icono a la izquierda (buscadores, teléfono, email…). */
export const InputWithIcon = React.forwardRef<
  HTMLInputElement,
  InputProps & { icon: React.ReactNode; trailing?: React.ReactNode }
>(({ className, icon, trailing, ...props }, ref) => (
  <div className="relative">
    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors duration-300 peer-focus:text-brand-500">
      {icon}
    </span>
    <input
      ref={ref}
      className={cn(fieldBase, 'peer h-11 pl-11 pr-4', trailing && 'pr-12', className)}
      {...props}
    />
    {trailing && (
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">{trailing}</span>
    )}
  </div>
));
InputWithIcon.displayName = 'InputWithIcon';

/** Interruptor animado — reemplaza los checkboxes sueltos del panel de módulos. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20',
        checked
          ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] shadow-[0_4px_12px_-4px_rgba(55,118,106,0.7)]'
          : 'bg-zinc-200',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
