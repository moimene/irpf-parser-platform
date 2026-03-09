**PRD**

**REFACTORIZACION UI**

Plataforma Fiscal Patrimonial

IRPF Mod.100 \| IP Mod.714 \| Bienes Exterior Mod.720

*Version 1.1 \| 9 de marzo de 2026 \| Scope: Frontend only*

*Clasificacion: Interno \| Estado: Aprobada con notas tecnicas*

**1. Contexto y Alcance**

**1.1 Proposito de este documento**

Esta PRD define los requisitos funcionales, tecnicos y de diseno para la
refactorizacion de la capa de presentacion de la Plataforma Fiscal
Patrimonial. El objetivo es transformar la experiencia actual, orientada
a metricas tecnicas y pantallas fragmentadas, en un workspace
profesional que refleje el flujo de trabajo natural del fiscalista
patrimonial.

**1.2 Alcance: Solo frontend**

La refactorizacion se limita exclusivamente a la capa de presentacion.
No se modifican:

-   APIs existentes (17 endpoints validados en produccion)

-   Modelo de datos (schema runtime irpf\_\* con 20+ migraciones)

-   Motor fiscal (lotes, FIFO, asignaciones, validaciones)

-   Parser ni pipeline de ingesta

-   Auth, RBAC ni asignaciones

El backend queda intacto. Los contratos API actuales son la interfaz de
integracion.

**1.3 Estado actual de la plataforma**

La plataforma es un MVP operativo con:

-   Auth real sobre Supabase Auth con RBAC por rol y asignacion

-   Gestion de clientes, unidades fiscales y expedientes por ejercicio

-   Ingesta documental con parser (Pictet, Goldman Sachs, Citi)

-   Revision manual con aprobacion/rechazo

-   Motor fiscal IRPF con lotes FIFO y asignaciones venta-lote

-   Exportacion base para Modelos 100, 714 y 720

-   E2E productivo: 11 tests pasando

El problema no es funcional. El modelo de datos, las APIs y el motor
fiscal estan correctamente construidos. El problema es que la UI no
expone esta informacion de la forma que el fiscalista necesita para
trabajar.

**1.4 Problema central**

> **PROBLEMA**
>
> El documento natural de trabajo del fiscalista patrimonial es la hoja
> de calculo (XLS) como tabla de activos. La aplicacion actual no expone
> la informacion en bloque, no permite ver el patrimonio completo de un
> vistazo, y fragmenta los datos entre multiples pantallas sin ofrecer
> la vista consolidada que el profesional necesita para tomar
> decisiones.

**1.5 Usuarios y roles (sin cambios)**

  ---------------- ----------------------------------------------------------- ------------------------
  **Rol**          **Permisos clave**                                          **Persona operativa**
  admin            Gobierno completo de plataforma, edicion de unidad fiscal   Socio / Director
  fiscal\_senior   Aprobacion canonica, cierre declarativo, edicion UF         Responsable de cartera
  fiscal\_junior   Trabajo documental, revision, preparacion expedientes       Fiscalista operativo
  solo\_lectura    Consulta de cartera, clientes, expedientes y modelos        Stakeholder / Demo
  ---------------- ----------------------------------------------------------- ------------------------

**2. Diagnostico de Usabilidad**

**2.1 Inventario de problemas**

Se han identificado seis problemas estructurales de usabilidad que
impiden la adopcion operativa por un despacho fiscal real.

  -------- -------------------------------------- ----------------------------------------------------- ------------------------- ------------
  **ID**   **Problema**                           **Impacto usuario**                                   **Componente**            **Lineas**
  P1       Sin vista patrimonial consolidada      No puede analizar portfolio completo de un vistazo    client-profile.tsx        1.613
  P2       Expediente monolitico                  Pantalla confusa, no sabe donde esta ni que hacer     expediente-summary.tsx    2.217
  P3       Dashboard de metricas tecnicas         No prioriza accion operativa real del fiscalista      dashboard-workspace.tsx   345
  P4       Info fragmentada entre pantallas       Reconstruccion mental del patrimonio por el usuario   Multiples componentes     \-
  P5       CSS monolitico sin sistema de diseno   Inconsistencia visual, lentitud de desarrollo         globals.css               1.212
  P6       Sin componente de tabla de datos       No puede trabajar como en su XLS habitual             Tablas HTML nativas       \-
  -------- -------------------------------------- ----------------------------------------------------- ------------------------- ------------

**2.2 Analisis de componentes actuales**

