import { OrganizationSwitcher, SignOutButton } from '@clerk/nextjs';
import { Archive } from 'lucide-react';

/** Lo que ve alguien de una clínica archivada: ni panel ni datos. */
export function ArchivedClinicNotice({ clinicName }: { clinicName: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-(--color-canvas) px-4">
      <div className="w-full max-w-md rounded-[22px] border border-(--color-border) bg-white p-8 text-center shadow-[var(--shadow-soft)]">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600">
          <Archive className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-[20px] font-extrabold tracking-tight text-zinc-900">
          {clinicName} está archivada
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">
          El acceso al panel está desactivado. Si crees que es un error, escribe a Futura.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/dashboard" />
          <SignOutButton>
            <button
              type="button"
              className="text-[13px] font-semibold text-zinc-500 hover:text-zinc-800"
            >
              Cerrar sesión
            </button>
          </SignOutButton>
        </div>
      </div>
    </main>
  );
}
