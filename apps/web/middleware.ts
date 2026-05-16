import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Rutas públicas — el resto requiere login.
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  '/api/webhooks/(.*)', // clerk, retell, ghl, stripe — verifican firma propia
  '/api/retell/(.*)',
  '/api/ghl/webhook',
  '/api/stripe/webhook',
  '/api/inngest(.*)',
  '/api/twilio/(.*)', // SMS passthrough u otros callbacks de Twilio — Twilio firma con auth_token
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
