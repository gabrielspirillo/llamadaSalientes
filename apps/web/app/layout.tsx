import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FUTURA SOLUTIONS',
  description: 'Agente de voz IA para clínicas dentales',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sin zoom en mobile: evita el pinch-zoom que desarma el layout.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
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
          colorPrimary: '#37766a',
          colorBackground: '#ffffff',
          colorText: '#14211d',
          colorTextSecondary: '#6d6883',
          borderRadius: '14px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
        },
        elements: {
          formButtonPrimary: 'bg-black hover:bg-zinc-800',
          card: 'shadow-none border border-[--color-border]',
          // Oculta el badge "Secured by Clerk" y el toggle de "Development mode"
          // que aparecen en el plan free / con keys de test.
          footer: 'hidden',
          footerAction: 'hidden',
          badge: 'hidden',
          poweredByClerk: 'hidden',
        },
      }}
    >
      <html lang="es">
        <head>
          {/* Marca que hay JS antes del primer pintado: las animaciones de
              entrada solo ocultan contenido cuando pueden revelarlo después. */}
          <script
            // biome-ignore lint/security/noDangerouslySetInnerHtml: script inline mínimo y estático
            dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }}
          />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
