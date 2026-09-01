/**
 * Tema de gráficos alineado al sistema "Aurora": pastel saturado sobre blanco,
 * ejes discretos y tooltips con la misma sombra suave que las tarjetas.
 */
export const chartPalette = {
  brand: '#37766a',
  green: '#479183',
  sage: '#6bc2a4',
  teal: '#3d8b8b',
  deepTeal: '#2b6f6f',
  moss: '#8bbf9f',
  emerald: '#10b981',
  slate: '#8a9a95',
  zinc: '#a1a1aa',
  /* Señales, no decoración: solo para aviso y error. */
  amber: '#f59e0b',
  rose: '#f43f5e',
  /* Alias heredados para no romper gráficos que los referencian por nombre. */
  violet: '#479183',
  lilac: '#6bc2a4',
  pink: '#2f8f7a',
  sky: '#3d8b8b',
  cyan: '#5fb0b0',
  blue: '#2b6f6f',
  indigo: '#37766a',
} as const;

/** Orden de series: contraste alto entre vecinos, sin repetir tono. */
export const chartSequence = [
  chartPalette.brand,
  chartPalette.sage,
  chartPalette.teal,
  chartPalette.moss,
  chartPalette.deepTeal,
  chartPalette.green,
  chartPalette.emerald,
  chartPalette.slate,
];

export const axisProps = {
  stroke: '#c2c9c7',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  tick: { fill: '#8a918f' },
} as const;

export const gridProps = {
  stroke: '#e8f4ee',
  strokeDasharray: '4 4',
  vertical: false,
} as const;

export const tooltipStyle = {
  backgroundColor: 'rgba(255,255,255,0.96)',
  border: '1px solid #e6e9e9',
  borderRadius: 14,
  boxShadow: '0 18px 40px -18px rgba(20,33,29,0.35)',
  fontSize: 12,
  fontWeight: 500,
  padding: '10px 12px',
  backdropFilter: 'blur(12px)',
} as const;

export const tooltipCursor = { fill: 'rgba(95,168,150,0.06)' } as const;

/** Duración estándar de la animación de entrada de los gráficos. */
export const chartAnim = { animationDuration: 900, animationBegin: 80 } as const;
