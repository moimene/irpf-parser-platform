create table if not exists irpf_fiscal_adjustments (
  id uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('COST_BASIS', 'INHERITANCE', 'TRANSFER_IN', 'TRANSFER_OUT')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  target_operation_id uuid references irpf_operations(id) on delete set null,
  operation_date date not null,
  isin text,
  description text,
  quantity numeric(18,6),
  total_amount numeric(18,4),
  currency text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_irpf_fiscal_adjustments_expediente_date
  on irpf_fiscal_adjustments (expediente_id, operation_date);

create index if not exists idx_irpf_fiscal_adjustments_status
  on irpf_fiscal_adjustments (expediente_id, status);

create index if not exists idx_irpf_fiscal_adjustments_target
  on irpf_fiscal_adjustments (target_operation_id);

drop trigger if exists tr_irpf_fiscal_adjustments_updated_at on irpf_fiscal_adjustments;

create trigger tr_irpf_fiscal_adjustments_updated_at before update on irpf_fiscal_adjustments
for each row execute function set_updated_at();
