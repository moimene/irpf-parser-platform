-- ============================================================
-- Migración: Plataforma multi-cliente — Patrimonio & Entidades
-- Fecha: 2026-03-06
-- ============================================================

-- -------------------------------------------------------
-- 1. Categorías patrimoniales (catálogo configurable)
-- -------------------------------------------------------
create table if not exists irpf_categorias_patrimonio (
  id          text primary key,          -- 'inventario', 'goldman', 'citi', etc.
  label       text not null,             -- Nombre visible en la UI
  descripcion text,
  icono       text,                      -- Nombre de icono (sin emoji)
  orden       int  not null default 0,
  activo      boolean not null default true
);

insert into irpf_categorias_patrimonio (id, label, descripcion, orden) values
  ('inventario',    'Inventario / Posiciones',    'Cartera de valores y posiciones por año',          1),
  ('goldman',       'Goldman Sachs',               'Extractos de cuentas Goldman Sachs',               2),
  ('citi',          'Citi Brokerage',              'Extractos Citi y fondos privados',                 3),
  ('jpmorgan',      'J.P. Morgan',                 'Cuentas y extractos J.P. Morgan',                  4),
  ('pictet',        'Pictet',                      'Extractos Pictet & Cie',                           5),
  ('derivados',     'Derivados / Forwards',        'Opciones, futuros y contratos a plazo',            6),
  ('inmuebles',     'Inmuebles',                   'Propiedades inmobiliarias y gastos asociados',     7),
  ('obras_arte',    'Obras de Arte',               'Colección artística con valoración IP',            8),
  ('private_equity','Private Equity',              'Compromisos, distribuciones y valoraciones PE',    9),
  ('tipos_cambio',  'Tipos de Cambio',             'Histórico de tipos USD/EUR y GBP/EUR',            10)
on conflict (id) do nothing;

