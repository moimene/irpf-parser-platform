create extension if not exists pgcrypto;

create table if not exists irpf_expedientes (
  id uuid primary key,
  reference text not null unique,
  client_id uuid,
  fiscal_year int not null,
  model_type text not null check (model_type in ('IRPF', 'IP', '720')),
  title text not null,
  status text not null default 'BORRADOR' check (status in ('BORRADOR', 'EN_REVISION', 'VALIDADO', 'PRESENTADO', 'MODIFICADO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists irpf_documents (
  id uuid primary key,
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
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

create table if not exists irpf_extractions (
  id uuid primary key,
  document_id uuid not null references irpf_documents(id) on delete cascade,
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

create table if not exists irpf_operations (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
  document_id uuid references irpf_documents(id) on delete set null,
  operation_type text not null check (operation_type in ('DIVIDENDO', 'INTERES', 'COMPRA', 'VENTA', 'AJUSTE')),
  operation_date date not null,
  isin text,
  quantity numeric(18,6),
  realized_gain numeric(18,4),
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL', 'IMPORTACION_EXCEL')),
  confidence numeric(5,4),
  origin_trace jsonb not null default '{}'::jsonb,
  manual_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists irpf_alerts (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
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

create table if not exists irpf_exports (
  id uuid primary key,
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
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

create table if not exists irpf_audit_log (
  id bigserial primary key,
  expediente_id uuid references irpf_expedientes(id) on delete cascade,
  user_id text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_irpf_documents_expediente_status on irpf_documents (expediente_id, processing_status);
create index if not exists idx_irpf_alerts_expediente_status on irpf_alerts (expediente_id, status);
create index if not exists idx_irpf_exports_expediente_model on irpf_exports (expediente_id, model);
create index if not exists idx_irpf_audit_expediente_created on irpf_audit_log (expediente_id, created_at desc);
create index if not exists idx_irpf_ops_expediente_date on irpf_operations (expediente_id, operation_date);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tr_irpf_expedientes_updated_at before update on irpf_expedientes
for each row execute function set_updated_at();

create trigger tr_irpf_documents_updated_at before update on irpf_documents
for each row execute function set_updated_at();

create trigger tr_irpf_operations_updated_at before update on irpf_operations
for each row execute function set_updated_at();

create trigger tr_irpf_exports_updated_at before update on irpf_exports
for each row execute function set_updated_at();