El codebase actual tiene 14 componentes React que suman 8.617 lineas. La
distribucion revela concentracion extrema en dos archivos monoliticos:

  ---------------------------- ------------ ---------------------------------------------- ------------------------------------------
  **Componente**               **Lineas**   **Responsabilidad**                            **Decision**
  expediente-summary.tsx       2.217        5 fases del expediente en un solo archivo      Descomponer en 5 + stepper
  client-profile.tsx           1.613        Ficha cliente con UF, docs, activos, eventos   Refactorizar como workspace con pestanas
  review-board.tsx             1.165        Bandeja de revision completa                   Migrar a DataTable con acciones
  access-admin-workspace.tsx   930          Admin de usuarios y accesos                    Migrar a shadcn/ui
  export-generator.tsx         584          Generacion de exportes AEAT                    Integrar en fase Modelos del stepper
  intake-form.tsx              393          Formulario de carga documental                 Migrar a form builder con Zod
  models-workspace.tsx         360          Mesa declarativa por modelo                    Enriquecer con DataTable y semaforos
  dashboard-workspace.tsx      345          Home con KPIs y tablas                         Redisenar como dashboard accionable
  clients-workspace.tsx        298          Listado de cartera                             Migrar a DataTable
  Resto (5 comp.)              712          Login, nav, onboarding, etc.                   Migrar estilos a Tailwind
  ---------------------------- ------------ ---------------------------------------------- ------------------------------------------

**2.3 Capa CSS actual**

globals.css contiene 1.212 lineas de CSS artesanal con clases como
.card, .badge, .kpi-grid, .dashboard-hero. No existe sistema de
componentes reutilizable. Cada pantalla reinventa su propia estructura
visual. No hay componente de tabla, formulario, modal ni panel lateral
reutilizable.

**2.4 Dependencias actuales relevantes**

El package.json actual no incluye libreria de UI, tabla de datos ni
Tailwind:

-   \@supabase/ssr, \@supabase/supabase-js (auth + DB)

-   next \^14.2.25, react \^18.3.1 (framework)

-   zod \^4.0.15 (validacion, ya disponible)

-   Sin Tailwind, sin shadcn/ui, sin TanStack Table, sin SheetJS

**3. Principios de Diseno**

**3.1 Principio rector: La hoja de calculo como interfaz natural**

El fiscalista patrimonial piensa en tablas. Su herramienta es el Excel
con la tabla de activos. Cada fila es un activo con clase,
identificador, pais, valor, titularidad y bloque declarativo. La
plataforma debe hablar este mismo idioma.

Esto no significa convertir la app en un Excel online. Significa que la
vista por defecto del patrimonio debe ser una tabla interactiva con las
columnas que el fiscalista usa en su hoja de calculo, pero conectada al
motor fiscal: validacion automatica, trazabilidad documental y
preparacion declarativa.

**3.2 Principios UX**

1.  Workspace, no pantalla. Cada contexto de trabajo (cliente,
    expediente) es un workspace con pestanas que expone toda la
    informacion necesaria sin navegar fuera.

2.  Progresion visible. El expediente muestra un stepper horizontal con
    fases secuenciales y estado visual (completada, activa, pendiente,
    bloqueada).

3.  Tabla como lingua franca. Cualquier conjunto de datos tabulares usa
    el mismo componente DataTable con filtrado, ordenamiento, paginacion
    y export XLS.

4.  Accion, no metricas. El dashboard prioriza la siguiente accion
    operativa, no indicadores tecnicos.

5.  Contexto siempre visible. En cualquier vista, el usuario sabe en que
    cliente, expediente, ejercicio y modelo esta trabajando.

6.  Zero CSS artesanal. Todo componente visual se construye con
    shadcn/ui + Tailwind CSS.

7.  Deep Linking. La pestana activa del Workspace, la fase del Stepper
    y los filtros del DataTable se sincronizan automaticamente con URL
    query parameters (libreria `nuqs`). Permite compartir vistas
    exactas entre fiscalistas y mantener contexto al recargar pagina.

**3.3 Patron de navegacion**

La navegacion lateral permanece identica (5 items):

  -------------------- ---------------- ---------------------------------------------
  **Menu**             **Ruta**         **Cambio UI**
  Mi cartera           /                Dashboard accionable (rediseno completo)
  Clientes             /clientes        DataTable con cartera operativa
  Bandeja de trabajo   /review          DataTable con acciones inline
  Modelos AEAT         /modelos         Mesa declarativa con semaforos y drill-down
  Configuracion        /configuracion   Migrar estilos a shadcn/ui
  -------------------- ---------------- ---------------------------------------------

Las rutas de detalle (fuera del menu) reciben los cambios mas
significativos:

  --------------------- ---------------------------------- ----------------------------------------------
  **Ruta**              **Estado actual**                  **Estado objetivo**
  /clientes/\[id\]      Ficha con secciones expandibles    Workspace patrimonial con pestanas tabulares
  /expedientes/\[id\]   Monolito con tabs sin progresion   Stepper de 5 fases con contexto fijo
  --------------------- ---------------------------------- ----------------------------------------------

**4. Requisitos Funcionales Detallados**

**4.1 RF-WS: Workspace Patrimonial de Cliente (/clientes/\[id\])**

Este es el cambio mas critico de la refactorizacion. Transforma la ficha
de cliente en un workspace con pestanas que exponen toda la informacion
patrimonial en formato tabular.