-- -------------------------------------------------------
-- 2. Tabla de patrimonio histórico (datos del Excel)
-- -------------------------------------------------------
create table if not exists irpf_patrimonio (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references irpf_clients(id) on delete cascade,
  categoria_id    text not null references irpf_categorias_patrimonio(id),
  hoja            text not null,          -- Nombre de la hoja original del Excel
  ejercicio       int,                    -- Año fiscal (puede ser NULL para datos sin año)
  fila            int,                    -- Número de fila original (para trazabilidad)
  datos           jsonb not null,         -- Contenido de la fila como JSON
  fuente          text not null default 'excel_manual',  -- 'excel_manual' | 'parser_pdf' | 'manual'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Índices para rendimiento en tablas grandes
create index if not exists irpf_patrimonio_client_idx    on irpf_patrimonio(client_id);
create index if not exists irpf_patrimonio_categoria_idx on irpf_patrimonio(client_id, categoria_id);
create index if not exists irpf_patrimonio_ejercicio_idx on irpf_patrimonio(client_id, ejercicio);
create index if not exists irpf_patrimonio_datos_idx     on irpf_patrimonio using gin(datos);

-- -------------------------------------------------------
-- 3. Tabla de hojas por categoría (metadatos de navegación)
-- -------------------------------------------------------
create table if not exists irpf_hojas (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references irpf_clients(id) on delete cascade,
  categoria_id    text not null references irpf_categorias_patrimonio(id),
  nombre          text not null,          -- Nombre de la hoja
  ejercicio       int,
  num_filas       int  not null default 0,
  columnas        jsonb,                  -- Array de nombres de columna
  kpis            jsonb,                  -- KPIs precalculados {label, value, format}
  created_at      timestamptz not null default now(),
  unique (client_id, categoria_id, nombre)
);

-- -------------------------------------------------------
-- 4. Entity templates (parser configurable)
-- -------------------------------------------------------
create table if not exists irpf_entity_templates (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique,   -- 'Pictet', 'Goldman Sachs', 'Citi', etc.
  codigo          text not null unique,   -- 'pictet', 'goldman', 'citi', 'jpmorgan'
  tipo            text not null default 'broker'
                    check (tipo in ('broker', 'banco', 'fondo', 'otro')),
  -- Configuración del extractor
  keywords        text[] not null default '{}',   -- Palabras clave para detección
  nivel_extraccion int not null default 1
                    check (nivel_extraccion in (1, 2, 3)),
  -- Mapeo de columnas: { "campo_interno": "nombre_en_pdf" }
  column_mapping  jsonb not null default '{}',
  -- Patrones regex para extracción de campos clave
  patterns        jsonb not null default '{}',
  -- Configuración de tablas pdfplumber
  table_settings  jsonb not null default '{}',
  activo          boolean not null default true,
  creado_por      uuid references irpf_abogados(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Insertar las entidades ya implementadas como templates base
insert into irpf_entity_templates
  (nombre, codigo, tipo, keywords, nivel_extraccion, column_mapping, patterns)
values
  (
    'Pictet & Cie', 'pictet', 'broker',
    array['Pictet', 'PICTET', 'Banque Pictet'],
    1,
    '{"isin": "ISIN", "descripcion": "Designation", "cantidad": "Quantity", "precio": "Price", "valor_mercado": "Market Value", "divisa": "Currency"}',
    '{"isin": "[A-Z]{2}[A-Z0-9]{10}", "cuenta": "Account\\s*No\\.?\\s*([\\d\\-]+)"}'
  ),
  (
    'Goldman Sachs', 'goldman', 'broker',
    array['Goldman Sachs', 'GOLDMAN SACHS', 'GS Bank'],
    1,
    '{"fecha": "Trade Date", "tipo": "Transaction Type", "descripcion": "Description", "isin": "ISIN/CUSIP", "cantidad": "Quantity", "precio": "Price", "importe": "Net Amount", "divisa": "Currency"}',
    '{"isin": "[A-Z]{2}[A-Z0-9]{10}", "cuenta": "Account\\s*Number[:\\s]+([\\w\\-]+)"}'
  ),
  (
    'Citi', 'citi', 'banco',
    array['Citibank', 'Citi', 'CITI', 'Citigroup'],
    1,
    '{"fecha": "Date", "descripcion": "Description", "importe": "Amount", "saldo": "Balance", "divisa": "Currency"}',
    '{"cuenta": "Account\\s*(?:Number|No\\.?)[:\\s]+([\\d\\-]+)", "isin": "[A-Z]{2}[A-Z0-9]{10}"}'
  ),
  (
    'J.P. Morgan', 'jpmorgan', 'banco',
    array['J.P. Morgan', 'JPMorgan', 'JPMORGAN', 'Chase'],
    1,
    '{"titular": "Account Holder", "iban": "IBAN", "cuenta": "Account Number", "swift": "BIC/SWIFT", "divisa": "Currency", "fecha_apertura": "Date"}',
    '{"iban": "[A-Z]{2}\\d{2}[A-Z0-9]{4}\\d{7}([A-Z0-9]?){0,16}", "swift": "[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?"}'
  )
on conflict (codigo) do nothing;

-- -------------------------------------------------------
-- 5. RLS para las nuevas tablas
-- -------------------------------------------------------
alter table irpf_categorias_patrimonio  enable row level security;
alter table irpf_patrimonio             enable row level security;
alter table irpf_hojas                  enable row level security;
alter table irpf_entity_templates       enable row level security;

-- Categorías: todos los abogados autenticados pueden leer
create policy "abogados_ven_categorias" on irpf_categorias_patrimonio
  for select using (auth.uid() is not null);

-- Solo socios gestionan categorías
create policy "socios_gestionan_categorias" on irpf_categorias_patrimonio
  for all using (
    exists (select 1 from irpf_abogados where id = auth.uid() and rol = 'socio')
  );

-- Patrimonio: acceso según cliente asignado
create policy "abogados_ven_patrimonio" on irpf_patrimonio
  for select using (irpf_tiene_acceso_cliente(client_id));

create policy "abogados_insertan_patrimonio" on irpf_patrimonio
  for insert with check (irpf_tiene_acceso_cliente(client_id));

create policy "abogados_actualizan_patrimonio" on irpf_patrimonio
  for update using (irpf_tiene_acceso_cliente(client_id));

-- Hojas: acceso según cliente asignado
create policy "abogados_ven_hojas" on irpf_hojas
  for select using (irpf_tiene_acceso_cliente(client_id));

create policy "abogados_gestionan_hojas" on irpf_hojas
  for all using (irpf_tiene_acceso_cliente(client_id));

-- Entity templates: todos los abogados ven, socios gestionan
create policy "abogados_ven_templates" on irpf_entity_templates
  for select using (auth.uid() is not null);

create policy "socios_gestionan_templates" on irpf_entity_templates
  for all using (
    exists (select 1 from irpf_abogados where id = auth.uid() and rol = 'socio')
  );

-- -------------------------------------------------------
-- 6. Vista materializada para KPIs del dashboard
-- -------------------------------------------------------
create or replace view irpf_dashboard_stats as
select
  c.id                                          as client_id,
  c.full_name                                   as cliente,
  c.nif,
  count(distinct e.id)                          as num_expedientes,
  count(distinct d.id)                          as num_documentos,
  count(distinct d.id) filter (
    where d.status = 'manual.review.required'
  )                                             as pendientes_revision,
  count(distinct p.id)                          as num_registros_patrimonio,
  max(d.created_at)                             as ultimo_documento,
  count(distinct al.id) filter (
    where al.severity in ('alta', 'critica')
  )                                             as alertas_criticas
from irpf_clients c
left join irpf_expedientes e  on e.client_id = c.id
left join irpf_documents   d  on d.expediente_id = e.id
left join irpf_patrimonio  p  on p.client_id = c.id
left join irpf_alerts      al on al.expediente_id = e.id
group by c.id, c.full_name, c.nif;
