import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

// Rutas públicas: webhooks (verifican firma propia) + landing + auth + health.
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  '/api/retell/(.*)',
  '/api/ghl/webhook',
  '/api/stripe/webhook',
  '/api/inngest(.*)',
]);

const clerkProtect = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

// DECISION: si no hay Clerk configurado (Fase 0), middleware es no-op.
// Cuando se carguen las keys (Fase 1) el middleware empieza a proteger rutas.
export default function middleware(req: NextRequest, ev: unknown) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }
  // biome-ignore lint/suspicious/noExplicitAny: Clerk's event arg type isn't exported cleanly
  return (clerkProtect as any)(req, ev);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