**4.1.1 Estructura de pestanas**

  ------------------ ----------------------------------------------- -------------------------------------- ---------------
  **Pestana**        **Contenido principal**                         **API fuente**                         **Prioridad**
  Resumen            KPIs del cliente, UF, equipo, siguiente paso    GET /api/clientes/\[id\]               P0
  Portfolio 720      Tabla tipo XLS de activos por bloque 720        GET /api/clientes/\[id\] + canonical   P0
  Operaciones IRPF   Dividendos, intereses, ganancias/perdidas       GET /api/expedientes/\[id\]            P1
  Patrimonio IP      Valoracion a cierre por clase patrimonial       GET /api/expedientes/\[id\]            P1
  Expedientes        Expedientes por ejercicio con estado workflow   GET /api/clientes/\[id\]               P0
  Documentos         Todos los documentos del cliente                GET /api/clientes/\[id\]               P2
  ------------------ ----------------------------------------------- -------------------------------------- ---------------

**4.1.2 RF-WS-01: Pestana Portfolio 720 (CRITICA)**

La pestana Portfolio 720 es el entregable mas importante. Debe presentar
los activos canonicos del cliente en una tabla interactiva con estas
columnas exactas:

  ---------------------- -------------- ------------------------------------ --------------- -------------------
  **Columna**            **Tipo**       **Fuente de dato**                   **Ordenable**   **Filtrable**
  Clase patrimonial      Enum           canonical\_asset.asset\_class        Si              Si (multi-select)
  Clave operativa        String         canonical\_asset.operative\_key      Si              Si (texto)
  ISIN / Identificador   String         canonical\_asset.isin                Si              Si (texto)
  Pais                   ISO 3166       canonical\_asset.country             Si              Si (multi-select)
  Titularidad            Enum           canonical\_asset.ownership\_type     Si              Si (select)
  Porcentaje             Decimal %      canonical\_asset.ownership\_pct      Si              No
  Valor fin ejercicio    Currency EUR   canonical\_asset.year\_end\_value    Si              Rango
  Saldo medio Q4         Currency EUR   canonical\_asset.q4\_avg\_balance    Si              No
  Metodo valoracion      Enum           canonical\_asset.valuation\_method   No              Si (select)
  Bloque 720             Enum 1-4       canonical\_asset.block\_720          Si              Si (multi-select)
  Expedientes            Link\[\]       canonical\_asset.expediente\_ids     No              No
  Incidencias            Badge count    canonical\_asset.open\_issues        Si              Si (\>0)
  ---------------------- -------------- ------------------------------------ --------------- -------------------

**Funcionalidades obligatorias de la tabla:**

-   Paginacion servidor (50 filas por pagina por defecto)

-   Ordenamiento por cualquier columna marcada como ordenable

-   Filtrado global (busqueda por texto libre) y por columna

-   Seleccion de filas (checkbox) para acciones bulk

-   Columnas fijas: Clase patrimonial + ISIN siempre visibles al scroll
    horizontal

-   Formateo numerico: EUR con separador de miles, porcentaje con 2
    decimales

-   Drill-down: click en fila abre panel lateral con detalle del activo
    y expedientes vinculados

-   Export XLS: boton que descarga la tabla filtrada actual como .xlsx
    con formato profesional

-   Resumen footer: totales por clase patrimonial y total general

**4.1.3 RF-WS-02: Pestana Resumen**

Vista ejecutiva del cliente con:

-   Cabecera: nombre, NIF, referencia interna, estado, equipo asignado

-   Unidad fiscal editable segun rol (sujeto pasivo, conyuge, NIF,
    alcance, vinculacion)

-   KPIs: numero de activos, valor total patrimonio, expedientes
    activos, incidencias abiertas

-   Card de siguiente paso: CTA al expediente o tarea mas prioritaria

-   Timeline de actividad reciente (ultimos 10 eventos del cliente)

**4.1.4 RF-WS-03: Pestana Operaciones IRPF**

Tabla consolidada por ejercicio con las operaciones fiscales:

-   Columnas: Fecha, Tipo (dividendo/interes/venta/compra), Activo,
    Importe bruto, Retencion, Importe neto, Ganancia/Perdida, Estado
    cuadre FIFO

-   Subtotales por tipo de operacion

-   Drill-down a detalle de lotes FIFO en ventas

-   Export XLS con los mismos datos

**4.1.5 RF-WS-04: Pestana Patrimonio IP**

Tabla de valoracion a cierre para Modelo 714:

-   Columnas: Clase patrimonial, Identificador, Pais, Valor declarable,
    Metodo valoracion, Umbral exento, Tipo de cambio

-   Agrupacion por clase patrimonial

-   Total patrimonio neto sujeto a IP

**4.1.6 RF-WS-05: Pestana Expedientes**

Lista de expedientes del cliente con:

-   Columnas: Ejercicio, Modelo, Estado workflow, Fase actual,
    Documentos, Incidencias, Ultima actividad

-   Badge de estado con color semantico (verde=cerrado, azul=activo,
    amarillo=atencion, rojo=bloqueado)

-   Click directo al expediente en su fase actual

-   Boton de creacion de nuevo expediente

**4.1.7 RF-WS-06: Pestana Documentos**

Tabla de todos los documentos del cliente transversal a expedientes:

-   Columnas: Nombre, Tipo, Fecha, Expediente, Estado extraccion,
    Records extraidos, Revisiones pendientes

