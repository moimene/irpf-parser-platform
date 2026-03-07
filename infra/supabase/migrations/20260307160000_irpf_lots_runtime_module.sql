create table if not exists irpf_lots (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
  acquisition_operation_id uuid references irpf_operations(id) on delete set null,
  isin text not null,
  description text,
  acquisition_date date not null,
  quantity_original numeric(18,6) not null,
  quantity_open numeric(18,6) not null,
  quantity_sold numeric(18,6) not null default 0,
  unit_cost numeric(18,8),
  total_cost numeric(18,4),
  currency text,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL', 'IMPORTACION_EXCEL')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_irpf_lots_expediente_date on irpf_lots (expediente_id, acquisition_date);
create index if not exists idx_irpf_lots_expediente_isin on irpf_lots (expediente_id, isin);

drop trigger if exists tr_irpf_lots_updated_at on irpf_lots;

create trigger tr_irpf_lots_updated_at before update on irpf_lots
for each row execute function set_updated_at();
