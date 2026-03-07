create table if not exists irpf_users (
  id uuid primary key,
  reference text not null unique,
  display_name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'fiscal_senior', 'fiscal_junior', 'solo_lectura')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists irpf_user_client_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references irpf_users(id) on delete cascade,
  client_id uuid not null references irpf_clients(id) on delete cascade,
  assignment_role text not null default 'manager' check (assignment_role in ('owner', 'manager', 'support', 'viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists idx_irpf_users_role_status on irpf_users (role, status);
create index if not exists idx_irpf_user_assignments_user on irpf_user_client_assignments (user_id);
create index if not exists idx_irpf_user_assignments_client on irpf_user_client_assignments (client_id);

drop trigger if exists tr_irpf_users_updated_at on irpf_users;
create trigger tr_irpf_users_updated_at before update on irpf_users
for each row execute function set_updated_at();

insert into irpf_users (id, reference, display_name, email, role, status, metadata)
values
  (
    'b5f7a6da-f8b4-4515-8d19-b8c8ba4e17e0',
    'demo-admin',
    'Demo Admin',
    'demo@irpf-parser.dev',
    'admin',
    'active',
    jsonb_build_object('team', 'IRPF Demo', 'scope', 'all')
  ),
  (
    'd4d33a11-93e3-4623-912c-a0d28f0b6d87',
    'demo-senior',
    'Fiscalista Senior',
    'senior@irpf-parser.dev',
    'fiscal_senior',
    'active',
    jsonb_build_object('team', 'IRPF Demo', 'scope', 'assigned')
  ),
  (
    '7e015f5a-48c1-46fd-8d34-d6d5c91fc75f',
    'demo-junior',
    'Fiscalista Junior',
    'junior@irpf-parser.dev',
    'fiscal_junior',
    'active',
    jsonb_build_object('team', 'IRPF Demo', 'scope', 'assigned')
  ),
  (
    '456f6aa0-9308-4891-8cdb-8c9c9f0d5105',
    'demo-readonly',
    'Solo lectura',
    'readonly@irpf-parser.dev',
    'solo_lectura',
    'active',
    jsonb_build_object('team', 'IRPF Demo', 'scope', 'assigned')
  )
on conflict (id) do update set
  reference = excluded.reference,
  display_name = excluded.display_name,
  email = excluded.email,
  role = excluded.role,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

insert into irpf_user_client_assignments (user_id, client_id, assignment_role)
values
  ('d4d33a11-93e3-4623-912c-a0d28f0b6d87', '9c15ff35-f715-4faa-b427-34656cff6c0b', 'owner'),
  ('7e015f5a-48c1-46fd-8d34-d6d5c91fc75f', '9c15ff35-f715-4faa-b427-34656cff6c0b', 'support'),
  ('456f6aa0-9308-4891-8cdb-8c9c9f0d5105', '9c15ff35-f715-4faa-b427-34656cff6c0b', 'viewer')
on conflict (user_id, client_id) do update set
  assignment_role = excluded.assignment_role;
