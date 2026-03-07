alter table if exists irpf_operations
  add column if not exists description text,
  add column if not exists amount numeric(18,4),
  add column if not exists currency text,
  add column if not exists retention numeric(18,4);

alter table if exists irpf_operations
  drop constraint if exists irpf_operations_operation_type_check;

alter table if exists irpf_operations
  add constraint irpf_operations_operation_type_check
  check (operation_type in ('DIVIDENDO', 'INTERES', 'COMPRA', 'VENTA', 'POSICION', 'AJUSTE'));

alter table if exists irpf_operations
  drop constraint if exists irpf_operations_source_check;

alter table if exists irpf_operations
  add constraint irpf_operations_source_check
  check (source in ('AUTO', 'MANUAL', 'IMPORTACION_EXCEL'));
