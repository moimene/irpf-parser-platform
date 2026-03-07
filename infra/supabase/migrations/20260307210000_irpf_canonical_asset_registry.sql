create extension if not exists pgcrypto;

create table if not exists irpf_cat_pais (
  codigo_pais char(2) primary key,
  nombre text not null
);

create table if not exists irpf_cat_situacion_bien (
  clave_situacion char(2) primary key,
  descripcion text not null
);

create table if not exists irpf_cat_territorio_fiscal (
  codigo_territorio text primary key,
  descripcion text not null,
  codigo_pais char(2) not null
);

create table if not exists irpf_cat_condicion_declarante (
  clave_condicion char(1) primary key,
  descripcion text not null
);

create table if not exists irpf_cat_tipo_bien (
  clave_tipo_bien char(1) primary key,
  descripcion text not null
);

create table if not exists irpf_cat_subclave_bien (
  clave_tipo_bien char(1) not null references irpf_cat_tipo_bien(clave_tipo_bien),
  subclave char(1) not null,
  descripcion text not null,
  primary key (clave_tipo_bien, subclave)
);

create table if not exists irpf_cat_origen_bien (
  clave_origen char(1) primary key,
  descripcion text not null
);

create table if not exists irpf_cat_clave_identificacion (
  clave_identificacion char(1) primary key,
  descripcion text not null
);

create table if not exists irpf_cat_clave_representacion (
  clave_representacion char(1) primary key,
  descripcion text not null
);

create table if not exists irpf_cat_tipo_inmueble (
  clave_tipo_inmueble char(1) primary key,
  descripcion text not null
);

create table if not exists irpf_cat_tipo_derecho_real (
  id bigserial primary key,
  descripcion text not null unique
);

create table if not exists irpf_cat_tipo_bien_mueble (
  clave_tipo_bien_mueble text primary key,
  descripcion text not null
);

insert into irpf_cat_pais (codigo_pais, nombre)
values
  ('ES', 'Espana'),
  ('IE', 'Irlanda'),
  ('DE', 'Alemania'),
  ('FR', 'Francia'),
  ('PT', 'Portugal'),
  ('IT', 'Italia'),
  ('GB', 'Reino Unido'),
  ('US', 'Estados Unidos'),
  ('CH', 'Suiza'),
  ('LU', 'Luxemburgo'),
  ('NL', 'Paises Bajos'),
  ('BE', 'Belgica'),
  ('AT', 'Austria'),
  ('SE', 'Suecia'),
  ('DK', 'Dinamarca'),
  ('FI', 'Finlandia'),
  ('AD', 'Andorra'),
  ('GI', 'Gibraltar'),
  ('HK', 'Hong Kong'),
  ('SG', 'Singapur'),
  ('JP', 'Japon'),
  ('AU', 'Australia'),
  ('BR', 'Brasil'),
  ('MX', 'Mexico'),
  ('PA', 'Panama')
on conflict (codigo_pais) do update set nombre = excluded.nombre;

insert into irpf_cat_situacion_bien (clave_situacion, descripcion)
values
  ('ES', 'Situado en Espana'),
  ('EX', 'Situado en el extranjero')
on conflict (clave_situacion) do update set descripcion = excluded.descripcion;

insert into irpf_cat_territorio_fiscal (codigo_territorio, descripcion, codigo_pais)
values
  ('ES-COMUN', 'Territorio comun', 'ES'),
  ('ES-BI', 'Bizkaia', 'ES'),
  ('ES-GI', 'Gipuzkoa', 'ES'),
  ('ES-VI', 'Alava', 'ES'),
  ('ES-NA', 'Navarra', 'ES')
on conflict (codigo_territorio) do update set
  descripcion = excluded.descripcion,
  codigo_pais = excluded.codigo_pais;

