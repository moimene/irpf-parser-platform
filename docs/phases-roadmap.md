# Roadmap por Fases

Referencia de alcance consolidado: `docs/BASELINE_FUNCIONAL_2026-03-06.md`

## Fase 0 Baseline operativa (completada)

- Contratos API estabilizados
- Web, parser y produccion reconciliados con el repo
- Persistencia runtime `irpf_*`
- Flujo critico `ingesta -> parseo -> review -> export`
- E2E productivo del flujo principal

## Fase 1 Operativa de despacho

Completado:

- Modulo real de clientes
- Relacion cliente -> expediente -> modelo -> ejercicio
- Navegacion lateral completa
- Auth real sobre Supabase Auth
- RBAC base por rol y asignacion
- Configuracion y acceso como modulo vivo
- Intake con seleccion explicita de cliente para expedientes no vinculados
- `auth_user_id` persistente
- Migracion a schema moderno sin fallback legacy
- Auditoria funcional de accesos
- Invitaciones y onboarding de usuarios

Fase 1 queda cerrada.

## Fase 2 Modelo fiscal IRPF

Iniciada:

- Persistencia rica de `irpf_operations` con `description`, `amount`, `currency` y `retention`
- Tabla derivada `irpf_lots` recalculada tras intake automatico y review aprobada
- Vista de expediente con tablas de operaciones fiscales y lotes de adquisicion
- Asignaciones `venta -> lote` persistidas en `irpf_sale_allocations`
- Vista de ganancias/perdidas con coste fiscal consumido y cuadre FIFO por venta
- Deteccion y trazabilidad de perdidas bloqueadas por recompra en expediente, alerts y preview del modelo 100
- Validacion de modelo 100 basada en runtime fiscal real, no en `realized_gain` raw del parser
- Ajustes manuales de coste, herencia y transferencia persistidos en runtime y operables desde expediente

Pendiente para cerrar:

- FIFO fiscal completo
- Cierre fiscal explicable y reglas de dominio avanzadas
- Trazabilidad estructurada estable por pagina/tabla/fila/celda o bbox

Fase 2 queda abierta con la primera slice vertical ya operativa.

## Fase 3 Patrimonio e IP

- Base canonica de bienes/derechos y eventos fiscales introducida
- Cuentas financieras y posiciones a cierre
- Tipos de cambio y saldo medio trimestral
- Modulo de patrimonio
- No cotizadas con calculo fiscal y soporte de carga manual

## Fase 4 Modelo 720

- Bienes por bloque y pais sobre `irpf_asset_registry`
- Umbrales de declaracion
- Titularidad y comparativa interanual
- Previsualizacion funcional previa a exportacion

## Fase 5 Administracion y gobierno

- Configuracion de plantillas
- Reglas configurables
- Auditoria funcional
- Alertas accionables
- Catalogos y tablas maestras

## Fase 6 Integraciones externas

- BOE
- Registro Mercantil
- Cruces 189/198
- Validacion AEAT y servicios adicionales
