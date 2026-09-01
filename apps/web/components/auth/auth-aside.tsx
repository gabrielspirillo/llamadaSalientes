import Link from 'next/link';
import type { ReactNode } from 'react';

/** Marca de FUTURA arriba a la izquierda en las pantallas de acceso. */
export function AuthBrand() {
  return (
    <Link
      href="/"
      className="group mb-8 inline-flex items-center gap-2 self-start"
      aria-label="FUTURA"
    >
      <span className="text-[23px] font-extrabold leading-none tracking-tight text-[#0f1f2e]">
        FUTURA
      </span>
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#5fa896]" />
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
    <aside className="relative hidden items-center justify-center overflow-hidden bg-[linear-gradient(150deg,#161a19_0%,#1f2d29_50%,#26403a_100%)] p-12 text-white lg:flex">
      {/* Auroras */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-[32rem] w-[32rem] animate-drift rounded-full bg-[radial-gradient(circle,rgba(95,168,150,0.55),transparent_70%)] blur-3xl"
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
        <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-bold uppercase tracking-[0.16em] text-white/80 ring-1 ring-inset ring-white/15">
          {eyebrow}
        </p>
        {children}
      </div>
    </aside>
  );
}
