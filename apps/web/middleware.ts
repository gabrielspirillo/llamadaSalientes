import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Rutas públicas — el resto requiere login.
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/onboarding/clinica(.*)', // wizard público de alta de clínicas (valida su propia key firmada)
  '/api/health',
  '/api/webhooks/(.*)', // clerk, retell, ghl, stripe — verifican firma propia
  '/api/retell/(.*)',
  '/api/ghl/webhook',
  '/api/stripe/webhook',
  '/api/twilio/(.*)', // SMS passthrough u otros callbacks de Twilio — Twilio firma con auth_token
  '/api/zadarma/(.*)', // NOTIFY_* webhooks de Zadarma — el handler valida firma md5
  '/api/public/(.*)', // Endpoints invocados desde la landing pública (CORS + rate-limit propios)
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  // El layout del panel necesita saber QUÉ ruta se está pidiendo para poder
  // echar de ahí a un profesional con acceso restringido a su agenda. Un layout
  // de App Router no recibe el pathname, así que se lo pasamos por cabecera.
  //
  // `set` PISA lo que venga del cliente: si no, bastaría con mandar a mano
  // `x-pathname: /dashboard/agenda` para saltarse la redirección.
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
