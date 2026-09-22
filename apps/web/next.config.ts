import path from 'node:path';
import type { NextConfig } from 'next';

// Cores que puede usar webpack durante el build. Default 2 (el VPS); el
// workflow de GitHub Actions lo sube. Un valor inválido cae al default en vez
// de propagar un NaN a la config de Next.
const parsedCpus = Number(process.env.NEXT_BUILD_CPUS);
const buildCpus = Number.isInteger(parsedCpus) && parsedCpus > 0 ? parsedCpus : 2;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Build standalone para Docker: incluye node_modules trazados + server.js,
  // permite imagen final de ~150MB en vez de >1GB. Necesario para Dokploy.
  output: 'standalone',
  // En monorepo con pnpm, Next necesita saber dónde está la raíz para que
  // el output standalone copie las deps correctas (también las hoisted).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // El visor /docs lee los Markdown de docs/ (raíz del repo) en runtime;
  // sin esto el output standalone no los incluiría en la imagen Docker.
  outputFileTracingIncludes: {
    '/docs/[[...slug]]': ['../../docs/**/*'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
    // El build picaba en ~3,3 GB de RSS. En el VPS, con Postgres, Redis, MinIO
    // y los dos contenedores de la app ya residentes, eso termina en OOM y el
    // deploy falla sin dejar la app caída (sigue sirviendo el contenedor
    // viejo). Estas dos opciones bajan el pico a costa de algo de tiempo.
    //
    // Desde que el build vive en GitHub Actions (máquina vacía, 4 cores y
    // 16 GB) el freno sobra, así que sale de aquí y lo decide quien construye:
    // el workflow sube NEXT_BUILD_CPUS y apaga la optimización de memoria. Los
    // defaults siguen siendo los del VPS, para que un build local o de
    // emergencia allí siga sin OOMear.
    webpackMemoryOptimizations: process.env.NEXT_BUILD_LOW_MEMORY !== 'false',
    // Sin esto, webpack levanta un worker por core: en un VPS de muchos cores
    // se multiplica la memoria del build sin ganar gran cosa.
    cpus: buildCpus,
  },
  async headers() {
    return [
      {
        // Cabeceras de seguridad base. Sin ellas el panel es enmarcable
        // (clickjacking) y cualquier XSS tiene alcance total sobre la sesión.
        // No se declara CSP script-src: el App Router inyecta scripts inline
        // sin nonce y romperíamos la hidratación; frame-ancestors sí es
        // seguro y es el que sustituye a X-Frame-Options en navegadores
        // modernos.
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
      {
        // Habilitar mic/cámara para la app misma. Sin esto, algunos navegadores
        // (especialmente Chromium con Permissions-Policy default) bloquean
        // getUserMedia → Retell WebRTC no funciona desde el dashboard.
        source: '/(.*)',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'microphone=(self), camera=(self), display-capture=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
