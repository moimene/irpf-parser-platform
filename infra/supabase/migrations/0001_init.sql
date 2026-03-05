create extension if not exists pgcrypto;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  nif text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nif)
);

create table if not exists expedientes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  fiscal_year int not null,
  model_type text not null check (model_type in ('IRPF', 'IP', '720')),
  title text not null,
  status text not null default 'BORRADOR' check (status in ('BORRADOR', 'EN_REVISION', 'VALIDADO', 'PRESENTADO', 'MODIFICADO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key,
  expediente_id uuid not null references expedientes(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  filename text not null,
  storage_path text,
  source_type text not null default 'PDF' check (source_type in ('PDF', 'IMAGE', 'CSV', 'XLSX')),
  entity text,
  detected_template text,
  processing_status text not null default 'queued' check (processing_status in ('queued', 'processing', 'completed', 'manual_review', 'failed')),
  confidence numeric(5,4),
  manual_review_required boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists extractions (
  id uuid primary key,
  document_id uuid not null references documents(id) on delete cascade,
  version int not null default 1,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  requires_manual_review boolean not null default false,
  review_status text not null default 'pending' check (review_status in ('pending', 'validated', 'rejected', 'not_required')),
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now()
);

create table if not exists operations (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references expedientes(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,
  operation_type text not null check (operation_type in ('DIVIDENDO', 'INTERES', 'COMPRA', 'VENTA', 'AJUSTE')),
  operation_date date not null,
  settlement_date date,
  instrument_name text,
  isin text,
  quantity numeric(18,6),
  gross_amount numeric(18,4),
  withholding_amount numeric(18,4),
  net_amount numeric(18,4),
  currency text,
  fx_rate_to_eur numeric(18,8),
  amount_eur numeric(18,4),
  cost_basis numeric(18,4),
  proceeds numeric(18,4),
  realized_gain numeric(18,4),
  holding_period text check (holding_period in ('SHORT', 'LONG')),
  disposition_method text,
  is_blocked_loss boolean not null default false,
  block_chain_id uuid,
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL', 'IMPORTACION_EXCEL')),
  confidence numeric(5,4),
  origin_trace jsonb not null default '{}'::jsonb,
  manual_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references expedientes(id) on delete cascade,
  instrument_name text,
  isin text,
  acquisition_date date not null,
  quantity numeric(18,6) not null,
  unit_cost numeric(18,6),
  total_cost numeric(18,4),
  currency text,
  acquisition_origin text not null default 'COMPRA' check (acquisition_origin in ('COMPRA', 'HERENCIA', 'DONACION', 'TRANSFERENCIA')),
  inheritance_nif text,
  inheritance_reference text,
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL', 'IMPORTACION_EXCEL')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references expedientes(id) on delete cascade,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  category text not null,
  message text not null,
  entity_type text,
  entity_id uuid,
  status text not null default 'open' check (status in ('open', 'reviewed', 'ignored', 'resolved')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create table if not exists exports (
  id uuid primary key,
  expediente_id uuid not null references expedientes(id) on delete cascade,
  model text not null check (model in ('100', '714', '720')),
  status text not null check (status in ('draft', 'ready', 'generated', 'failed')),
  validation_state text not null check (validation_state in ('ok', 'warnings', 'errors')),
  artifact_path text not null,
  artifact_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  generated_by text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists template_versions (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null,
  template_code text not null,
  version int not null,
  status text not null default 'beta' check (status in ('beta', 'active', 'deprecated')),
  definition jsonb not null,
  precision_30d numeric(5,4),
  created_by text,
  created_at timestamptz not null default now(),
  unique (entity_name, template_code, version)
);

create table if not exists rule_configs (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  description text,
  is_active boolean not null default true,
  scope text not null default 'global' check (scope in ('global', 'expediente')),
  expediente_id uuid references expedientes(id) on delete cascade,
  config jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  expediente_id uuid references expedientes(id) on delete cascade,
  user_id text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_documents_expediente_status on documents (expediente_id, processing_status);
create index if not exists idx_operations_expediente_date on operations (expediente_id, operation_date);
create index if not exists idx_operations_isin_date on operations (isin, operation_date);
create index if not exists idx_lots_expediente_isin on lots (expediente_id, isin);
create index if not exists idx_alerts_expediente_status on alerts (expediente_id, status);
create index if not exists idx_exports_expediente_model on exports (expediente_id, model);
create index if not exists idx_audit_expediente_created on audit_log (expediente_id, created_at desc);
create unique index if not exists idx_rule_configs_unique_scope
  on rule_configs (rule_key, coalesce(expediente_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tr_clients_updated_at before update on clients
for each row execute function set_updated_at();

create trigger tr_expedientes_updated_at before update on expedientes
for each row execute function set_updated_at();

create trigger tr_documents_updated_at before update on documents
for each row execute function set_updated_at();

create trigger tr_operations_updated_at before update on operations
for each row execute function set_updated_at();

create trigger tr_lots_updated_at before update on lots
for each row execute function set_updated_at();

create trigger tr_exports_updated_at before update on exports
for each row execute function set_updated_at();

insert into rule_configs (rule_key, description, config)
values
  ('recompra_windows', 'Configuracion ventanas recompra 2/12 meses', '{"listed_months":2,"unlisted_months":12,"action":"block"}'::jsonb),
  ('fifo_validation', 'Validacion FIFO frente a extractos de entidad', '{"enabled":true,"allow_manual_override":true}'::jsonb),
  ('fx_conversion', 'Conversion oficial BOE para IP/IRPF', '{"source":"BOE","fallback":"manual"}'::jsonb)
on conflict do nothing;
