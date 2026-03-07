create table if not exists irpf_cat_capital_operation_types (
  codigo_tipo_operacion text primary key,
  descripcion text not null,
  grupo_irpf text not null check (grupo_irpf in ('RCM', 'GYP', 'OTRO')),
  subgrupo_irpf text not null,
  clave_tipo_bien char(1) references irpf_cat_tipo_bien(clave_tipo_bien) on update cascade on delete set null,
  requires_quantity_price boolean not null default false,
  requires_positive_gross boolean not null default false
);

insert into irpf_cat_capital_operation_types (
  codigo_tipo_operacion,
  descripcion,
  grupo_irpf,
  subgrupo_irpf,
  clave_tipo_bien,
  requires_quantity_price,
  requires_positive_gross
)
values
  ('DIVIDENDO_ACCION', 'Dividendo procedente de acciones o valores cotizados', 'RCM', 'DIVIDENDOS', 'V', false, true),
  ('DIVIDENDO_FONDO', 'Dividendo o reparto procedente de IIC', 'RCM', 'DIVIDENDOS', 'I', false, true),
  ('INTERES_CUENTA', 'Interes abonado en cuenta bancaria o crediticia', 'RCM', 'INTERESES', 'C', false, true),
  ('INTERES_BONO', 'Interes devengado por valor representativo de deuda', 'RCM', 'INTERESES', 'V', false, true),
  ('CUPON_BONO', 'Cupon abonado por bono u obligacion', 'RCM', 'INTERESES', 'V', false, true),
  ('REND_SEGURO_VIDA', 'Rendimiento procedente de seguro de vida o invalidez', 'RCM', 'SEGUROS', 'S', false, true),
  ('RENTA_VITALICIA', 'Renta temporal o vitalicia', 'RCM', 'RENTAS', 'S', false, true),
  ('COMPRA_VALOR', 'Compra de acciones, participaciones societarias o valores', 'GYP', 'ACCIONES', 'V', true, false),
  ('VENTA_VALOR', 'Venta de acciones, participaciones societarias o valores', 'GYP', 'ACCIONES', 'V', true, false),
  ('COMPRA_FONDO', 'Suscripcion o compra de participaciones en IIC', 'GYP', 'FONDOS', 'I', true, false),
  ('VENTA_FONDO', 'Reembolso o venta de participaciones en IIC', 'GYP', 'FONDOS', 'I', true, false),
  ('ALQUILER_INMUEBLE', 'Renta procedente de inmueble o derecho real', 'RCM', 'INMUEBLES', 'B', false, true),
  ('COMPRA_INMUEBLE', 'Adquisicion de inmueble', 'GYP', 'INMUEBLES', 'B', false, false),
  ('VENTA_INMUEBLE', 'Transmision de inmueble', 'GYP', 'INMUEBLES', 'B', false, false),
  ('COMPRA_BIEN_MUEBLE', 'Adquisicion de bien mueble', 'GYP', 'BIENES_MUEBLES', 'M', false, false),
  ('VENTA_BIEN_MUEBLE', 'Transmision de bien mueble', 'GYP', 'BIENES_MUEBLES', 'M', false, false),
  ('RETENCION_MANUAL', 'Retencion a cuenta registrada de forma explicita', 'RCM', 'RETENCIONES', null, false, false),
  ('OTRO_MOVIMIENTO', 'Movimiento patrimonial pendiente de clasificacion', 'OTRO', 'OTRO', null, false, false)
on conflict (codigo_tipo_operacion) do update set
  descripcion = excluded.descripcion,
  grupo_irpf = excluded.grupo_irpf,
  subgrupo_irpf = excluded.subgrupo_irpf,
  clave_tipo_bien = excluded.clave_tipo_bien,
  requires_quantity_price = excluded.requires_quantity_price,
  requires_positive_gross = excluded.requires_positive_gross;

