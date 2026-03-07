create table if not exists irpf_sale_allocations (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
  sale_operation_id uuid not null references irpf_operations(id) on delete cascade,
  lot_id uuid not null references irpf_lots(id) on delete cascade,
  acquisition_operation_id uuid references irpf_operations(id) on delete set null,
  isin text not null,
  sale_date date not null,
  acquisition_date date not null,
  quantity numeric(18,6) not null,
  sale_unit_price numeric(18,8),
  sale_amount_allocated numeric(18,4),
  unit_cost numeric(18,8),
  total_cost numeric(18,4),
  realized_gain numeric(18,4),
  currency text,
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL', 'IMPORTACION_EXCEL')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_irpf_sale_allocations_sale on irpf_sale_allocations (sale_operation_id);
create index if not exists idx_irpf_sale_allocations_expediente on irpf_sale_allocations (expediente_id, sale_date);
create index if not exists idx_irpf_sale_allocations_lot on irpf_sale_allocations (lot_id);

drop trigger if exists tr_irpf_sale_allocations_updated_at on irpf_sale_allocations;

create trigger tr_irpf_sale_allocations_updated_at before update on irpf_sale_allocations
for each row execute function set_updated_at();
