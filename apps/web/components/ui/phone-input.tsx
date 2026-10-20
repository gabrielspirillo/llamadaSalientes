'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { withDialPrefix, withoutDialPrefix } from '@/lib/phone-prefix';
import type * as React from 'react';

/**
 * Teléfono con el prefijo del país de la clínica ya puesto ("+34"): se teclean
 * sólo los nueve dígitos. Quien escriba otro prefijo ("+33…") lo puede hacer,
 * y entonces el "+34" desaparece. `value` y `onChange` trabajan con el número
 * completo, así que el resto del formulario no se entera.
 */
export function PhoneInput({
  value,
  onChange,
  dialPrefix: prefix,
  className,
  ...rest
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type' | 'prefix'> & {
  value: string;
  onChange: (value: string) => void;
  /** "+34". Null = sin prefijo (el campo se comporta como uno normal). */
  dialPrefix: string | null;
}) {
  const local = withoutDialPrefix(value, prefix);
  const ownPrefix = !prefix || local.trim().startsWith('+') || local.trim().startsWith('00');
  return (
    // h-11 = alto del Input: el prefijo se centra en el campo, no en lo que
    // mida la celda de la rejilla donde caiga (salía debajo del campo).
    <div className="relative self-start">
      {!ownPrefix && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-4 flex h-11 items-center text-sm font-semibold text-zinc-500"
        >
          {prefix}
        </span>
      )}
      <Input
        {...rest}
        type="tel"
        inputMode="tel"
        value={local}
        onChange={(e) => onChange(withDialPrefix(e.target.value, prefix))}
        className={cn(!ownPrefix && 'pl-[3.25rem]', className)}
      />
    </div>
  );
}
