-- ============================================================
-- Migración: Auth + RLS single-despacho
-- Fecha: 2026-03-06
-- Descripción: Tabla de abogados vinculada a auth.users,
--   tabla de asignaciones abogado-cliente, y políticas RLS
--   para todas las tablas del schema IRPF.
--
-- Roles:
--   socio     → acceso total a todos los clientes
--   asociado  → acceso solo a clientes asignados
--   paralegal → solo lectura, sin aprobar ni exportar
-- ============================================================

-- -------------------------------------------------------
-- 1. Tabla de clientes (si no existe ya)
-- -------------------------------------------------------
create table if not exists irpf_clients (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  nif         text not null unique,
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Añadir FK de irpf_expedientes → irpf_clients si no existe
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'irpf_expedientes_client_id_fkey'
  ) then
    alter table irpf_expedientes
      add constraint irpf_expedientes_client_id_fkey
      foreign key (client_id) references irpf_clients(id) on delete cascade;
  end if;
end $$;

-- -------------------------------------------------------
-- 2. Tabla de abogados (vinculada a auth.users)
-- -------------------------------------------------------
create table if not exists irpf_abogados (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  email       text not null unique,
  rol         text not null default 'asociado'
                check (rol in ('socio', 'asociado', 'paralegal')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Trigger para sincronizar email desde auth.users al crear
create or replace function irpf_sync_abogado_email()
returns trigger as $$
begin
  update irpf_abogados set email = new.email
  where id = new.id;
  return new;
end;
$$ language plpgsql security definer;

-- -------------------------------------------------------
-- 3. Tabla de asignaciones abogado → cliente
-- -------------------------------------------------------
create table if not exists irpf_asignaciones (
  id           uuid primary key default gen_random_uuid(),
  abogado_id   uuid not null references irpf_abogados(id) on delete cascade,
  client_id    uuid not null references irpf_clients(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (abogado_id, client_id)
);

-- -------------------------------------------------------
-- 4. Función auxiliar: rol del usuario actual
-- -------------------------------------------------------
create or replace function irpf_rol_actual()
returns text as $$
  select rol from irpf_abogados where id = auth.uid();
$$ language sql security definer stable;

-- -------------------------------------------------------
-- 5. Función auxiliar: ¿tiene el usuario acceso al cliente?
-- -------------------------------------------------------
create or replace function irpf_tiene_acceso_cliente(p_client_id uuid)
returns boolean as $$
  select exists (
    select 1 from irpf_abogados where id = auth.uid() and rol = 'socio'
  )
  or exists (
    select 1 from irpf_asignaciones
    where abogado_id = auth.uid() and client_id = p_client_id
  );
$$ language sql security definer stable;

-- -------------------------------------------------------
-- 6. Activar RLS en todas las tablas
-- -------------------------------------------------------
alter table irpf_clients         enable row level security;
alter table irpf_abogados        enable row level security;
alter table irpf_asignaciones    enable row level security;
alter table irpf_expedientes     enable row level security;
alter table irpf_documents       enable row level security;
alter table irpf_extractions     enable row level security;
alter table irpf_operations      enable row level security;
alter table irpf_alerts          enable row level security;
alter table irpf_exports         enable row level security;
alter table irpf_audit_log       enable row level security;

-- -------------------------------------------------------
-- 7. Políticas RLS — irpf_clients
-- -------------------------------------------------------
drop policy if exists "abogados_ven_clientes" on irpf_clients;
create policy "abogados_ven_clientes" on irpf_clients
  for select using (irpf_tiene_acceso_cliente(id));

drop policy if exists "socios_gestionan_clientes" on irpf_clients;
create policy "socios_gestionan_clientes" on irpf_clients
  for all using (irpf_rol_actual() = 'socio');

-- -------------------------------------------------------
-- 8. Políticas RLS — irpf_abogados
-- -------------------------------------------------------
drop policy if exists "abogado_ve_su_perfil" on irpf_abogados;
create policy "abogado_ve_su_perfil" on irpf_abogados
  for select using (id = auth.uid() or irpf_rol_actual() = 'socio');

drop policy if exists "socio_gestiona_abogados" on irpf_abogados;
create policy "socio_gestiona_abogados" on irpf_abogados
  for all using (irpf_rol_actual() = 'socio');

-- -------------------------------------------------------
-- 9. Políticas RLS — irpf_asignaciones
-- -------------------------------------------------------
drop policy if exists "abogado_ve_sus_asignaciones" on irpf_asignaciones;
create policy "abogado_ve_sus_asignaciones" on irpf_asignaciones
  for select using (abogado_id = auth.uid() or irpf_rol_actual() = 'socio');

drop policy if exists "socio_gestiona_asignaciones" on irpf_asignaciones;
create policy "socio_gestiona_asignaciones" on irpf_asignaciones
  for all using (irpf_rol_actual() = 'socio');

-- -------------------------------------------------------
-- 10. Políticas RLS — irpf_expedientes
-- -------------------------------------------------------
drop policy if exists "abogados_ven_expedientes" on irpf_expedientes;
create policy "abogados_ven_expedientes" on irpf_expedientes
  for select using (irpf_tiene_acceso_cliente(client_id));

drop policy if exists "asociados_crean_expedientes" on irpf_expedientes;
create policy "asociados_crean_expedientes" on irpf_expedientes
  for insert with check (
    irpf_tiene_acceso_cliente(client_id)
    and irpf_rol_actual() in ('socio', 'asociado')
  );

drop policy if exists "asociados_editan_expedientes" on irpf_expedientes;
create policy "asociados_editan_expedientes" on irpf_expedientes
  for update using (
    irpf_tiene_acceso_cliente(client_id)
    and irpf_rol_actual() in ('socio', 'asociado')
  );

drop policy if exists "socios_eliminan_expedientes" on irpf_expedientes;
create policy "socios_eliminan_expedientes" on irpf_expedientes
  for delete using (irpf_rol_actual() = 'socio');

-- -------------------------------------------------------
-- 11. Políticas RLS — irpf_documents
-- -------------------------------------------------------
drop policy if exists "abogados_ven_documentos" on irpf_documents;
create policy "abogados_ven_documentos" on irpf_documents
  for select using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
    )
  );

drop policy if exists "asociados_suben_documentos" on irpf_documents;
create policy "asociados_suben_documentos" on irpf_documents
  for insert with check (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
      and irpf_rol_actual() in ('socio', 'asociado')
    )
  );

