import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { auth } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Alta de clínica · FUTURA',
  description: 'Rellena los datos de tu clínica para activar tu asistente de voz.',
};

// Primera pantalla después del registro (flujo: registro → onboarding →
// dashboard). Es autenticada: la clínica ya tiene sesión y el wizard guarda
// sobre SU tenant. Solo se muestra mientras la clínica está en 'onboarding'.
export default async function OnboardingSetupPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect('/sign-in');
  if (!orgId) redirect('/onboarding');

  // El tenant puede no existir aún si el webhook de Clerk todavía no llegó.
  const ctx = await getCurrentTenantOrNull();
  if (!ctx) redirect('/onboarding');

  // Si Futura está impersonando, no debe pasar por el onboarding de la clínica.
  if (ctx.impersonating) redirect('/dashboard');

  // Ya completó el onboarding → al panel.
  if (ctx.tenant.status !== 'onboarding') redirect('/dashboard');

  return (
    <div className="aurora-canvas min-h-screen">
      <OnboardingWizard tenant="" onboardingKey="" authenticated />
    </div>
  );
}
