// Swagger UI para la referencia de API.
//
// Sirve una página HTML que carga swagger-ui-dist desde CDN y renderiza el
// spec /openapi.yaml (apps/web/public/openapi.yaml). La ruta NO está en la
// lista de rutas públicas del middleware, así que requiere sesión Clerk:
// solo usuarios logueados del dashboard pueden ver la documentación y el
// "Try it out" funciona con sus cookies de sesión.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SWAGGER_UI_VERSION = '5.17.14';

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CliniQ API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
  <style>
    body { margin: 0; }
    .topbar { display: none; } /* barra de swagger sin uso (no hay selector de specs) */
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      withCredentials: true, // manda cookies Clerk en "Try it out"
      presets: [SwaggerUIBundle.presets.apis],
      defaultModelsExpandDepth: 0,
      docExpansion: 'none',
      tagsSorter: 'alpha',
    });
  </script>
</body>
</html>`;

export function GET(): Response {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
