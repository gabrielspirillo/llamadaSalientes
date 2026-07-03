import path from 'node:path';
import type { NextConfig } from 'next';

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
  },
  async headers() {
    return [
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
