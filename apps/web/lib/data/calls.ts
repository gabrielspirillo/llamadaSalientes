import 'server-only';
import { db } from '@/lib/db/client';
import { callEvents, calls } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export type UpsertCallInput = {
  tenantId: string;
  retellCallId: string;
  fromNumber?: string | null;
  toNumber?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  status?: string | null;
  intent?: string | null;
  sentiment?: string | null;
  transferred?: boolean;
  transcriptEnc?: string | null;
  summary?: string | null;
};

export async function upsertCall(input: UpsertCallInput) {
  const existing = await db
    .select()
    .from(calls)
    .where(eq(calls.retellCallId, input.retellCallId))
    .limit(1);

  const values = {
    tenantId: input.tenantId,
    retellCallId: input.retellCallId,
    fromNumber: input.fromNumber ?? null,
    toNumber: input.toNumber ?? null,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    durationSeconds: input.durationSeconds ?? null,
    status: input.status ?? null,
    intent: input.intent ?? null,
    sentiment: input.sentiment ?? null,
    transferred: input.transferred ?? false,
    transcriptEnc: input.transcriptEnc ?? null,
    summary: input.summary ?? null,
  };

  if (existing[0]) {
    const [row] = await db
      .update(calls)
      .set(values)
      .where(eq(calls.retellCallId, input.retellCallId))
      .returning();
    return row;
  }

  const [row] = await db.insert(calls).values(values).returning();
  return row;
}

export async function getCallByRetellId(retellCallId: string) {
  const rows = await db.select().from(calls).where(eq(calls.retellCallId, retellCallId)).limit(1);
  return rows[0] ?? null;
}

export async function logCallEvent(input: {
  tenantId: string;
  callId: string;
  event: string;
  payload: unknown;
}) {
  // ON CONFLICT DO NOTHING: el unique (callId, event) evita duplicados si Retell reintenta
  await db
    .insert(callEvents)
    .values({
      tenantId: input.tenantId,
      callId: input.callId,
      event: input.event,
      payload: input.payload as Record<string, unknown>,
    })
    .onConflictDoNothing();
}