insert into irpf_cat_condicion_declarante (clave_condicion, descripcion)
values
  ('1', 'Titular'),
  ('2', 'Representante'),
  ('3', 'Autorizado'),
  ('4', 'Beneficiario'),
  ('5', 'Usufructuario'),
  ('6', 'Tomador'),
  ('7', 'Con poder de disposicion'),
  ('8', 'Otras formas de titularidad real')
on conflict (clave_condicion) do update set descripcion = excluded.descripcion;

insert into irpf_cat_tipo_bien (clave_tipo_bien, descripcion)
values
  ('C', 'Cuentas en entidades bancarias o crediticias'),
  ('V', 'Valores y derechos'),
  ('I', 'Instituciones de inversion colectiva'),
  ('S', 'Seguros y rentas'),
  ('B', 'Bienes inmuebles y derechos reales'),
  ('M', 'Bienes muebles y derechos sobre bienes muebles')
on conflict (clave_tipo_bien) do update set descripcion = excluded.descripcion;

insert into irpf_cat_subclave_bien (clave_tipo_bien, subclave, descripcion)
values
  ('C', '1', 'Cuenta corriente'),
  ('C', '2', 'Cuenta de ahorro'),
  ('C', '3', 'Imposicion a plazo'),
  ('C', '4', 'Cuenta de credito'),
  ('C', '5', 'Otras cuentas'),
  ('V', '1', 'Participacion en entidad juridica'),
  ('V', '2', 'Cesion de capitales propios a terceros'),
  ('V', '3', 'Trusts, fideicomisos o masas patrimoniales'),
  ('I', '0', 'Participacion en IIC'),
  ('S', '1', 'Seguro de vida o invalidez'),
  ('S', '2', 'Renta temporal o vitalicia'),
  ('B', '1', 'Titularidad del bien inmueble'),
  ('B', '2', 'Derecho real de uso o disfrute'),
  ('B', '3', 'Nuda propiedad'),
  ('B', '4', 'Multipropiedad o aprovechamiento por turnos'),
  ('B', '5', 'Otros derechos reales sobre inmuebles'),
  ('M', '1', 'Bien mueble o derecho sobre bien mueble')
on conflict (clave_tipo_bien, subclave) do update set descripcion = excluded.descripcion;

insert into irpf_cat_origen_bien (clave_origen, descripcion)
values
  ('A', 'Alta o primera declaracion'),
  ('M', 'Ya declarado con nueva obligacion de informar'),
  ('C', 'Extincion de la titularidad o del derecho')
on conflict (clave_origen) do update set descripcion = excluded.descripcion;

insert into irpf_cat_clave_identificacion (clave_identificacion, descripcion)
values
  ('1', 'ISIN'),
  ('2', 'Sin ISIN')
on conflict (clave_identificacion) do update set descripcion = excluded.descripcion;

insert into irpf_cat_clave_representacion (clave_representacion, descripcion)
values
  ('A', 'Anotaciones en cuenta'),
  ('B', 'No anotaciones en cuenta')
on conflict (clave_representacion) do update set descripcion = excluded.descripcion;

insert into irpf_cat_tipo_inmueble (clave_tipo_inmueble, descripcion)
values
  ('U', 'Urbano'),
  ('R', 'Rustico')
on conflict (clave_tipo_inmueble) do update set descripcion = excluded.descripcion;

insert into irpf_cat_tipo_derecho_real (descripcion)
values
  ('Uso o disfrute'),
  ('Nuda propiedad'),
  ('Multipropiedad'),
  ('Superficie'),
  ('Otros derechos reales')
on conflict (descripcion) do nothing;

insert into irpf_cat_tipo_bien_mueble (clave_tipo_bien_mueble, descripcion)
values
  ('GENERAL', 'Bien mueble general'),
  ('ART', 'Obra de arte'),
  ('JEWELRY', 'Joyas y metales preciosos'),
  ('VEHICLE', 'Vehiculo'),
  ('BOAT', 'Embarcacion'),
  ('AIRCRAFT', 'Aeronave'),
  ('COLLECTION', 'Coleccion'),
  ('OTHER', 'Otro bien mueble')
