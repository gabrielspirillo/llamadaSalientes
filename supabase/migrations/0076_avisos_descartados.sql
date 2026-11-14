-- Centro de avisos (campana): lo que cada persona descarta. Por persona, no
-- por clínica: que recepción quite un aviso no se lo quita a la dueña.
create table if not exists notification_dismissals (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  ref text not null,
  dismissed_at timestamptz not null default now(),
  primary key (tenant_id, user_id, ref)
);
