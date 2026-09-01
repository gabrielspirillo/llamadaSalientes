'use client';

import { cn } from '@/lib/cn';
import * as React from 'react';

/* ============================================================================
   Primitivas de movimiento — sin dependencias (IntersectionObserver + CSS).
   Todas respetan `prefers-reduced-motion` vía globals.css.
   ========================================================================== */

type RevealDirection = 'up' | 'left' | 'right' | 'scale';

/**
 * Revela su contenido cuando entra en viewport. Reemplaza a framer-motion
 * para el 95% de los casos con coste ~0.
 */
export function Reveal({
  children,
  delay = 0,
  direction = 'up',
  className,
  as: Tag = 'div',
  once = true,
}: {
  children: React.ReactNode;
  delay?: number;
  direction?: RevealDirection;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article' | 'header';
  once?: boolean;
}) {
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Si el navegador no soporta IO, mostramos el contenido sin animar.
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-revealed');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-revealed');
            if (once) io.unobserve(e.target);
          } else if (!once) {
            e.target.classList.remove('is-revealed');
          }
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return React.createElement(
    Tag,
    {
      ref: ref as never,
      'data-reveal': direction,
      style: { ['--reveal-delay' as string]: `${delay}ms` },
      className,
    },
    children,
  );
}

/**
 * Aplica entrada escalonada a los hijos directos (--i por índice).
 * Ideal para grids de tarjetas y listas.
 */
export function Stagger({
  children,
  step = 60,
  className,
  ...rest
}: {
  children: React.ReactNode;
  step?: number;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const items = React.Children.toArray(children);
  return (
    <div
      className={cn('stagger', className)}
      style={{ ['--stagger-step' as string]: `${step}ms` }}
      {...rest}
    >
      {items.map((child, i) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ style?: React.CSSProperties }>, {
              style: {
                ...((child as React.ReactElement<{ style?: React.CSSProperties }>).props.style ??
                  {}),
                ['--i' as string]: i,
              },
            })
          : child,
      )}
    </div>
  );
}

/** Halo que sigue al cursor dentro de la tarjeta. */
export function Spotlight({
  children,
  className,
  ...rest
}: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement>(null);
  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
  return (
    <div ref={ref} onMouseMove={onMove} className={cn('spotlight', className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * Número que cuenta hasta su valor con easing. Se dispara al entrar en pantalla.
 * Acepta decimales, sufijos (%, s) y separador de miles es-ES.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
  duration = 1100,
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = React.useState(0);
  const started = React.useRef(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setDisplay(value);
      return;
    }

    const run = () => {
      if (started.current) return;
      started.current = true;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        // easeOutExpo — arranca rápido y frena suave
        const eased = p === 1 ? 1 : 1 - 2 ** (-10 * p);
        setDisplay(value * eased);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) run();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  const formatted = display.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

/** Marca visualmente contenido que se está refrescando. */
export function Pulsing({
  children,
  active = true,
}: { children: React.ReactNode; active?: boolean }) {
  return <span className={active ? 'animate-pulse-soft' : undefined}>{children}</span>;
}
