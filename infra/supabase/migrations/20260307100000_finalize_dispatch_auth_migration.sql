create or replace function irpf_slugify_reference(input text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      regexp_replace(
        regexp_replace(
          lower(
            translate(
              coalesce(input, ''),
              'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
              'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'
            )
          ),
          '[^a-z0-9]+',
          '-',
          'g'
        ),
        '(^-+|-+$)',
        '',
        'g'
      ),
      ''
    ),
    'item'
  );
$$;

create or replace function irpf_legacy_access_role(input text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(input, ''))) in ('socio', 'admin', 'administrador') then 'admin'
    when lower(trim(coalesce(input, ''))) in ('senior', 'fiscal_senior') then 'fiscal_senior'
    when lower(trim(coalesce(input, ''))) in ('junior', 'fiscal_junior') then 'fiscal_junior'
    else 'solo_lectura'
  end;
$$;

create table if not exists irpf_users (
  id uuid primary key,
  reference text not null unique,
  display_name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'fiscal_senior', 'fiscal_junior', 'solo_lectura')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  auth_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists irpf_users
  add column if not exists auth_user_id uuid;

do $$
begin
  if exists (
    select 1
    from pg_class rel
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relkind = 'r'
      and nsp.nspname = 'public'
      and rel.relname = 'irpf_users'
  ) and not exists (
    select 1
    from pg_constraint
    where conname = 'irpf_users_auth_user_id_fkey'
  ) then
    alter table irpf_users
      add constraint irpf_users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create unique index if not exists idx_irpf_users_auth_user_id
  on irpf_users (auth_user_id)
  where auth_user_id is not null;

create table if not exists irpf_user_client_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references irpf_users(id) on delete cascade,
  client_id uuid not null references irpf_clients(id) on delete cascade,
  assignment_role text not null default 'manager' check (assignment_role in ('owner', 'manager', 'support', 'viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists idx_irpf_user_assignments_user on irpf_user_client_assignments (user_id);
create index if not exists idx_irpf_user_assignments_client on irpf_user_client_assignments (client_id);

alter table if exists irpf_clients
  add column if not exists reference text,
  add column if not exists display_name text,
  add column if not exists status text,
  add column if not exists metadata jsonb;

update irpf_clients
set
  status = coalesce(nullif(trim(status), ''), 'active'),
  metadata = coalesce(metadata, '{}'::jsonb);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'irpf_clients'
      and column_name = 'full_name'
  ) then
    execute $sql$
      update irpf_clients
      set display_name = coalesce(
        nullif(trim(display_name), ''),
        nullif(trim(full_name), '')
      )
      where display_name is null or trim(display_name) = ''
    $sql$;
  end if;
end $$;

update irpf_clients
set display_name = 'Cliente ' || substr(replace(id::text, '-', ''), 1, 8)
where display_name is null or trim(display_name) = '';

do $$
declare
  contact_person_expr text := 'null';
  notes_expr text := 'null';
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'irpf_clients'
      and column_name = 'phone'
  ) then
    contact_person_expr := 'nullif(trim(phone), '''')';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'irpf_clients'
      and column_name = 'notes'
  ) then
    notes_expr := 'nullif(trim(notes), '''')';
  end if;

  if contact_person_expr <> 'null' or notes_expr <> 'null' then
    execute format(
      $sql$
        update irpf_clients
        set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(
          jsonb_build_object(
            'contact_person', %s,
            'notes', %s
          )
        )
      $sql$,
      contact_person_expr,
      notes_expr
    );
  end if;
end $$;

with client_reference_candidates as (
  select
    client.id,
    client.reference as existing_reference,
    coalesce(
      nullif(irpf_slugify_reference(client.display_name), ''),
      'cliente'
    ) as base_reference,
    row_number() over (
      partition by coalesce(nullif(irpf_slugify_reference(client.display_name), ''), 'cliente')
      order by client.id
    ) as reference_rank
  from irpf_clients client
)
update irpf_clients as client
set reference = case
  when candidate.existing_reference is not null and trim(candidate.existing_reference) <> '' then candidate.existing_reference
  when candidate.reference_rank = 1 and not exists (
    select 1
    from irpf_clients other
    where other.id <> client.id
      and lower(coalesce(other.reference, '')) = candidate.base_reference
  ) then candidate.base_reference
  else candidate.base_reference || '-' || substr(replace(client.id::text, '-', ''), 1, 8)
end
from client_reference_candidates candidate
where candidate.id = client.id
  and (client.reference is null or trim(client.reference) = '');