-   Filtrado por expediente, tipo y estado

**4.2 RF-EXP: Expediente como Stepper Lineal (/expedientes/\[id\])**

Redisena el expediente de un monolito de 2.217 lineas a un stepper
horizontal con 5 fases independientes.

**4.2.1 Estructura del stepper**

Barra horizontal con 5 pasos secuenciales. Cada paso tiene un estado
visual:

  ------------ ------------------ --------------- ---------------------------------------------
  **Estado**   **Color**          **Icono**       **Significado**
  Completada   Verde (\#22C55E)   Check           Fase cerrada, datos consolidados
  Activa       Azul (\#3B82F6)    Circulo lleno   Fase en la que el usuario esta trabajando
  Pendiente    Gris (\#9CA3AF)    Circulo vacio   Fase disponible pero no iniciada
  Bloqueada    Rojo (\#EF4444)    Candado         Fase no accesible (prerequisito incompleto)
  ------------ ------------------ --------------- ---------------------------------------------

**4.2.2 Contexto fijo compartido**

En la parte superior de todas las fases, un bloque fijo muestra:

-   Cliente: nombre + NIF + link a workspace cliente

-   Expediente: referencia + modelo + ejercicio

-   Estado: fase actual + completitud (ej: 3/5 fases completadas)

-   Siguiente accion: CTA al bloqueo o tarea pendiente mas critica

**4.2.3 RF-EXP-01: Fase Resumen**

Vista general del expediente con:

-   Estado general y KPIs (documentos, extracciones, activos canonicos,
    validaciones)

-   Ownership (responsable, equipo)

-   Workflow timeline (ultimos eventos)

-   Tarea pendiente con CTA directo

-   Siguiente hito del expediente

**4.2.4 RF-EXP-02: Fase Documental**

Gestion de la carga y parseo de documentos:

-   Tabla de documentos del expediente con estado de extraccion

-   Formulario de carga (drag-and-drop, multi-file)

-   Estado del parseo por documento (en cola, procesando, completado,
    error, revision manual)

-   Explicacion contextual de que hace el sistema con cada tipo de
    documento

**Regla:** La ingesta solo opera sobre expedientes existentes vinculados
a cliente.

**4.2.5 RF-EXP-03: Fase Revision**

Interface para resolver revision manual:

-   Documentos con extracciones pendientes de revision

-   Acceso directo a bandeja de trabajo filtrada por este expediente

-   Indicador de avance (ej: 8/12 extracciones aprobadas)

-   Criterio claro de cuando la fase esta completa

**Regla:** No puede cerrarse si quedan documentos en revision o con
status de fallo.

**4.2.6 RF-EXP-04: Fase Canonico**

Tabla de activos y eventos canonicos con edicion inline:

-   DataTable de activos canonicos (mismas columnas que Portfolio 720
    pero scoped al expediente)

-   DataTable de eventos fiscales canonicos (fecha, tipo, activo,
    importe, retencion)

-   Edicion inline por celda con validacion Zod

-   Alta manual de activo o evento

-   Aprobacion canonica por lote (seleccion multiple + boton aprobar)

-   Estado de aprobacion visible (aprobado/pendiente/rechazado)

-   **Navegacion por teclado obligatoria:** Flechas para moverse entre
    celdas, Enter para entrar en modo edicion y guardar, Esc para
    cancelar. Hook dedicado `useTableKeyboardNav`.

**Regla:** El canonico es la fuente de verdad para AEAT. Las ediciones
se auditan.

**Nota tecnica (Optimistic UI):** La celda se actualiza visualmente al
pulsar Enter en menos de 50ms. El PATCH se ejecuta en background. Solo
se revierte el cambio si el servidor responde con error. Prohibido
mostrar spinner por celda individual.

**4.2.7 RF-EXP-05: Fase Modelos**

Preparacion y salida declarativa:

-   Checklist declarativo con semaforo (verde/amarillo/rojo) por
    criterio de validacion

-   Tabla de validaciones con resultado, descripcion y accion sugerida

-   Botones de salida: Informe PDF, XLS operativo, Formato AEAT

-   Descarga condicional: si el canonico no esta aprobado, el boton AEAT
    se desactiva con tooltip explicativo

**Regla:** No permite salida AEAT final si el canonico no esta aprobado.

**4.3 RF-DASH: Dashboard Accionable (/)**

Redisena Mi cartera para priorizar la accion operativa.

**4.3.1 Estado actual vs objetivo**

  ----------------- ---------------------------------------------------- ------------------------------------------------------
  **Elemento**      **Actual**                                           **Objetivo**
  Hero              KPIs tecnicos (cola parser, extracciones, alertas)   Cards de accion (siguiente cliente, siguiente tarea)
  Tabla principal   Expedientes priorizados con metricas                 Mis tareas pendientes (revision, aprobacion, cierre)
  Sidebar           Cobertura por modelo (sin contexto)                  Cobertura declarativa con semaforo y drill-down
  Accion primaria   Ninguna clara                                        CTA grande al trabajo mas urgente
  ----------------- ---------------------------------------------------- ------------------------------------------------------

**4.3.2 RF-DASH-01: Componentes del dashboard**

-   Card de accion prioritaria: el trabajo mas urgente con CTA directo

-   Mis tareas pendientes: DataTable con columnas (Cliente, Expediente,
    Tipo, Prioridad, Accion)

-   Cobertura declarativa: mini-tabla por modelo (100, 714, 720) con
    semaforo (listo/atencion/bloqueado)

-   Timeline de equipo: ultimos 10 eventos de actividad del equipo

-   Alertas criticas: banner rojo si hay bloqueos que requieren atencion
    inmediata

**4.4 RF-DT: Componente DataTable Reutilizable**

Componente generico que se usa en todas las vistas tabulares de la
plataforma.

**4.4.1 Especificacion funcional**

  ---------------------- --------------------------------------------------------------------------------- ---------------
  **Feature**            **Detalle**                                                                       **Prioridad**
  Paginacion             Cliente (datasets \<500) o servidor (\>500). Selector de pagina (10/25/50/100).   P0
  Ordenamiento           Click en header. Multi-sort con Shift+Click. Indicador visual de direccion.       P0
  Filtrado global        Input de busqueda que filtra por todas las columnas de texto.                     P0
  Filtrado por columna   Texto libre, select, multi-select, rango numerico, rango fecha.                   P0
  Seleccion              Checkbox por fila + select all. Barra de acciones bulk al seleccionar.            P1
  Columnas fijas         Configuracion de columnas sticky al scroll horizontal.                            P1
  Redimensionamiento     Drag en border de header para ajustar ancho de columna.                           P2
  Formateo               Currency (EUR), porcentaje, fecha, badge de estado, link.                         P0
  Edicion inline         Click en celda para editar. Validacion Zod. Save con Enter.                       P1
  Export XLS             Boton que descarga .xlsx de la vista actual (filtros aplicados).                  P0
  Nav teclado            Flechas entre celdas, Enter editar/guardar, Esc cancelar. Obligatorio con edit.    P1
  Resumen footer         Fila de totales/subtotales configurable por tabla.                                P1
  Empty state            Mensaje + CTA cuando no hay datos.                                                P0
  Loading state          Skeleton de tabla durante carga.                                                  P0
  ---------------------- --------------------------------------------------------------------------------- ---------------

**Nota tecnica (Exportacion con paginacion servidor):** Si la tabla usa
paginacion servidor (>500 filas), el boton Export debe hacer un fetch
en background solicitando el dataset completo (con filtros activos pero
sin limite de paginacion) antes de generar el Excel localmente.

### 4.4.2 Instancias de DataTable en la plataforma

  --------------------- ---------------------------------- ----------------------------------------
  **Contexto**          **Datos**                          **Features especiales**
  Portfolio 720         Activos canonicos del cliente      Columnas fijas, export XLS, drill-down
  Operaciones IRPF      Eventos fiscales por ejercicio     Subtotales por tipo, drill-down FIFO
  Patrimonio IP         Valoracion a cierre                Agrupacion por clase
  Canonico expediente   Activos + eventos del expediente   Edicion inline, aprobacion bulk
  Clientes              Cartera del despacho               Badge estado, link a workspace
  Bandeja revision      Items pendientes de revision       Acciones inline (aprobar/rechazar)
  Mis tareas            Tareas del usuario en dashboard    CTA directo a tarea
  Expedientes (tab)     Expedientes del cliente            Badge fase, link directo
  Documentos (tab)      Documentos del cliente             Estado extraccion
  Modelos AEAT          Expedientes declarativos           Semaforo, drill-down a expediente
  --------------------- ---------------------------------- ----------------------------------------

**4.5 RF-REV: Bandeja de Trabajo (/review)**

Migra la bandeja actual (review-board.tsx, 1.165 lineas) a DataTable con
acciones.

**4.5.1 Requisitos**

-   DataTable con columnas: Cliente, Expediente, Documento, Campo, Valor
    original, Valor sugerido, Prioridad, Accion

-   Filtros laterales: cliente, expediente, tipo de incidencia,
    prioridad, ejercicio

-   Acciones inline por fila: Aprobar, Rechazar, Editar campo, Ver
    documento origen

-   Acciones bulk: Aprobar seleccion, Rechazar seleccion

-   Al resolver un item, el sistema actualiza el estado real y muestra
    confirmacion

-   Navegacion post-accion: ir al expediente o volver a la bandeja

**4.6 RF-MOD: Mesa Declarativa (/modelos)**

Enriquece la vista actual (models-workspace.tsx, 360 lineas).

**4.6.1 Requisitos**

-   Pestanas por modelo: Modelo 100, Modelo 714, Modelo 720

-   DataTable por modelo con: Cliente, Expediente, Ejercicio, Estado,
    Validaciones OK/Warn/Error, Siguiente accion

-   Semaforo por expediente: verde (listo), amarillo (atencion), rojo
    (bloqueado)

-   Click en expediente navega a la fase Modelos del stepper

-   Resumen general: total expedientes por estado y modelo

**5. Stack Tecnico y Componentes**

**5.1 Dependencias a incorporar**

  -------------------------- ------------- -------------------------------- --------------- ----------------------------------------------------------
  **Dependencia**            **Version**   **Proposito**                    **Peso gzip**   **Justificacion**
  tailwindcss                \^3.4         Sistema de utilidades CSS        \~30KB          Elimina globals.css artesanal
  \@radix-ui/\* (shadcn)     Latest        Primitivas UI accesibles         Tree-shake      Dialog, Sheet, Tabs, Toast, etc.
  \@tanstack/react-table     \^8           Motor de tabla headless          \~15KB          Standard de facto para data tables
  exceljs                    \^4.4         Export XLS con estilos           \~180KB lazy    Headers color, formato EUR, bordes, autofit
  file-saver                 \^2.0         Descarga de archivos binarios    \~3KB           Companion de exceljs para saveAs
  nuqs                       \^2           Estado URL tipado (App Router)   \~5KB           Deep linking de tabs, filtros, paginacion
  class-variance-authority   \^0.7         Variantes de componentes         \~2KB           Estilos tipados para shadcn
  clsx + tailwind-merge      Latest        Utilidades de clases             \~3KB           Merge condicional de clases
  lucide-react               Latest        Iconos                           Tree-shake      Iconos para UI
  -------------------------- ------------- -------------------------------- --------------- ----------------------------------------------------------

*Nota: zod \^4.0.15 ya esta en el proyecto. No se anade peso adicional
para validacion.*

**5.2 Estructura de carpetas objetivo**

Nueva estructura de componentes dentro de apps/web/:

  ------------------------ -------------------------------- ---------------------------------------------------
  **Carpeta**              **Contenido**                    **Ejemplo**
  components/ui/           Componentes shadcn/ui base       Button, Card, Badge, Dialog, Sheet, Tabs, Toast
  components/data-table/   DataTable generico + variantes   DataTable, DataTableToolbar, DataTableExport
  components/fiscal/       Componentes de dominio fiscal    PatrimonioTable, OperacionesTable, FiscalUnitForm
  components/workspace/    Layouts de workspace             ClientWorkspace, ExpedienteWorkspace
  components/stepper/      Stepper generico                 Stepper, StepperItem, StepperContext
  components/forms/        Formularios con Zod              FiscalUnitForm, AssetForm, EventForm
  hooks/                   Hooks compartidos                useDataTable, useFiscalUnit, useExpedientePhase
  ------------------------ -------------------------------- ---------------------------------------------------

**5.3 Descomposicion del monolito de expediente**

El archivo expediente-summary.tsx (2.217 lineas) se descompone en:

  -------------------------- ----------------- ------------------------------------------------- -----------------------------
  **Componente nuevo**       **Lineas est.**   **Responsabilidad**                               **API que consume**
  ExpedienteStepper.tsx      \~120             Barra de progreso + routing de fase               Estado del expediente
  ExpedienteResumen.tsx      \~200             KPIs, workflow, ownership, siguiente hito         GET /api/expedientes/\[id\]
  ExpedienteDocumental.tsx   \~350             Tabla docs, formulario carga, estado parseo       GET + POST documents
  ExpedienteRevision.tsx     \~250             Pendientes, link a bandeja, criterio avance       GET /api/review?exp=id
  ExpedienteCanonico.tsx     \~400             DataTable activos/eventos, edicion, aprobacion    GET + PATCH canonical
  ExpedienteModelos.tsx      \~300             Checklist, validaciones, salidas AEAT             GET /api/exports/\[id\]
  ExpedienteContext.tsx      \~80              Bloque fijo: cliente, modelo, ejercicio, estado   Props del expediente
  -------------------------- ----------------- ------------------------------------------------- -----------------------------

*Total estimado: \~1.700 lineas distribuidas en 7 archivos vs 2.217 en 1
monolito.*

**6. Historias de Usuario Priorizadas**

Las historias se agrupan por requisito funcional. La prioridad MoSCoW
indica:

-   Must: obligatoria para el MVP de refactorizacion

-   Should: importante pero no bloqueante

-   Could: mejora diferible

  -------- --------------------------------------------------------------------------------------------------------------------------------- ----------- ------------
  **ID**   **Historia**                                                                                                                      **RF**      **MoSCoW**
  HU-01    Como fiscalista quiero ver el portfolio completo de un cliente en una tabla tipo XLS con filtrado, ordenamiento y export          RF-WS-01    Must
  HU-02    Como fiscalista quiero que al entrar a un cliente vea pestanas (Resumen, Portfolio, Operaciones, Patrimonio, Expedientes, Docs)   RF-WS       Must
  HU-03    Como fiscalista quiero exportar la tabla de portfolio a Excel con formato profesional                                             RF-WS-01    Must
  HU-04    Como fiscalista quiero hacer drill-down desde un activo del portfolio al detalle con expedientes vinculados                       RF-WS-01    Should
  HU-05    Como fiscalista quiero ver las operaciones IRPF consolidadas por ejercicio con subtotales                                         RF-WS-03    Must
  HU-06    Como fiscalista quiero recorrer el expediente como stepper de 5 fases con indicador de progreso                                   RF-EXP      Must
  HU-07    Como fiscalista quiero que el expediente me diga que fase esta bloqueada y por que                                                RF-EXP      Must
  HU-08    Como revisor quiero editar activos canonicos inline con validacion y aprobar por lote                                             RF-EXP-04   Must
  HU-09    Como fiscalista quiero que el checklist declarativo me indique con semaforo si puedo exportar                                     RF-EXP-05   Must
  HU-10    Como fiscalista quiero que Mi cartera me diga cual es mi siguiente tarea prioritaria                                              RF-DASH     Must
  HU-11    Como responsable quiero ver la cobertura declarativa por modelo con semaforo                                                      RF-DASH     Should
  HU-12    Como fiscalista quiero resolver revision manual con acciones inline en la bandeja                                                 RF-REV      Must
  HU-13    Como responsable quiero ver en la mesa declarativa que expedientes estan bloqueados y por que                                     RF-MOD      Should
  HU-14    Como fiscalista quiero filtrar por columna en cualquier tabla de la plataforma                                                    RF-DT       Must
  HU-15    Como fiscalista quiero que las tablas se vean y funcionen como mi XLS habitual                                                    RF-DT       Must
  -------- --------------------------------------------------------------------------------------------------------------------------------- ----------- ------------

**7. Plan de Ejecucion**

**7.1 Sprints**

  ------------ -------------- ----------------------------------------------------------------------------------------------- ------------------------------------------------------------------- ------------------
  **Sprint**   **Duracion**   **Alcance**                                                                                     **Entregable**                                                      **Dependencias**
  S0           3-4 dias       Infraestructura: Tailwind + shadcn/ui + DataTable base + export XLS                             Libreria UI + DataTable funcionando en /clientes con datos reales   Ninguna
  S1           5-7 dias       Workspace cliente (6 pestanas) + Stepper expediente (5 fases)                                   Ficha cliente rediseñada + Expediente modular con contexto fijo     S0
  S2           4-5 dias       Tablas operativas: Portfolio 720 completo + Operaciones IRPF + Canonico editable + Export XLS   Todas las tablas de datos con funcionalidad completa                S1
  S3           4-5 dias       Dashboard accionable + Bandeja mejorada + Formularios fiscales + Modelos con semaforo           UX completa end-to-end con acciones operativas                      S2
  S4           3-4 dias       E2E, polish visual, migracion CSS residual, validacion con usuario real                         Plataforma lista para piloto con despacho                           S3
  ------------ -------------- ----------------------------------------------------------------------------------------------- ------------------------------------------------------------------- ------------------

**Estimacion total: 19-25 dias de desarrollo efectivo.**

**7.2 Criterios de aceptacion de la refactorizacion**

7.  El fiscalista puede ver el portfolio completo de un cliente en una
    tabla tipo XLS con filtrado, ordenamiento y exportacion a Excel.

8.  El expediente muestra progresion visual por fases y el usuario sabe
    en que punto esta y que le falta para avanzar.

9.  Cada tabla de datos permite exportar a XLSX con formato profesional.

10. El dashboard prioriza accion operativa, no metricas tecnicas.

11. Los componentes de UI son reutilizables y consistentes (shadcn/ui +
    Tailwind).

12. La suite E2E cubre los flujos criticos de usabilidad sin regresion.

13. El CSS monolitico (globals.css) ha sido eliminado en favor de
    Tailwind + componentes.

**7.3 Riesgos y mitigaciones**

  ------------------------------------------ ------------------ ------------- -----------------------------------------------------------------------------------
  **Riesgo**                                 **Probabilidad**   **Impacto**   **Mitigacion**
  Regresion funcional al migrar UI           Media              Alto          Migrar progresivamente. E2E verde en cada commit. No tocar APIs.
  DataTable lento con portfolios grandes     Baja               Medio         Paginacion servidor para \\>500 filas. Virtualizacion como fallback.
  Scope creep en diseno                      Alta               Alto          Wireframes aprobados antes de codificar. Un sprint = un entregable cerrado.
  Sobrecarga de bundle con nuevas deps       Baja               Bajo          Tailwind purge. ExcelJS lazy-loaded. shadcn tree-shakeable.
  Incompatibilidad Zod v4 con form libs      Baja               Medio         Zod ya esta en el proyecto. Validacion directa sin adaptador externo.
  Excel sin formato profesional              Alta               Alto          Usar exceljs en vez de xlsx. Headers con color brand, formato EUR nativo.
  Paginacion servidor vs export completo     Media              Alto          Export hace fetch bypass sin limit con filtros actuales antes de generar XLS.
  Lag en edicion inline                      Media              Alto          Optimistic UI obligatorio. Celda cambia en <50ms, PATCH en background.
  Perdida de contexto al recargar/compartir  Media              Alto          Sincronizar tabs, filtros y paginacion con URL via nuqs.
  ------------------------------------------ ------------------ ------------- -----------------------------------------------------------------------------------

**8. Restricciones y No-Objetivos**

**8.1 Restricciones tecnicas**

-   Next.js 14 App Router: se mantiene como framework. No se migra a
    Pages Router ni a otro framework.

-   React 18: no se actualiza a React 19 en este ciclo.

-   Supabase: cliente y auth sin cambios. No se introducen nuevas
    tablas.

-   APIs: los 17 endpoints validados no se modifican. Si se necesitan
    datos adicionales, se proponen como extension GET sin romper
    contrato.

-   E2E: los 11 tests existentes deben seguir pasando tras cada sprint.

**8.2 No-objetivos de esta PRD**

-   Modificar el backend, las APIs o el modelo de datos.

-   Rehacer el parser o pipeline de ingesta.

-   Implementar dark mode.

-   Internacionalizar la UI (la plataforma es para despachos espanoles).

-   Implementar SSO corporativo o auth avanzada.

-   Crear modulos fiscales nuevos (se usan los existentes).

-   Integrar con BOE, Registro Mercantil o cruces AEAT.

-   Mobile responsive (la plataforma se usa en desktop).

**9. Trazabilidad**

**9.1 Trazabilidad RF a HU**

  --------- ---------------------------------- -----------------------------------
  **RF**    **Descripcion**                    **HUs asociadas**
  RF-WS     Workspace patrimonial de cliente   HU-01, HU-02, HU-03, HU-04, HU-05
  RF-EXP    Expediente como stepper lineal     HU-06, HU-07, HU-08, HU-09
  RF-DASH   Dashboard accionable               HU-10, HU-11
  RF-DT     DataTable reutilizable             HU-14, HU-15
  RF-REV    Bandeja de trabajo con DataTable   HU-12
  RF-MOD    Mesa declarativa con semaforos     HU-13
  --------- ---------------------------------- -----------------------------------

**9.2 Trazabilidad RF a Sprint**

  ------------ ----------------------------------------------------- -----------------------------------
  **Sprint**   **RFs cubiertos**                                     **HUs entregadas**
  S0           RF-DT (base)                                          HU-14, HU-15 (parcial)
  S1           RF-WS (estructura + tabs), RF-EXP (stepper + fases)   HU-02, HU-06, HU-07
  S2           RF-WS-01 completo, RF-WS-03, RF-EXP-04                HU-01, HU-03, HU-04, HU-05, HU-08
  S3           RF-DASH, RF-REV, RF-MOD, RF-EXP-05                    HU-09, HU-10, HU-11, HU-12, HU-13
  S4           Todos (consolidacion)                                 HU-15 (completa), E2E
  ------------ ----------------------------------------------------- -----------------------------------

**9.3 Trazabilidad a PRD funcional original**

Esta PRD de refactorizacion UI implementa los requisitos de la PRD
funcional (prd-traceability.md) sin modificar su definicion:

  -------------------------------------- -------------------------- -------------------------------------------
  **Requisito PRD original**             **Seccion PRD original**   **Implementado en esta PRD**
  Vista tipo XLS del portfolio 720       7.2 Ficha cliente          RF-WS-01 (Portfolio 720 tab)
  Expediente por fases                   7.3 Expediente             RF-EXP (5 fases como stepper)
  Dashboard como prioridad operativa     6.1 Mi cartera             RF-DASH (dashboard accionable)
  Bandeja transversal multi-expediente   6.3 Bandeja de trabajo     RF-REV (DataTable con acciones)
  Mesa declarativa por modelo            6.4 Modelos AEAT           RF-MOD (semaforos y drill-down)
  Edicion y aprobacion canonica          7.3 Fase canonico          RF-EXP-04 (edicion inline + bulk approve)
  Export XLS operativo                   4.7 Modelo / export        RF-DT (export en cada DataTable)
  -------------------------------------- -------------------------- -------------------------------------------

**10. Checklist de Control para Tech Lead (Revision PR obligatoria)**

-   [ ] **Restriccion de Backend respetada:** Ningun endpoint ha sido
    alterado. Si se necesitaba cruzar informacion, se ha hecho en el
    cliente o en un Server Component.

-   [ ] **Paginacion vs Exportacion:** El codigo de exportacion hace un
    fetch bypass a la API ignorando la paginacion de la UI para traer
    todo el dataset filtrado.

-   [ ] **Calidad del Excel:** Las celdas de moneda y porcentajes son
    numeros reales en Excel (permiten usar =SUMA()), no strings de
    texto con el simbolo del euro.

-   [ ] **Latencia en Edicion:** Al editar una celda y pulsar Enter, el
    numero cambia visualmente en menos de 50ms (Optimistic UI).

-   [ ] **Persistencia del Link:** Si copio la URL actual estando en la
    pestana 3, con un filtro de pais aplicado y en la pagina 2 de la
    tabla, al abrirla de nuevo recarga exactamente el mismo contexto.

-   [ ] **E2E verde:** Los 11 tests existentes + los nuevos pasan sin
    regresion.

*Documento preparado como base de decision y contrato de desarrollo para
la refactorizacion UI de la Plataforma Fiscal Patrimonial. Version 1.1,
9 de marzo de 2026. Actualizado con notas tecnicas del informe de
validacion externa.*