on conflict (clave_tipo_bien_mueble) do update set descripcion = excluded.descripcion;

create table if not exists irpf_declaration_profiles (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null unique references irpf_expedientes(id) on delete cascade,
  client_id uuid references irpf_clients(id) on delete set null,
  fiscal_year int not null,
  declarant_nif text not null,
  declared_nif text not null,
  legal_representative_nif text,
  declared_name text not null,
  contact_name text,
  contact_phone text,
  residence_country_code char(2) not null default 'ES',
  residence_territory_code text not null default 'ES-COMUN' references irpf_cat_territorio_fiscal(codigo_territorio),
  default_asset_location_key char(2) not null default 'ES' references irpf_cat_situacion_bien(clave_situacion),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_irpf_declaration_profile_country_format
    check (residence_country_code ~ '^[A-Z]{2}$')
);

insert into irpf_declaration_profiles (
  expediente_id,
  client_id,
  fiscal_year,
  declarant_nif,
  declared_nif,
  declared_name
)
select
  expediente.id,
  expediente.client_id,
  expediente.fiscal_year,
  coalesce(client.nif, '00000000T'),
  coalesce(client.nif, '00000000T'),
  coalesce(client.display_name, expediente.title)
from irpf_expedientes as expediente
left join irpf_clients as client
  on client.id = expediente.client_id
on conflict (expediente_id) do nothing;

create table if not exists irpf_asset_registry (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
  declaration_profile_id uuid references irpf_declaration_profiles(id) on delete set null,
  client_id uuid references irpf_clients(id) on delete set null,
  asset_class text not null check (
    asset_class in (
      'ACCOUNT',
      'SECURITY',
      'COLLECTIVE_INVESTMENT',
      'INSURANCE',
      'REAL_ESTATE',
      'MOVABLE_ASSET'
    )
  ),
  clave_condicion char(1) not null references irpf_cat_condicion_declarante(clave_condicion),
  tipo_titularidad text,
  clave_tipo_bien char(1) not null references irpf_cat_tipo_bien(clave_tipo_bien),
  subclave char(1) not null,
  codigo_pais char(2) not null,
  codigo_territorio text not null default 'ES-COMUN' references irpf_cat_territorio_fiscal(codigo_territorio),
  clave_situacion char(2) not null default 'ES' references irpf_cat_situacion_bien(clave_situacion),
  fecha_incorporacion date not null,
  clave_origen char(1) not null references irpf_cat_origen_bien(clave_origen),
  fecha_extincion date,
  valoracion_1_eur numeric(15, 2) not null default 0,
  valoracion_2_eur numeric(15, 2),
  porcentaje_participacion numeric(5, 2) not null default 100.00,
  currency text,
  denominacion_entidad text,
  descripcion_activo text,
  domicilio_via text,
  domicilio_complemento text,
  domicilio_poblacion text,
  domicilio_region text,
  domicilio_codigo_postal text,
  domicilio_pais char(2),
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_irpf_asset_registry_subclave
    foreign key (clave_tipo_bien, subclave)
    references irpf_cat_subclave_bien(clave_tipo_bien, subclave),
  constraint chk_irpf_asset_registry_condition_8
    check (clave_condicion <> '8' or tipo_titularidad is not null),
  constraint chk_irpf_asset_registry_country_format
    check (codigo_pais ~ '^[A-Z]{2}$'),
  constraint chk_irpf_asset_registry_address_country_format
    check (domicilio_pais is null or domicilio_pais ~ '^[A-Z]{2}$'),
  constraint chk_irpf_asset_registry_situacion_es
    check ((clave_situacion = 'ES' and codigo_pais = 'ES') or clave_situacion <> 'ES'),
  constraint chk_irpf_asset_registry_situacion_ex
    check ((clave_situacion = 'EX' and codigo_pais <> 'ES') or clave_situacion <> 'EX'),
  constraint chk_irpf_asset_registry_porcentaje
    check (porcentaje_participacion >= 0 and porcentaje_participacion <= 100),
  constraint chk_irpf_asset_registry_extincion
    check (
      (clave_origen = 'C' and fecha_extincion is not null)
      or (clave_origen <> 'C' and fecha_extincion is null)
    ),
  constraint chk_irpf_asset_registry_asset_mapping
    check (
      (asset_class = 'ACCOUNT' and clave_tipo_bien = 'C')
      or (asset_class = 'SECURITY' and clave_tipo_bien = 'V')
      or (asset_class = 'COLLECTIVE_INVESTMENT' and clave_tipo_bien = 'I')
      or (asset_class = 'INSURANCE' and clave_tipo_bien = 'S')
      or (asset_class = 'REAL_ESTATE' and clave_tipo_bien = 'B')
      or (asset_class = 'MOVABLE_ASSET' and clave_tipo_bien = 'M')
    )
);

