import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Onboarding · FUTURA',
  description: 'Cargá los datos de tu clínica para activar tu agente de voz.',
};

// Página PÚBLICA (sin login) del onboarding de clínicas nuevas. Se envía por
// link: /onboarding/clinica?tenant=<slug>&key=<key>
//
// ⚠️ Para que sea accesible sin sesión falta UN cambio en un archivo existente
// (middleware.ts): agregar '/onboarding/clinica(.*)' a las rutas públicas.
// Ese diff se entrega para revisión aparte — no se aplica acá por regla
// (no tocar middleware/auth). Sin ese cambio, Clerk pide login antes de llegar.
export default async function OnboardingClinicaPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; key?: string }>;
}) {
  const { tenant = '', key = '' } = await searchParams;

  return (
    <div className="min-h-screen bg-zinc-50">
      <OnboardingWizard tenant={tenant} onboardingKey={key} />
    </div>
  );
}
