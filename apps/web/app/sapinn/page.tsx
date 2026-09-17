import type { Metadata } from 'next';
import { SapinnDemo } from './sapinn-client';

// Página pública dedicada a la consulta SPN-2026-VOZ-01 de Sapinn. Es un
// destino privado por enlace (no enlazado desde ningún sitio) donde el
// interlocutor pone su número y el agente saliente le llama, reusando el
// endpoint público /api/public/demo-call (allowlist de países + rate-limit).
//
// noindex: no queremos que aparezca en buscadores. La ruta está exenta del
// middleware de Clerk (ver isPublicRoute), así que no exige login.
export const metadata: Metadata = {
  title: 'Probar el agente de voz · Futura',
  description: 'Poné tu número y el agente de voz te llama en menos de un minuto.',
  robots: { index: false, follow: false },
};

export default function SapinnPage() {
  return <SapinnDemo />;
}
