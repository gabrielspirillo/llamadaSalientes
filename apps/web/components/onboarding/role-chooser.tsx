'use client';

import { CreateOrganization, OrganizationList } from '@clerk/nextjs';
import { ArrowLeft, ArrowRight, Building2, Users } from 'lucide-react';
import { useState } from 'react';

const clerkAppearance = {
  elements: { card: 'shadow-none border border-zinc-200/70' },
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
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
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
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Unite a tu clínica</h1>
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
        <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-black">
          <span className="text-lg font-semibold text-white">F</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          ¿Cómo vas a usar Futura?
        </h1>
        <p className="mt-2 text-zinc-500">Elegí una opción para continuar.</p>
      </div>

      <div className="grid gap-3">
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
      className="group flex items-center gap-4 rounded-2xl border border-zinc-200/70 bg-white p-5 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50"
    >
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-zinc-900">{title}</span>
        <span className="block text-sm text-zinc-500">{description}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Volver
    </button>
  );
}