drop trigger if exists tr_irpf_clients_updated_at on irpf_clients;
create trigger tr_irpf_clients_updated_at before update on irpf_clients
for each row execute function set_updated_at();

drop trigger if exists tr_irpf_users_updated_at on irpf_users;
create trigger tr_irpf_users_updated_at before update on irpf_users
for each row execute function set_updated_at();

update irpf_users
set auth_user_id = nullif(metadata->>'auth_user_id', '')::uuid
where auth_user_id is null
  and coalesce(metadata->>'auth_user_id', '') <> '';

update irpf_users
set metadata = metadata - 'auth_user_id'
where metadata ? 'auth_user_id';

update irpf_users as user_row
set auth_user_id = auth_row.id,
    updated_at = now()
from auth.users auth_row
where user_row.auth_user_id is null
  and lower(user_row.email) = lower(auth_row.email);

do $$
begin
  if to_regclass('public.irpf_abogados') is null then
    return;
  end if;

  drop table if exists tmp_legacy_user_resolution;

  create temporary table tmp_legacy_user_resolution on commit drop as
  with legacy_users as (
    select
      abogado.id as legacy_user_id,
      lower(trim(abogado.email)) as email,
      coalesce(
        nullif(trim(abogado.nombre), ''),
        split_part(lower(trim(abogado.email)), '@', 1),
        'Usuario despacho'
      ) as display_name,
      irpf_legacy_access_role(abogado.rol) as role,
      case when coalesce(abogado.activo, true) then 'active' else 'inactive' end as status,
      coalesce(
        nullif(irpf_slugify_reference(split_part(lower(trim(abogado.email)), '@', 1)), ''),
        'usuario'
      ) as base_reference
    from irpf_abogados abogado
    where nullif(trim(abogado.email), '') is not null
  ),
  ranked_users as (
    select
      legacy_users.*,
      row_number() over (partition by legacy_users.base_reference order by legacy_users.legacy_user_id) as reference_rank
    from legacy_users
  )
  select
    ranked_users.legacy_user_id,
    coalesce(existing_user.id, ranked_users.legacy_user_id) as resolved_user_id,
    ranked_users.email,
    coalesce(
      nullif(existing_user.reference, ''),
      case
        when ranked_users.reference_rank = 1 and not exists (
          select 1
          from irpf_users other
          where other.id <> coalesce(existing_user.id, ranked_users.legacy_user_id)
            and lower(other.reference) = ranked_users.base_reference
        ) then ranked_users.base_reference
        else ranked_users.base_reference || '-' || substr(replace(ranked_users.legacy_user_id::text, '-', ''), 1, 8)
      end
    ) as resolved_reference,
    ranked_users.display_name,
    ranked_users.role,
    ranked_users.status,
    existing_user.auth_user_id as existing_auth_user_id
  from ranked_users
  left join irpf_users existing_user on lower(existing_user.email) = ranked_users.email;

  insert into irpf_users (id, reference, display_name, email, role, status, auth_user_id, metadata)
  select
    resolution.resolved_user_id,
    resolution.resolved_reference,
    resolution.display_name,
    resolution.email,
    resolution.role,
    resolution.status,
    coalesce(resolution.existing_auth_user_id, auth_row.id),
    coalesce(existing_user.metadata, '{}'::jsonb)
  from tmp_legacy_user_resolution resolution
  left join irpf_users existing_user on existing_user.id = resolution.resolved_user_id
  left join auth.users auth_row on lower(auth_row.email) = resolution.email
  on conflict (id) do update
  set
    reference = excluded.reference,
    display_name = excluded.display_name,
    email = excluded.email,
    role = excluded.role,
    status = excluded.status,
    auth_user_id = coalesce(irpf_users.auth_user_id, excluded.auth_user_id),
    metadata = coalesce(irpf_users.metadata, '{}'::jsonb),
    updated_at = now();

  update irpf_users as user_row
  set auth_user_id = auth_row.id,
      updated_at = now()
  from auth.users auth_row
  where user_row.auth_user_id is null
    and lower(user_row.email) = lower(auth_row.email);

  if to_regclass('public.irpf_asignaciones') is not null then
    insert into irpf_user_client_assignments (user_id, client_id, assignment_role)
    select distinct
      resolution.resolved_user_id,
      asignacion.client_id,
      'manager'
    from irpf_asignaciones asignacion
    join tmp_legacy_user_resolution resolution
      on resolution.legacy_user_id = asignacion.abogado_id
    where asignacion.client_id is not null
    on conflict (user_id, client_id) do nothing;
  end if;
end $$;