drop policy if exists "asociados_actualizan_documentos" on irpf_documents;
create policy "asociados_actualizan_documentos" on irpf_documents
  for update using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
      and irpf_rol_actual() in ('socio', 'asociado')
    )
  );

-- -------------------------------------------------------
-- 12. Políticas RLS — irpf_extractions
-- -------------------------------------------------------
drop policy if exists "abogados_ven_extracciones" on irpf_extractions;
create policy "abogados_ven_extracciones" on irpf_extractions
  for select using (
    exists (
      select 1 from irpf_documents d
      join irpf_expedientes e on e.id = d.expediente_id
      where d.id = document_id
      and irpf_tiene_acceso_cliente(e.client_id)
    )
  );

drop policy if exists "asociados_aprueban_extracciones" on irpf_extractions;
create policy "asociados_aprueban_extracciones" on irpf_extractions
  for update using (
    exists (
      select 1 from irpf_documents d
      join irpf_expedientes e on e.id = d.expediente_id
      where d.id = document_id
      and irpf_tiene_acceso_cliente(e.client_id)
      and irpf_rol_actual() in ('socio', 'asociado')
    )
  );

-- -------------------------------------------------------
-- 13. Políticas RLS — irpf_operations
-- -------------------------------------------------------
drop policy if exists "abogados_ven_operaciones" on irpf_operations;
create policy "abogados_ven_operaciones" on irpf_operations
  for select using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
    )
  );

drop policy if exists "asociados_gestionan_operaciones" on irpf_operations;
create policy "asociados_gestionan_operaciones" on irpf_operations
  for all using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
      and irpf_rol_actual() in ('socio', 'asociado')
    )
  );

-- -------------------------------------------------------
-- 14. Políticas RLS — irpf_alerts
-- -------------------------------------------------------
drop policy if exists "abogados_ven_alertas" on irpf_alerts;
create policy "abogados_ven_alertas" on irpf_alerts
  for select using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
    )
  );

drop policy if exists "asociados_resuelven_alertas" on irpf_alerts;
create policy "asociados_resuelven_alertas" on irpf_alerts
  for update using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
      and irpf_rol_actual() in ('socio', 'asociado')
    )
  );

-- -------------------------------------------------------
-- 15. Políticas RLS — irpf_exports
-- -------------------------------------------------------
drop policy if exists "abogados_ven_exports" on irpf_exports;
create policy "abogados_ven_exports" on irpf_exports
  for select using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
    )
  );

drop policy if exists "asociados_generan_exports" on irpf_exports;
create policy "asociados_generan_exports" on irpf_exports
  for all using (
    exists (
      select 1 from irpf_expedientes e
      where e.id = expediente_id
      and irpf_tiene_acceso_cliente(e.client_id)
      and irpf_rol_actual() in ('socio', 'asociado')
    )
  );

-- -------------------------------------------------------
-- 16. Políticas RLS — irpf_audit_log (solo lectura para socios)
-- -------------------------------------------------------
drop policy if exists "socios_ven_audit" on irpf_audit_log;
create policy "socios_ven_audit" on irpf_audit_log
  for select using (
    irpf_rol_actual() = 'socio'
    or (
      irpf_rol_actual() = 'asociado'
      and exists (
        select 1 from irpf_expedientes e
        where e.id = expediente_id
        and irpf_tiene_acceso_cliente(e.client_id)
      )
    )
  );

-- El sistema siempre puede insertar en audit_log (service_role)
drop policy if exists "sistema_inserta_audit" on irpf_audit_log;
create policy "sistema_inserta_audit" on irpf_audit_log
  for insert with check (true);

-- -------------------------------------------------------
-- 17. Índices de soporte para las funciones RLS
-- -------------------------------------------------------
create index if not exists idx_irpf_asignaciones_abogado
  on irpf_asignaciones (abogado_id);
create index if not exists idx_irpf_asignaciones_cliente
  on irpf_asignaciones (client_id);
create index if not exists idx_irpf_abogados_rol
  on irpf_abogados (rol);
create index if not exists idx_irpf_expedientes_client
  on irpf_expedientes (client_id);

-- -------------------------------------------------------
-- 18. Trigger updated_at para nuevas tablas
-- -------------------------------------------------------
create trigger tr_irpf_clients_updated_at
  before update on irpf_clients
  for each row execute function set_updated_at();

create trigger tr_irpf_abogados_updated_at
  before update on irpf_abogados
  for each row execute function set_updated_at();
