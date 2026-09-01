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
        {required && <span className="text-rose-500"> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-[13px] text-zinc-500">{hint}</p>}
      {error && <p className="animate-fade-down text-[13px] font-medium text-rose-600">{error}</p>}
    </div>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full cursor-pointer rounded-[14px] border border-[--color-border] bg-white px-4 text-sm transition-[border-color,box-shadow] duration-300 hover:border-brand-200 focus-visible:border-brand-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/12 disabled:opacity-50',
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
    <span className={cn('text-[12px] tabular-nums', over ? 'text-rose-600' : 'text-zinc-500')}>
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
        tone === 'danger' ? 'text-rose-600 hover:bg-rose-50' : 'text-brand-700 hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}
