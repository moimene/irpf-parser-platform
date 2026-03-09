create table if not exists irpf_expediente_workflow (
  expediente_id uuid primary key references irpf_expedientes(id) on delete cascade,
  documental_status text not null default 'not_started' check (documental_status in ('not_started', 'in_progress', 'blocked', 'ready')),
  revision_status text not null default 'not_started' check (revision_status in ('not_started', 'pending', 'ready')),
  canonical_status text not null default 'not_started' check (canonical_status in ('not_started', 'in_progress', 'ready', 'approved')),
  declarative_status text not null default 'blocked' check (declarative_status in ('blocked', 'ready', 'prepared')),
  filing_status text not null default 'draft' check (filing_status in ('draft', 'ready', 'filed')),
  canonical_approval_status text not null default 'draft' check (canonical_approval_status in ('draft', 'reviewed', 'approved')),
  workflow_owner_ref text,
  workflow_owner_name text,
  pending_task text,
  pending_reason text,
  workflow_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_irpf_expediente_workflow_owner
  on irpf_expediente_workflow (workflow_owner_ref);

drop trigger if exists tr_irpf_expediente_workflow_updated_at on irpf_expediente_workflow;
create trigger tr_irpf_expediente_workflow_updated_at before update on irpf_expediente_workflow
for each row execute function set_updated_at();

insert into irpf_expediente_workflow (
  expediente_id,
  documental_status,
  revision_status,
  canonical_status,
  declarative_status,
  filing_status,
  canonical_approval_status,
  workflow_updated_at
)
select
  e.id,
  'not_started',
  'not_started',
  'not_started',
  'blocked',
  case when e.status = 'PRESENTADO' then 'filed' else 'draft' end,
  case when e.status in ('VALIDADO', 'PRESENTADO') then 'approved' else 'draft' end,
  now()
from irpf_expedientes e
on conflict (expediente_id) do nothing;