alter table irpf_asset_fiscal_events
  add column if not exists capital_operation_key text references irpf_cat_capital_operation_types(codigo_tipo_operacion) on update cascade on delete restrict,
  add column if not exists irpf_group text,
  add column if not exists irpf_subgroup text,
  add column if not exists expense_amount_eur numeric(15, 2),
  add column if not exists original_currency char(3),
  add column if not exists gross_amount_original numeric(17, 4),
  add column if not exists fx_rate numeric(17, 8),
  add column if not exists unit_price_eur numeric(17, 8),
  add column if not exists is_closing_operation boolean not null default false,
  add column if not exists is_stock_dividend boolean not null default false,
  add column if not exists irpf_box_code text;

create or replace function irpf_default_capital_operation_key(
  p_event_type text,
  p_asset_key char(1)
)
returns text as $$
begin
  case p_event_type
    when 'ACQUISITION' then
      case p_asset_key
        when 'I' then return 'COMPRA_FONDO';
        when 'B' then return 'COMPRA_INMUEBLE';
        when 'M' then return 'COMPRA_BIEN_MUEBLE';
        else return 'COMPRA_VALOR';
      end case;
    when 'DISPOSAL' then
      case p_asset_key
        when 'I' then return 'VENTA_FONDO';
        when 'B' then return 'VENTA_INMUEBLE';
        when 'M' then return 'VENTA_BIEN_MUEBLE';
        else return 'VENTA_VALOR';
      end case;
    when 'DIVIDEND' then
      case p_asset_key
        when 'I' then return 'DIVIDENDO_FONDO';
        else return 'DIVIDENDO_ACCION';
      end case;
    when 'INTEREST' then
      case p_asset_key
        when 'V' then return 'INTERES_BONO';
        else return 'INTERES_CUENTA';
      end case;
    when 'RENT' then
      case p_asset_key
        when 'S' then return 'RENTA_VITALICIA';
        when 'B' then return 'ALQUILER_INMUEBLE';
        else return 'OTRO_MOVIMIENTO';
      end case;
    when 'WITHHOLDING' then
      return 'RETENCION_MANUAL';
    else
      return 'OTRO_MOVIMIENTO';
  end case;
end;
$$ language plpgsql immutable;

create or replace function set_irpf_asset_fiscal_event_capital_defaults()
returns trigger as $$
declare
  expected_asset_key char(1);
  actual_asset_key char(1);
  next_group text;
  next_subgroup text;
  needs_quantity_price boolean;
  needs_positive_gross boolean;
