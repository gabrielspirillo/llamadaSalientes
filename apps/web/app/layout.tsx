import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DentalVoice',
  description: 'Agente de voz IA para clínicas dentales',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#0a0a0a',
          colorBackground: '#ffffff',
          colorText: '#0a0a0a',
          colorTextSecondary: '#6b7280',
          borderRadius: '12px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
        },
        elements: {
          formButtonPrimary: 'bg-black hover:bg-zinc-800',
          card: 'shadow-none border border-zinc-200/70',
        },
      }}
    >
      <html lang="es">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
