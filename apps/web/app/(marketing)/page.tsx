import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

// El root "/" ya no muestra landing pública. Comportamiento:
//   - Logueado con org  → /dashboard
//   - Logueado sin org  → /onboarding (Clerk a veces rebota a "/" tras crear la org)
//   - Anónimo           → /sign-in
// La landing de marketing quedó deshabilitada a pedido: no debe ser
// accesible para nadie. El diseño anterior vive en el historial de git por
// si en el futuro se quiere reactivar en otra ruta.
export default async function Home() {
  const { userId, orgId } = await auth();

  if (userId) {
    redirect(orgId ? '/dashboard' : '/onboarding');
  }

  redirect('/sign-in');
}
