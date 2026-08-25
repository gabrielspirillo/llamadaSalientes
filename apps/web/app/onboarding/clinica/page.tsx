import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Onboarding · FUTURA',
  description: 'Cargá los datos de tu clínica para activar tu agente de voz.',
};

// Página PÚBLICA (sin login) del onboarding de clínicas nuevas.
//
// Dos formas de usarla:
//   • Link único (recomendado): /onboarding/clinica → sin tenant. La clínica
//     pone su nombre y datos y se crea sola (auto-registro, "pendiente de
//     activar"). Es el mismo link para todas.
//   • Link por clínica: /onboarding/clinica?tenant=<slug>&key=<key> → escribe
//     sobre una clínica que ya existe (requiere key firmada).
export default async function OnboardingClinicaPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; key?: string }>;
}) {
  const { tenant = '', key = '' } = await searchParams;

  return (
    <div className="min-h-screen bg-zinc-50">
      <OnboardingWizard tenant={tenant} onboardingKey={key} selfRegister={!tenant} />
    </div>
  );
}
