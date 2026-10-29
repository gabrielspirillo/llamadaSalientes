'use client';

import dynamic from 'next/dynamic';

/**
 * Capas flotantes del panel, cargadas aparte del bundle compartido: el tour de
 * bienvenida se ve una vez en la vida de la cuenta y no aporta nada al primer
 * pintado. El botón flotante de Mensajes se quitó (la clínica no lo usaba);
 * los avisos siguen saliendo desde MessagingProvider y llevan a Mensajes.
 */
const WelcomeTour = dynamic(
  () => import('@/components/dashboard/welcome-tour').then((m) => m.WelcomeTour),
  { ssr: false },
);

export function DashboardOverlays({ tourAutoStart }: { tourAutoStart: boolean }) {
  return <WelcomeTour autoStart={tourAutoStart} />;
}
