create table if not exists irpf_assets (
  id uuid primary key,
  client_id uuid not null references irpf_clients(id) on delete cascade,
  asset_key text not null,
  isin text,
  label text not null,
  currencies jsonb not null default '[]'::jsonb,
  expedientes jsonb not null default '[]'::jsonb,
  fiscal_years jsonb not null default '[]'::jsonb,
  events_total integer not null default 0,
  dividends integer not null default 0,
  interests integer not null default 0,
  acquisitions integer not null default 0,
  transmissions integer not null default 0,
  retentions integer not null default 0,
  gains_losses integer not null default 0,
  open_lots integer not null default 0,
  closed_lots integer not null default 0,
  quantity_open numeric(18,6),
  open_cost_basis numeric(18,4),
  gross_amount_total numeric(18,4),
  realized_gain_total numeric(18,4),
  pending_transmissions integer not null default 0,
  latest_event_date date,
  last_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_irpf_assets_client_asset_key unique (client_id, asset_key)
);

create index if not exists idx_irpf_assets_client_latest_event
  on irpf_assets (client_id, latest_event_date desc);

create index if not exists idx_irpf_assets_client_isin
  on irpf_assets (client_id, isin);

drop trigger if exists tr_irpf_assets_updated_at on irpf_assets;

create trigger tr_irpf_assets_updated_at before update on irpf_assets
for each row execute function set_updated_at();

create table if not exists irpf_fiscal_events (
  id uuid primary key,
  client_id uuid not null references irpf_clients(id) on delete cascade,
  expediente_id uuid not null references irpf_expedientes(id) on delete cascade,
  asset_id uuid references irpf_assets(id) on delete set null,
  asset_key text not null,
  source_event_id text not null,
  asset_label text not null,
  isin text,
  event_kind text not null check (
    event_kind in (
      'dividendo',
      'interes',
      'adquisicion',
      'transmision',
      'retencion',
      'ganancia_perdida',
      'posicion'
    )
  ),
  operation_type text not null,
  operation_date date not null,
  description text,
  amount numeric(18,4),
  currency text,
  quantity numeric(18,6),
  retention numeric(18,4),
  realized_gain numeric(18,4),
  source text not null,
  status text not null check (
    status in ('RECORDED', 'MATCHED', 'UNRESOLVED', 'PENDING_COST_BASIS', 'INVALID_DATA')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_irpf_fiscal_events_expediente_source unique (expediente_id, source_event_id)
);

create index if not exists idx_irpf_fiscal_events_client_date
  on irpf_fiscal_events (client_id, operation_date desc);

create index if not exists idx_irpf_fiscal_events_expediente_date
  on irpf_fiscal_events (expediente_id, operation_date desc);

create index if not exists idx_irpf_fiscal_events_asset
  on irpf_fiscal_events (asset_id, operation_date desc);

drop trigger if exists tr_irpf_fiscal_events_updated_at on irpf_fiscal_events;

create trigger tr_irpf_fiscal_events_updated_at before update on irpf_fiscal_events
for each row execute function set_updated_at();
