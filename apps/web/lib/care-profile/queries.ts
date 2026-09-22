import 'server-only';
import { eq } from 'drizzle-orm';

import {
  CARE_PROFILE_KINDS,
  type CareProfile,
  type CareProfileKind,
  parseAnamnesisTemplate,
  parseBookingPolicy,
} from '@/lib/care-profile/policy';
import { db } from '@/lib/db/client';
import { tenantCareProfile } from '@/lib/db/schema';

/**
 * Perfil de atención de una clínica, o null si atiende como todas.
 *
 * Es la ÚNICA pregunta que hace el resto del código: "¿esta clínica tiene
 * perfil?". No hay interruptores por función. La fila la siembra una migración
 * con el slug de la clínica que lo pidió; nadie la enciende desde el panel.
 */
export async function getCareProfile(tenantId: string): Promise<CareProfile | null> {
  const rows = await db
    .select()
    .from(tenantCareProfile)
    .where(eq(tenantCareProfile.tenantId, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Un valor que no conozca este código no puede activar un perfil a medias.
  if (!(CARE_PROFILE_KINDS as readonly string[]).includes(row.profile)) return null;

  return {
    tenantId,
    profile: row.profile as CareProfileKind,
    bookingPolicy: parseBookingPolicy(row.bookingPolicy),
    anamnesisTemplate: parseAnamnesisTemplate(row.anamnesisTemplate),
    firstVisitProtocol: row.firstVisitProtocol?.trim() || null,
  };
}
