'use client';

import { CreateOrganization, OrganizationList } from '@clerk/nextjs';
import { ArrowLeft, ArrowRight, Building2, Sparkles, Users } from 'lucide-react';
import { useState } from 'react';

const clerkAppearance = {
  elements: { card: 'shadow-none border border-[--color-border] rounded-[22px]' },
};

type Mode = 'choose' | 'owner' | 'worker';

// Pantalla posterior al registro y previa al onboarding: la persona elige si
// da de alta una clínica nueva (dueño/admin → onboarding) o se une a una que
// ya existe (trabajador → invitación por email de Clerk).
export function RoleChooser() {
  const [mode, setMode] = useState<Mode>('choose');

  if (mode === 'owner') {
    return (
      <div className="w-full">
        <BackButton onClick={() => setMode('choose')} />
        <div className="mb-6 text-center">
          <h1 className="text-[26px] font-extrabold tracking-tight text-zinc-900 sm:text-[32px]">
            Dá de alta tu clínica
          </h1>
          <p className="mt-2 text-zinc-500">
            Creá la organización de tu clínica. Después cargás sus datos.
          </p>
        </div>
        <CreateOrganization afterCreateOrganizationUrl="/dashboard" appearance={clerkAppearance} />
      </div>
    );
  }

  if (mode === 'worker') {
    return (
      <div className="w-full">
        <BackButton onClick={() => setMode('choose')} />
        <div className="mb-6 text-center">
          <h1 className="text-[26px] font-extrabold tracking-tight text-zinc-900 sm:text-[32px]">
            Unite a tu clínica
          </h1>
          <p className="mt-2 text-zinc-500">
            Si tu clínica te invitó, va a aparecer acá para unirte. Si no aparece, pedile al
            administrador que te invite por email a esta dirección.
          </p>
        </div>
        <OrganizationList
          hidePersonal
          afterSelectOrganizationUrl="/dashboard"
          afterCreateOrganizationUrl="/dashboard"
          appearance={clerkAppearance}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-8 text-center">
        <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7139e8,#a855f7_60%,#ec4899)] shadow-[0_12px_28px_-12px_rgba(113,57,232,0.9)]">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-zinc-900 sm:text-[32px]">
          ¿Cómo vas a usar Futura?
        </h1>
        <p className="mt-2 text-zinc-500">Elegí una opción para continuar.</p>
      </div>

      <div className="stagger grid gap-3">
        <RoleCard
          icon={<Building2 className="h-5 w-5" />}
          title="Soy dueño/administrador"
          description="Quiero dar de alta mi clínica y configurar el agente."
          onClick={() => setMode('owner')}
        />
        <RoleCard
          icon={<Users className="h-5 w-5" />}
          title="Trabajo en una clínica"
          description="Quiero unirme a una clínica que ya está registrada."
          onClick={() => setMode('worker')}
        />
      </div>
    </div>
  );
}

function RoleCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-4 rounded-[22px] border border-[--color-border] bg-white p-5 text-left shadow-[var(--shadow-soft)] transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-[var(--shadow-lifted)]"
    >
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f4f0ff,#fdf0f7)] text-violet-600 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-zinc-900">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-zinc-500">{description}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300 transition-all duration-300 group-hover:translate-x-1 group-hover:text-brand-500" />
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group mb-5 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3.5 py-1.5 text-[13px] font-semibold text-zinc-500 ring-1 ring-[--color-border] transition-all duration-300 hover:text-brand-700 hover:ring-brand-200"
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
      Volver
    </button>
  );
}
