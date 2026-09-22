import type { Metadata } from 'next';
import { SapinnDemo } from './sapinn-client';

// Página pública dedicada a la consulta SPN-2026-VOZ-01 de Sapinn. Es un
// destino privado por enlace (no enlazado desde ningún sitio) donde se habla
// con el agente por el navegador o se pide que llame al teléfono, contra
// /api/public/demo-web-call y /api/public/sapinn-call.
//
// noindex: no queremos que aparezca en buscadores. La ruta está exenta del
// middleware de Clerk (ver isPublicRoute), así que no exige login.
//
// force-dynamic: sin esto la página se prerrenderiza y se sirve con
// `s-maxage` de un año. Tras un despliegue el navegador recibía el HTML del
// build ANTERIOR junto al JavaScript del nuevo: la página terminaba bien tras
// hidratar, pero el primer pintado mostraba el texto viejo. Es una página de
// una sola pantalla, así que renderizarla en cada visita no cuesta nada.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Probar el agente de voz · Futura',
  description: 'Habla con el agente de voz o pide que te llame al teléfono.',
  robots: { index: false, follow: false },
};

export default function SapinnPage() {
  return <SapinnDemo />;
}
