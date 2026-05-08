import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
