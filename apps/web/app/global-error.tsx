'use client';

/**
 * Último recurso: un fallo en el layout raíz no tiene ningún boundary por
 * encima, así que sin este archivo el usuario ve la pantalla en blanco de
 * Next. Reemplaza <html> entero, por eso no puede usar las primitivas del
 * panel ni Tailwind con confianza.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f6f5fb',
          color: '#27272a',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>
            Algo se rompió al cargar la aplicación
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#52525b', margin: '0 0 20px' }}>
            Volvé a intentarlo. Si el problema persiste, avisanos y lo miramos.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 999,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: 'linear-gradient(135deg,#7c5cff,#5b8def)',
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
