'use client';

import { Label } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type * as React from 'react';

// Helpers de formulario específicos del wizard. Se apoyan en los primitivos de
// components/ui (Input, Textarea, Label, Button) — no agregan librerías.

export function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-xl border border-[--color-border] bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/25 focus-visible:border-zinc-300 disabled:opacity-50 transition-colors',
        className,
      )}
      {...props}
    />
  );
}

// Contador de caracteres para textareas con límite.
export function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={cn('text-xs tabular-nums', over ? 'text-red-600' : 'text-zinc-400')}>
      {value.length}/{max}
    </span>
  );
}

// Botón chico para agregar/eliminar items en listas dinámicas.
export function IconTextButton({
  onClick,
  children,
  tone = 'neutral',
  type = 'button',
}: {
  onClick?: () => void;
  children: React.ReactNode;
  tone?: 'neutral' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
        tone === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-violet-700 hover:bg-violet-50',
      )}
    >
      {children}
    </button>
  );
}
