create table if not exists irpf_clients (
  id uuid primary key,
  reference text not null unique,
  display_name text not null,
  nif text not null unique,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_irpf_clients_status on irpf_clients (status);
create index if not exists idx_irpf_expedientes_client on irpf_expedientes (client_id);

drop trigger if exists tr_irpf_clients_updated_at on irpf_clients;
create trigger tr_irpf_clients_updated_at before update on irpf_clients
for each row execute function set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'irpf_expedientes_client_id_fkey'
  ) then
    alter table irpf_expedientes
      add constraint irpf_expedientes_client_id_fkey
      foreign key (client_id) references irpf_clients(id) on delete set null not valid;
  end if;
end $$;

insert into irpf_clients (id, reference, display_name, nif, email, status, metadata)
values (
  '9c15ff35-f715-4faa-b427-34656cff6c0b',
  'fagu',
  'FAGU',
  'A00000001',
  'demo@irpf-parser.dev',
  'active',
  jsonb_build_object(
    'contact_person', 'Francisco Arango',
    'notes', 'Cliente demo consolidado para la operativa IRPF/IP/720'
  )
)
on conflict (id) do update set
  reference = excluded.reference,
  display_name = excluded.display_name,
  nif = excluded.nif,
  email = excluded.email,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

insert into irpf_expedientes (id, reference, client_id, fiscal_year, model_type, title, status)
values (
  '5d0790e4-b69f-4cdb-bc4a-a0724261c4ad',
  'demo-irpf-2025',
  '9c15ff35-f715-4faa-b427-34656cff6c0b',
  2025,
  'IRPF',
  'Expediente demo IRPF 2025 - FAGU',
  'EN_REVISION'
)
on conflict (id) do update set
  client_id = excluded.client_id,
  updated_at = now();
