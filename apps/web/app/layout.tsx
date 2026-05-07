import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DentalVoice',
  description: 'Agente de voz IA para clínicas dentales',
};

// DECISION: ClerkProvider se monta solo si hay publishable key configurada.
// En Fase 0 todavía no se conectó Clerk, y prerender exige la key. A partir
// de Fase 1 (cuando se cargue NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) envuelve todo.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = (
    <html lang="es">
      <body>{children}</body>
    </html>
  );

  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return tree;
  }

  return <ClerkProvider>{tree}</ClerkProvider>;
}