create table if not exists irpf_asset_accounts (
  asset_id uuid primary key references irpf_asset_registry(id) on delete cascade,
  clave_identif_cuenta char(1) not null check (clave_identif_cuenta in ('I', 'O')),
  codigo_bic text,
  codigo_cuenta text not null,
  nif_entidad_pais text
);

create table if not exists irpf_asset_securities (
  asset_id uuid primary key references irpf_asset_registry(id) on delete cascade,
  clave_identificacion char(1) not null references irpf_cat_clave_identificacion(clave_identificacion),
  identificacion_valores text not null,
  nif_entidad_pais text,
  clave_representacion char(1) not null references irpf_cat_clave_representacion(clave_representacion),
  numero_valores numeric(20, 4) not null,
  is_listed boolean not null default true,
  is_regulated boolean not null default true
);

create table if not exists irpf_asset_collective_investments (
  asset_id uuid primary key references irpf_asset_registry(id) on delete cascade,
  clave_identificacion char(1) not null references irpf_cat_clave_identificacion(clave_identificacion),
  identificacion_valores text not null,
  nif_entidad_pais text,
  clave_representacion char(1) not null references irpf_cat_clave_representacion(clave_representacion),
  numero_valores numeric(20, 4) not null,
  is_regulated boolean not null default true
);

create table if not exists irpf_asset_insurances (
  asset_id uuid primary key references irpf_asset_registry(id) on delete cascade,
  insurance_kind text not null check (
    insurance_kind in ('LIFE', 'DISABILITY', 'TEMPORARY_ANNUITY', 'LIFETIME_ANNUITY')
  ),
  nif_entidad_pais text
);

create table if not exists irpf_asset_real_estate (
  asset_id uuid primary key references irpf_asset_registry(id) on delete cascade,
  tipo_derecho_real_id bigint references irpf_cat_tipo_derecho_real(id),
  clave_tipo_inmueble char(1) not null references irpf_cat_tipo_inmueble(clave_tipo_inmueble),
  referencia_catastral text
);

create table if not exists irpf_asset_movable_goods (
  asset_id uuid primary key references irpf_asset_registry(id) on delete cascade,
  clave_tipo_bien_mueble text not null references irpf_cat_tipo_bien_mueble(clave_tipo_bien_mueble),
  referencia_registro text,
  metodo_valoracion text
);

