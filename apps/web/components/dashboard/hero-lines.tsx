// Curvas finas que cruzan el bloque «Hoy» (viewBox 1000×400, se estira).
const LINES = [
  'M620 -20 C 680 140, 820 250, 1040 300',
  'M420 430 C 560 300, 780 250, 1040 230',
  'M-40 120 C 140 150, 300 80, 440 -20',
  'M-40 330 C 200 290, 400 350, 620 430',
  'M760 -30 C 820 70, 920 120, 1040 130',
];

// Las mismas curvas, más gruesas, como máscara: por ellas se ve el destello.
const MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400" preserveAspectRatio="none">${LINES.map(
    (d) =>
      `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`,
  ).join('')}</svg>`,
)}")`;

/**
 * Fondo del bloque «Hoy»: líneas finas que derivan despacio y por las que
 * pasa un destello verde menta. El destello es una banda que se desplaza con
 * `transform` detrás de una máscara con la forma de las líneas: lo mueve la
 * tarjeta gráfica sin redibujar. La primera versión animaba `stroke-dashoffset`
 * y costaba ~11 % de CPU en reposo (40 % con la CPU a 4x), sólo por estar en
 * pantalla. Se apaga con «reducir movimiento».
 */
export function HeroLines() {
  return (
    <div
      aria-hidden="true"
      className="hero-line-drift pointer-events-none absolute -inset-[4%] h-[108%] w-[108%]"
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
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
        {LINES.map((d) => (
          <path
            key={d}
            d={d}
            stroke="url(#hero-arc)"
            strokeOpacity="0.22"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div
        className="hero-line-glow absolute inset-0 overflow-hidden"
        style={{ maskImage: MASK, WebkitMaskImage: MASK }}
      >
        <span className="hero-line-sweep" />
        <span className="hero-line-sweep hero-line-sweep-2" />
      </div>
    </div>
  );
}
