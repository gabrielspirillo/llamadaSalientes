'use client';

import dynamic from 'next/dynamic';

/**
 * Capas flotantes del panel, cargadas aparte del bundle compartido.
 *
 * El dock de Mensajes (con su hilo, el conmutador rápido, la bandeja de
 * menciones y las notificaciones) y el tour de bienvenida sumaban ~1.800
 * líneas de JS que se descargaban y evaluaban en TODA página del panel, aunque
 * el dock esté colapsado y el tour se vea una única vez en la vida de la
 * cuenta. Ninguna de las dos aporta nada al primer pintado, así que se cargan
 * después, sin SSR.
 */
const MessagesDock = dynamic(
  () => import('@/components/messaging/dock/MessagesDock').then((m) => m.MessagesDock),
  { ssr: false },
);

const WelcomeTour = dynamic(
  () => import('@/components/dashboard/welcome-tour').then((m) => m.WelcomeTour),
  { ssr: false },
);

export function DashboardOverlays({ tourAutoStart }: { tourAutoStart: boolean }) {
  return (
    <>
      <WelcomeTour autoStart={tourAutoStart} />
      <MessagesDock />
    </>
  );
}