create table if not exists irpf_asset_fiscal_events (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
  asset_id uuid references irpf_asset_registry(id) on delete set null,
  document_id uuid references irpf_documents(id) on delete set null,
  event_type text not null check (
    event_type in (
      'ACQUISITION',
      'DISPOSAL',
      'INTEREST',
      'DIVIDEND',
      'RENT',
      'WITHHOLDING',
      'GAIN',
      'LOSS',
      'ADJUSTMENT'
    )
  ),
  event_date date not null,
  quantity numeric(20, 6),
  gross_amount_eur numeric(15, 2),
  net_amount_eur numeric(15, 2),
  withholding_amount_eur numeric(15, 2),
  proceeds_amount_eur numeric(15, 2),
  cost_basis_amount_eur numeric(15, 2),
  realized_result_eur numeric(15, 2),
  currency text,
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL', 'IMPORTACION_EXCEL', 'RUNTIME')),
  origin_trace jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_irpf_declaration_profiles_client_year
  on irpf_declaration_profiles (client_id, fiscal_year);

create index if not exists idx_irpf_asset_registry_expediente
  on irpf_asset_registry (expediente_id, clave_tipo_bien, clave_situacion);

create index if not exists idx_irpf_asset_registry_country
  on irpf_asset_registry (codigo_pais, clave_situacion, fecha_incorporacion);

create index if not exists idx_irpf_asset_events_expediente_date
  on irpf_asset_fiscal_events (expediente_id, event_date desc);

create index if not exists idx_irpf_asset_events_asset_date
  on irpf_asset_fiscal_events (asset_id, event_date desc);

drop trigger if exists tr_irpf_declaration_profiles_updated_at on irpf_declaration_profiles;
create trigger tr_irpf_declaration_profiles_updated_at before update on irpf_declaration_profiles
for each row execute function set_updated_at();

drop trigger if exists tr_irpf_asset_registry_updated_at on irpf_asset_registry;
create trigger tr_irpf_asset_registry_updated_at before update on irpf_asset_registry
for each row execute function set_updated_at();

drop trigger if exists tr_irpf_asset_fiscal_events_updated_at on irpf_asset_fiscal_events;
create trigger tr_irpf_asset_fiscal_events_updated_at before update on irpf_asset_fiscal_events
for each row execute function set_updated_at();

create or replace function set_irpf_asset_location_default()
returns trigger as $$
begin
  if new.clave_situacion is null then
    select profile.default_asset_location_key
      into new.clave_situacion
      from irpf_declaration_profiles as profile
     where profile.id = new.declaration_profile_id;

    if new.clave_situacion is null then
      new.clave_situacion := 'ES';
    end if;
  end if;

  if new.client_id is null then
    select expediente.client_id
      into new.client_id
      from irpf_expedientes as expediente
     where expediente.id = new.expediente_id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_irpf_asset_registry_defaults on irpf_asset_registry;
create trigger tr_irpf_asset_registry_defaults
before insert on irpf_asset_registry
for each row execute function set_irpf_asset_location_default();

insert into irpf_asset_fiscal_events (
  expediente_id,
  asset_id,
  document_id,
  event_type,
  event_date,
  quantity,
  gross_amount_eur,
  net_amount_eur,
  withholding_amount_eur,
  proceeds_amount_eur,
  realized_result_eur,
  currency,
  source,
  origin_trace,
  notes
)
select
  operation.expediente_id,
  null,
  operation.document_id,
  case operation.operation_type
    when 'COMPRA' then 'ACQUISITION'
    when 'VENTA' then 'DISPOSAL'
    when 'DIVIDENDO' then 'DIVIDEND'
    when 'INTERES' then 'INTEREST'
    when 'AJUSTE' then 'ADJUSTMENT'
    else 'ADJUSTMENT'
  end,
  operation.operation_date,
  operation.quantity,
  case when operation.operation_type in ('DIVIDENDO', 'INTERES') then operation.amount end,
  operation.amount,
  operation.retention,
  case when operation.operation_type = 'VENTA' then operation.amount end,
  operation.realized_gain,
  operation.currency,
  operation.source,
  jsonb_build_object(
    'migrated_from', 'irpf_operations',
    'operation_id', operation.id,
    'operation_type', operation.operation_type
  ) || coalesce(operation.origin_trace, '{}'::jsonb),
  operation.manual_notes
from irpf_operations as operation
where operation.operation_type in ('COMPRA', 'VENTA', 'DIVIDENDO', 'INTERES', 'AJUSTE')
  and not exists (
    select 1
    from irpf_asset_fiscal_events as event
    where event.origin_trace ->> 'operation_id' = operation.id::text
  );
