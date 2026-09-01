import { RoleChooser } from '@/components/onboarding/role-chooser';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect('/sign-in');
  // Ya tiene una clínica activa → al panel (el gate del dashboard decide si va
  // al wizard de onboarding o directo).
  if (orgId) redirect('/dashboard');

  return (
    <div className="aurora-canvas flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <div className="max-w-lg w-full">
        <RoleChooser />
      </div>
    </div>
  );
}
