import { auth, currentUser } from '@clerk/nextjs/server';

// Wrappers finos sobre Clerk para uso en server components / actions.
// Centralizamos acá para no repartir imports de @clerk/nextjs/server por toda la app.

export async function requireAuth() {
  const { userId, orgId } = await auth();
  if (!userId) {
    throw new Error('Unauthenticated — login requerido');
  }
  return { userId, orgId };
}

export async function requireOrg() {
  const { userId, orgId } = await auth();
  if (!userId) throw new Error('Unauthenticated');
  if (!orgId) throw new Error('No active organization — el usuario debe seleccionar una clínica');
  return { userId, orgId };
}

export async function getOptionalAuth() {
  const { userId, orgId } = await auth();
  return { userId: userId ?? null, orgId: orgId ?? null };
}

export async function getCurrentUser() {
  return currentUser();
}
