/**
 * Tema de gráficos alineado al sistema "Aurora": pastel saturado sobre blanco,
 * ejes discretos y tooltips con la misma sombra suave que las tarjetas.
 */
export const chartPalette = {
  brand: '#7139e8',
  violet: '#8b5cf6',
  lilac: '#a78bfa',
  pink: '#ec4899',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  blue: '#3b82f6',
  slate: '#64748b',
  zinc: '#a1a1aa',
  // Alias heredado — algunos gráficos lo referencian por nombre.
  indigo: '#6366f1',
} as const;

/** Orden de series: contraste alto entre vecinos, sin repetir tono. */
export const chartSequence = [
  chartPalette.violet,
  chartPalette.pink,
  chartPalette.sky,
  chartPalette.emerald,
  chartPalette.amber,
  chartPalette.brand,
  chartPalette.rose,
  chartPalette.cyan,
  chartPalette.slate,
];

export const axisProps = {
  stroke: '#c9c4dc',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  tick: { fill: '#8f8aa6' },
} as const;

export const gridProps = {
  stroke: '#f1eefb',
  strokeDasharray: '4 4',
  vertical: false,
} as const;

export const tooltipStyle = {
  backgroundColor: 'rgba(255,255,255,0.96)',
  border: '1px solid #ebe8f6',
  borderRadius: 14,
  boxShadow: '0 18px 40px -18px rgba(23,20,41,0.35)',
  fontSize: 12,
  fontWeight: 500,
  padding: '10px 12px',
  backdropFilter: 'blur(12px)',
} as const;

export const tooltipCursor = { fill: 'rgba(139,92,246,0.06)' } as const;

/** Duración estándar de la animación de entrada de los gráficos. */
export const chartAnim = { animationDuration: 900, animationBegin: 80 } as const;
