'use client';

import { cn } from '@/lib/cn';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'scrollbar-none inline-flex h-11 max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[--color-border] bg-white/70 p-1 text-zinc-500 backdrop-blur-xl',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold',
      'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
      'hover:text-brand-700',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-[linear-gradient(120deg,#7139e8,#8b5cf6)] data-[state=active]:text-white',
      'data-[state=active]:shadow-[0_6px_18px_-8px_rgba(113,57,232,0.8)]',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-6 focus-visible:outline-none data-[state=active]:animate-fade-up', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

/**
 * Tabs "segmentadas" ligeras basadas en enlaces (para páginas que navegan por
 * query string y no pueden usar Radix). Mantiene el mismo lenguaje visual.
 */
export function SegmentedNav({
  items,
  activeValue,
  className,
}: {
  items: Array<{ value: string; label: string; href: string; count?: number }>;
  activeValue: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'scrollbar-none inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[--color-border] bg-white/70 p-1 backdrop-blur-xl',
        className,
      )}
    >
      {items.map((it) => {
        const active = it.value === activeValue;
        return (
          <a
            key={it.value}
            href={it.href}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-300',
              active
                ? 'bg-[linear-gradient(120deg,#7139e8,#8b5cf6)] text-white shadow-[0_6px_18px_-8px_rgba(113,57,232,0.8)]'
                : 'text-zinc-500 hover:bg-brand-50 hover:text-brand-700',
            )}
          >
            {it.label}
            {typeof it.count === 'number' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                  active ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500',
                )}
              >
                {it.count}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
