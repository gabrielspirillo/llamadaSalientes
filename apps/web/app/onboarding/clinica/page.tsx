import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Onboarding · FUTURA',
  description: 'Cargá los datos de tu clínica para activar tu agente de voz.',
};

// Página PÚBLICA para el flujo POR-CLÍNICA con key firmada:
//   /onboarding/clinica?tenant=<slug>&key=<key>
// Escribe sobre una clínica que ya existe. (El alta de clínicas NUEVAS es el
// flujo autenticado: registro → /onboarding/setup → dashboard.)
export default async function OnboardingClinicaPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; key?: string }>;
}) {
  const { tenant = '', key = '' } = await searchParams;

  return (
    <div className="min-h-screen aurora-canvas">
      <OnboardingWizard tenant={tenant} onboardingKey={key} />
    </div>
  );
}
