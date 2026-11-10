import type { CSSProperties } from 'react';

const v = (vars: Record<string, string>) => vars as CSSProperties;

// Curvas finas que cruzan el bloque «Hoy» (viewBox 1000×400, se estira).
const LINES = [
  { d: 'M620 -20 C 680 140, 820 250, 1040 300', dur: '11s', delay: '0s' },
  { d: 'M420 430 C 560 300, 780 250, 1040 230', dur: '13s', delay: '-4s' },
  { d: 'M-40 120 C 140 150, 300 80, 440 -20', dur: '10s', delay: '-7s' },
  { d: 'M-40 330 C 200 290, 400 350, 620 430', dur: '14s', delay: '-2s' },
  { d: 'M760 -30 C 820 70, 920 120, 1040 130', dur: '9s', delay: '-5s' },
];

/**
 * Fondo del bloque «Hoy»: líneas finas que derivan despacio y por las que
 * viajan pulsos de luz verde menta. Sólo SVG y CSS, sin JavaScript; se apaga
 * con «reducir movimiento».
 */
export function HeroLines() {
  return (
    <svg
      aria-hidden="true"
      className="hero-line-drift pointer-events-none absolute -inset-[4%] h-[108%] w-[108%]"
      viewBox="0 0 1000 400"
      preserveAspectRatio="none"
      fill="none"
    >
      <defs>
        <linearGradient id="hero-arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#a7f3d0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {LINES.map((l) => (
        <g key={l.d}>
          <path
            d={l.d}
            stroke="url(#hero-arc)"
            strokeOpacity="0.22"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={l.d}
            pathLength={100}
            className="hero-line-flow"
            stroke="#6ee7b7"
            strokeOpacity="0.95"
            strokeWidth="1.6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={v({ '--dur': l.dur, '--d': l.delay })}
          />
        </g>
      ))}
    </svg>
  );
}