begin
  if new.asset_id is not null then
    select asset.clave_tipo_bien
      into actual_asset_key
      from irpf_asset_registry as asset
     where asset.id = new.asset_id;

    if actual_asset_key is null then
      raise exception 'Activo % no encontrado para evento fiscal', new.asset_id;
    end if;
  end if;

  if new.capital_operation_key is null then
    new.capital_operation_key := irpf_default_capital_operation_key(new.event_type, actual_asset_key);
  end if;

  if new.capital_operation_key is not null then
    select
      cat.grupo_irpf,
      cat.subgrupo_irpf,
      cat.clave_tipo_bien,
      cat.requires_quantity_price,
      cat.requires_positive_gross
      into next_group,
           next_subgroup,
           expected_asset_key,
           needs_quantity_price,
           needs_positive_gross
      from irpf_cat_capital_operation_types as cat
     where cat.codigo_tipo_operacion = new.capital_operation_key;

    if next_group is null then
      raise exception 'Codigo de operacion % no reconocido', new.capital_operation_key;
    end if;

    new.irpf_group := next_group;
    new.irpf_subgroup := next_subgroup;

    if actual_asset_key is not null and expected_asset_key is not null and actual_asset_key <> expected_asset_key then
      raise exception
        'Operacion % incompatible con tipo de bien %',
        new.capital_operation_key,
        actual_asset_key;
    end if;

    if needs_quantity_price and (
      new.quantity is null
      or new.quantity <= 0
      or new.unit_price_eur is null
      or new.unit_price_eur <= 0
    ) then
      raise exception
        'Operacion % requiere quantity y unit_price_eur positivos',
        new.capital_operation_key;
    end if;

    if needs_positive_gross and (new.gross_amount_eur is null or new.gross_amount_eur <= 0) then
      raise exception
        'Operacion % requiere gross_amount_eur positivo',
        new.capital_operation_key;
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_irpf_asset_fiscal_events_capital_defaults on irpf_asset_fiscal_events;
create trigger tr_irpf_asset_fiscal_events_capital_defaults
before insert or update on irpf_asset_fiscal_events
for each row execute function set_irpf_asset_fiscal_event_capital_defaults();

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'chk_irpf_asset_fiscal_events_irpf_group'
  ) then
    alter table irpf_asset_fiscal_events
      add constraint chk_irpf_asset_fiscal_events_irpf_group
      check (irpf_group is null or irpf_group in ('RCM', 'GYP', 'OTRO'));
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'chk_irpf_asset_fiscal_events_amounts'
  ) then
    alter table irpf_asset_fiscal_events
      add constraint chk_irpf_asset_fiscal_events_amounts
      check (
        (gross_amount_eur is null or gross_amount_eur >= 0)
        and (net_amount_eur is null or net_amount_eur >= 0)
        and (withholding_amount_eur is null or withholding_amount_eur >= 0)
        and (proceeds_amount_eur is null or proceeds_amount_eur >= 0)
        and (cost_basis_amount_eur is null or cost_basis_amount_eur >= 0)
        and (expense_amount_eur is null or expense_amount_eur >= 0)
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'chk_irpf_asset_fiscal_events_position_detail'
  ) then
    alter table irpf_asset_fiscal_events
      add constraint chk_irpf_asset_fiscal_events_position_detail
      check (
        (quantity is null or quantity > 0)
        and (unit_price_eur is null or unit_price_eur > 0)
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'chk_irpf_asset_fiscal_events_original_amount'
  ) then
    alter table irpf_asset_fiscal_events
      add constraint chk_irpf_asset_fiscal_events_original_amount
      check (
        (
          original_currency is null
          and gross_amount_original is null
          and fx_rate is null
        )
        or (
          original_currency is not null
          and gross_amount_original is not null
          and fx_rate is not null
          and fx_rate > 0
        )
      );
  end if;
end
$$;

create index if not exists idx_irpf_asset_events_capital_operation
  on irpf_asset_fiscal_events (capital_operation_key, event_date desc);

with inferred as (
  select
    event.id,
    coalesce(
      event.capital_operation_key,
      irpf_default_capital_operation_key(event.event_type, asset.clave_tipo_bien)
    ) as capital_operation_key
  from irpf_asset_fiscal_events as event
  left join irpf_asset_registry as asset
    on asset.id = event.asset_id
)
update irpf_asset_fiscal_events as event
   set capital_operation_key = inferred.capital_operation_key,
       irpf_group = cat.grupo_irpf,
       irpf_subgroup = cat.subgrupo_irpf,
       expense_amount_eur = coalesce(event.expense_amount_eur, 0),
       is_closing_operation = coalesce(event.is_closing_operation, false),
       is_stock_dividend = coalesce(event.is_stock_dividend, false)
  from inferred
  left join irpf_cat_capital_operation_types as cat
    on cat.codigo_tipo_operacion = inferred.capital_operation_key
 where inferred.id = event.id;

insert into irpf_cat_tipo_bien_mueble (clave_tipo_bien_mueble, descripcion)
values
  ('COLLECTION', 'Coleccion'),
  ('ADMINISTRATIVE_CONCESSION', 'Concesion administrativa'),
  ('CONTRACT_OPTION', 'Opcion contractual'),
  ('INTELLECTUAL_PROPERTY', 'Derecho de propiedad industrial o intelectual'),
  ('REGISTERED_MOVABLE', 'Bien mueble matriculado'),
  ('LOCATED_MOVABLE', 'Bien mueble situado')
on conflict (clave_tipo_bien_mueble) do update set
  descripcion = excluded.descripcion;
