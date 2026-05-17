export const chartPalette = {
  indigo: '#6366f1',
  violet: '#8b5cf6',
  cyan: '#06b6d4',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  blue: '#3b82f6',
  slate: '#64748b',
  zinc: '#a1a1aa',
} as const;

export const chartSequence = [
  chartPalette.indigo,
  chartPalette.cyan,
  chartPalette.emerald,
  chartPalette.amber,
  chartPalette.violet,
  chartPalette.rose,
  chartPalette.blue,
  chartPalette.slate,
];

export const axisProps = {
  stroke: '#a1a1aa',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  tick: { fill: '#71717a' },
} as const;

export const gridProps = {
  stroke: '#f1f5f9',
  vertical: false,
} as const;

export const tooltipStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
  fontSize: 12,
  padding: '8px 10px',
} as const;
