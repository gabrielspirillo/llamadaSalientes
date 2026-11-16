import { ImageResponse } from 'next/og';

// Favicon: una «F» blanca sobre un cuadrado redondeado en el verde de la
// marca, como los iconos de pestaña de las apps que se reconocen de un
// vistazo. Se genera en el build.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        background: 'linear-gradient(140deg, #4f9a85 0%, #2f6b5c 100%)',
        color: '#ffffff',
        fontSize: 23,
        fontWeight: 800,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        letterSpacing: '-0.04em',
        paddingTop: 1,
      }}
    >
      F
    </div>,
    { ...size },
  );
}
