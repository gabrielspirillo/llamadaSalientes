import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Marca de FUTURA arriba a la izquierda en las pantallas de acceso. */
export function AuthBrand() {
  return (
    <Link href="/" className="group mb-8 inline-flex items-center gap-2.5 self-start" aria-label="FUTURA">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#7139e8,#a855f7_60%,#ec4899)] text-white shadow-[0_10px_26px_-10px_rgba(113,57,232,0.9)] transition-transform duration-500 group-hover:rotate-6">
        <Sparkles className="h-4.5 w-4.5" />
      </span>
      <span className="leading-none">
        <span className="block text-[18px] font-extrabold tracking-tight text-zinc-900">FUTURA</span>
        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
          Solutions
        </span>
      </span>
    </Link>
  );
}

/**
 * Panel derecho de las pantallas de acceso: degradado nocturno con auroras
 * animadas y una retícula sutil. Solo visible en escritorio.
 */
export function AuthAside({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <aside className="relative hidden items-center justify-center overflow-hidden bg-[linear-gradient(150deg,#1d1934_0%,#3a2a63_50%,#5b2a72_100%)] p-12 text-white lg:flex">
      {/* Auroras */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-[32rem] w-[32rem] animate-drift rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.55),transparent_70%)] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] animate-drift rounded-full bg-[radial-gradient(circle,rgba(236,72,153,0.45),transparent_70%)] blur-3xl"
        style={{ animationDelay: '-8s' }}
      />
      {/* Retícula fina para dar textura */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative max-w-md animate-fade-up">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/80 ring-1 ring-inset ring-white/15">
          {eyebrow}
        </p>
        {children}
      </div>
    </aside>
  );
}
