// Helpers de siembra para las pruebas de integración del módulo Tareas.
// Solo lo usan los tests: no forma parte del bundle de producción.

import postgres from 'postgres';

export const raw = postgres(process.env.DATABASE_URL as string, { max: 4, prepare: false });

export interface SeedIds {
  tenantId: string;
  userA: string;
  userB: string;
  userC: string;
}

let counter = 0;

/** Crea un tenant limpio con clinic_settings (Europe/Madrid) y 3 usuarios. */
export async function seedTenant(label: string, tz = 'Europe/Madrid'): Promise<SeedIds> {
  counter += 1;
  const suffix = `${label}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const [t] = await raw<{ id: string }[]>`
    insert into tenants (name, slug, clerk_organization_id)
    values (${`Clinica ${suffix}`}, ${`slug-${suffix}`}, ${`org_${suffix}`})
    returning id`;
  const tenantId = t!.id;

  await raw`
    insert into clinic_settings (tenant_id, timezone, recording_consent_text)
    values (${tenantId}, ${tz}, 'Consentimiento')`;

  const users: string[] = [];
  for (const name of ['ana', 'bruno', 'clara']) {
    const [u] = await raw<{ id: string }[]>`
      insert into users (clerk_user_id, email)
      values (${`user_${name}_${suffix}`}, ${`${name}.perez@${suffix}.test`})
      returning id`;
    users.push(u!.id);
    await raw`
      insert into tenant_memberships (tenant_id, user_id, role)
      values (${tenantId}, ${u!.id}, ${name === 'ana' ? 'admin' : 'basic_member'})`;
  }

  return { tenantId, userA: users[0]!, userB: users[1]!, userC: users[2]! };
}

export async function countTasks(tenantId: string): Promise<number> {
  const [r] = await raw<{ n: number }[]>`
    select count(*)::int as n from tasks where tenant_id = ${tenantId}`;
  return r!.n;
}

export async function timeline(taskId: string): Promise<string[]> {
  const rows = await raw<{ body: string }[]>`
    select body from task_comments
    where task_id = ${taskId} and kind = 'activity'
    order by created_at asc, ctid asc`;
  return rows.map((r) => r.body);
}

export async function taskRow(taskId: string): Promise<Record<string, unknown>> {
  const [r] = await raw<Record<string, unknown>[]>`select * from tasks where id = ${taskId}`;
  return r!;
}
