import { notFound } from 'next/navigation';

// Una ruta inexistente del panel cae aquí para que el 404 salga dentro del
// panel (sidebar, marca y "Volver"), no en la página pelada de Next en inglés.
export default function DashboardUnknownRoute() {
  notFound();
}
