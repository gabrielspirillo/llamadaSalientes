import { ImageResponse } from 'next/og';

// Favicon generado en build-time. Tipografía: F bold dark navy + dot teal,
// matchea el wordmark FUTURA del sidebar.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        fontSize: 22,
        background: '#ffffff',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        fontWeight: 800,
        color: '#0f1f2e',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        letterSpacing: '-0.05em',
      }}
    >
      <span>F</span>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#5fa896',
          marginLeft: 1,
          marginTop: 9,
        }}
      />
    </div>,
    {
      ...size,
    },
  );
}
