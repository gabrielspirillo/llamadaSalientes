import { Lock, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Marca de FUTURA en las pantallas de acceso. `light` = sobre la foto. */
export function AuthBrand({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2" aria-label="FUTURA">
      <span
        className={`text-[22px] font-extrabold leading-none tracking-tight ${
          light ? 'text-white' : 'text-[#0f1f2e]'
        }`}
      >
        FUTURA
      </span>
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#5fa896] shadow-[0_0_0_4px_rgba(95,168,150,0.18)]" />
    </Link>
  );
}

/**
 * Columna del formulario: marca arriba, cabecera propia en español (la de
 * Clerk va oculta: ver `authAppearance`) y el formulario, y abajo el sello
 * de seguridad. En móvil, encima, una franja con la foto.
 */
export function AuthPanel({
  image,
  imagePosition,
  title,
  subtitle,
  children,
}: {
  image: string;
  imagePosition: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      {/* Móvil: la foto como cabecera, fundida en blanco hacia el formulario. */}
      <div className="relative h-56 overflow-hidden sm:h-64 lg:hidden">
        <Image
          src={image}
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 1px, 100vw"
          quality={85}
          className="object-cover"
          style={{ objectPosition: imagePosition }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,31,27,0.55)_0%,rgba(15,31,27,0.15)_45%,#ffffff_100%)]" />
        <div className="absolute left-5 top-5 sm:left-8">
          <AuthBrand light />
        </div>
      </div>

      <div className="hidden px-10 pt-10 lg:block xl:px-14">
        <AuthBrand />
      </div>

      <div className="-mt-10 flex flex-1 items-start justify-center px-5 pb-10 sm:px-8 lg:mt-0 lg:items-center lg:py-12">
        <div className="relative w-full max-w-[420px] animate-fade-up rounded-[26px] bg-white px-1 pt-6 sm:px-0 lg:pt-0">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-[#0f1f2e] sm:text-[32px]">
            {title}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">{subtitle}</p>
          <div className="mt-7">{children}</div>

          <p className="mt-8 flex items-center gap-2 text-[12px] text-zinc-400">
            <Lock className="h-3.5 w-3.5" />
            Conexión segura · tus datos y los de tus pacientes van cifrados
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Panel derecho de las pantallas de acceso (sólo escritorio): una foto real a
 * sangre, un velo verde de la marca para que el texto se lea, y el contenido
 * sobre una tarjeta de cristal abajo.
 */
export function AuthAside({
  image,
  imagePosition,
  eyebrow,
  children,
}: {
  image: string;
  imagePosition: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <aside className="relative hidden overflow-hidden bg-[#13201c] text-white lg:block">
      <Image
        src={image}
        alt=""
        fill
        priority
        // La foto se recorta (cover) a una columna vertical: lo que se ve mide
        // ~1,5 veces el alto, no el ancho de la columna. Con "55vw" Next
        // servía una imagen pequeña y la ampliaba: salía blanda.
        sizes="(min-width: 1024px) 100vw, 1px"
        quality={85}
        className="object-cover"
        style={{ objectPosition: imagePosition }}
      />
      {/* Velo: oscuro abajo (donde va el texto), limpio arriba (donde se ve la foto). */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,31,27,0.15)_0%,rgba(15,31,27,0.25)_40%,rgba(15,31,27,0.88)_78%,rgba(15,31,27,0.96)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(95,168,150,0.25),transparent_55%)]" />

      <div className="absolute right-8 top-8 inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-[12px] font-semibold text-white/90 ring-1 ring-inset ring-white/25 backdrop-blur-md">
        <ShieldCheck className="h-3.5 w-3.5" /> Hecho para clínicas
      </div>

      <div className="absolute inset-x-0 bottom-0 p-10 xl:p-14">
        <div className="max-w-xl animate-fade-up">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/80 ring-1 ring-inset ring-white/20 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6bc2a4]" />
            {eyebrow}
          </p>
          {children}
        </div>
      </div>
    </aside>
  );
}

/**
 * El formulario de Clerk vestido con la marca: sin tarjeta ni cabecera propias
 * (las pone `AuthPanel`), campos y botones del mismo alto y radio que el panel.
 */
export const authAppearance = {
  // Los estilos de Clerk van por CSS-in-JS y pisan a una clase normal: lo que
  // tiene que mandar va con `!` (importante en Tailwind 4).
  elements: {
    rootBox: 'w-full!',
    cardBox:
      'w-full! max-w-none! shadow-none! border-0! rounded-none! bg-transparent! overflow-visible!',
    card: 'w-full! shadow-none! border-0! bg-transparent! p-0! gap-6! overflow-visible!',
    header: 'hidden!',
    socialButtonsBlockButton:
      'h-12! rounded-[14px]! border! border-(--color-border)! bg-white! shadow-[0_1px_2px_rgba(20,33,29,0.05)]! transition hover:border-brand-200! hover:bg-brand-50/40!',
    socialButtonsBlockButtonText: 'text-[15px]! font-semibold! text-zinc-800!',
    dividerLine: 'bg-zinc-200!',
    dividerText: 'text-[12px]! font-medium! uppercase! tracking-[0.14em]! text-zinc-400!',
    formFieldLabel: 'text-[13px]! font-semibold! text-zinc-700!',
    formFieldInput:
      'h-12! rounded-[14px]! border! border-solid! border-(--color-border)! bg-white! px-4! text-[15px]! shadow-none! transition focus:border-brand-400! focus:ring-4! focus:ring-brand-100!',
    formButtonPrimary:
      'h-12! rounded-[14px]! bg-[linear-gradient(120deg,#37766a_0%,#479183_45%,#5fa896_100%)]! text-[15px]! font-semibold! normal-case! shadow-[0_10px_24px_-10px_rgba(55,118,106,0.8)]! transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-12px_rgba(55,118,106,0.85)]!',
    footer: 'hidden!',
    footerAction: 'hidden!',
    identityPreview: 'rounded-[14px]! border! border-(--color-border)!',
    otpCodeFieldInput: 'h-12! w-11! rounded-[12px]! border-(--color-border)!',
    formResendCodeLink: 'font-semibold! text-brand-700!',
    alert: 'rounded-[14px]!',
  },
} as const;
