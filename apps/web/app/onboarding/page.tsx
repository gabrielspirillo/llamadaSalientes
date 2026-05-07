import { CreateOrganization } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect('/sign-in');
  if (orgId) redirect('/dashboard');

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-zinc-50">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-black mb-5">
            <span className="text-lg font-semibold text-white">D</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Configurá tu clínica</h1>
          <p className="text-zinc-500 mt-2">
            Creá la organización para tu clínica. Después podés invitar a tu equipo.
          </p>
        </div>
        <CreateOrganization
          afterCreateOrganizationUrl="/dashboard"
          appearance={{
            elements: {
              card: 'shadow-none border border-zinc-200/70',
            },
          }}
        />
      </div>
    </div>
  );
}
