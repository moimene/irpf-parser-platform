**PLATAFORMA FISCAL PATRIMONIAL**

Diagnostico de Usabilidad y Propuesta de Refactorizacion

IRPF Mod.100 \| IP Mod.714 \| Bienes Exterior Mod.720

Fecha: 9 de marzo de 2026

Version: 1.0 \| Estado: Propuesta

1\. Resumen Ejecutivo

La plataforma IRPF Parser ha alcanzado un MVP operativo solido con flujo
critico validado (ingesta, parseo, revision, exportacion), auth real
sobre Supabase, operativa de despacho con clientes y expedientes, y una
primera slice de modelo fiscal IRPF con lotes FIFO. Sin embargo, la
experiencia de usuario actual presenta problemas estructurales de
usabilidad que impiden su adopcion por un despacho fiscal real.

**Problema central:** El documento natural de trabajo de un fiscalista
patrimonial es la hoja de calculo (XLS) como tabla de activos. La
aplicacion actual no expone la informacion en bloque, no permite ver el
patrimonio completo de un vistazo, y fragmenta los datos entre multiples
pantallas sin ofrecer la vista consolidada que el profesional necesita
para tomar decisiones.

Este documento propone una refactorizacion centrada en tres ejes:
convertir la ficha de cliente en un workspace patrimonial con vistas
tipo hoja de calculo, redisenar el expediente como flujo de trabajo
lineal con contexto visible, y establecer las skills de desarrollo y
diseno necesarias para ejecutar el cambio.

2\. Diagnostico de Usabilidad

2.1 Problemas Estructurales Detectados

**P1. Ausencia de vista patrimonial consolidada.** La ficha de cliente
(/clientes/\[id\]) muestra la unidad fiscal y una lista de expedientes,
pero no presenta el portfolio patrimonial completo en formato tabular.
El fiscalista necesita ver todos los activos del cliente con clase,
ISIN, pais, titularidad, valor y bloque 720 en una sola tabla tipo XLS.
Actualmente tiene que navegar a cada expediente individualmente.

**P2. Expediente como monolito de 2.200 lineas.** El componente
expediente-summary.tsx concentra 2.217 lineas con toda la logica de
fases (resumen, documental, revision, canonico, modelos) en un solo
archivo. Esto hace imposible mantener, testear o iterar sobre cada fase
de forma independiente. El resultado es una pantalla sobrecargada donde
el usuario no sabe donde esta ni que debe hacer a continuacion.

**P3. Dashboard orientado a metricas tecnicas.** Mi Cartera muestra KPIs
de sistema (cola documental, alertas abiertas, exportes generados) en
lugar de priorizar la accion del fiscalista. El usuario debe interpretar
metricas para decidir su siguiente paso, cuando la plataforma deberia
decirle directamente que cliente y expediente necesitan atencion.

**P4. Informacion no disponible en bloque.** El modelo de datos
distingue correctamente activos canonicos, eventos fiscales, operaciones
y lotes. Pero la UI no los presenta juntos. Un fiscalista que necesita
entender la posicion patrimonial de un cliente tiene que recorrer
multiples secciones expandibles para reconstruir mentalmente algo que
deberia ser una tabla.

**P5. CSS monolitico sin sistema de diseno.** Los 1.212 lineas de
globals.css usan clases artesanales (card, badge, kpi-grid) sin un
sistema de componentes o una libreria de UI. No hay componentes
reutilizables de tabla, formulario, modal o panel lateral. Cada pantalla
reinventa su propia estructura.

**P6. Sin componente de tabla de datos.** La plataforma renderiza tablas
con HTML nativo (\<table\>) sin paginacion, ordenamiento, filtrado,
redimensionamiento de columnas o exportacion a XLS. Para un producto
cuyo documento natural es la hoja de calculo, esto es una carencia
critica.

2.2 Mapa de Impacto

  ---------------------------- -------------------------------------- ---------------------------- ---------------
  **Problema**                 **Impacto en usuario**                 **Complejidad**              **Prioridad**
  **P1 Vista patrimonial**     No puede analizar portfolio completo   Alta (nuevo componente)      CRITICA
  **P2 Monolito expediente**   Pantalla confusa, no sabe donde esta   Media (refactor modular)     ALTA
  **P3 Dashboard tecnico**     No prioriza accion operativa real      Baja (reordenar UI)          MEDIA
  **P4 Info no en bloque**     Reconstruccion mental del patrimonio   Alta (rediseno data layer)   CRITICA
  **P5 CSS monolitico**        Inconsistencia visual, lentitud dev    Media (adoptar libreria)     ALTA
  **P6 Sin data table**        No puede trabajar como en XLS          Media (integrar libreria)    CRITICA
  ---------------------------- -------------------------------------- ---------------------------- ---------------

3\. Propuesta de Refactorizacion

3.1 Principio Rector: La Hoja de Calculo como Interfaz Natural

El fiscalista patrimonial piensa en tablas. Su herramienta de trabajo es
el Excel con la tabla de activos. Cada fila es un activo con su clase,
identificador, pais, valor, titularidad y bloque declarativo. La
plataforma debe hablar este mismo idioma.

Esto no significa convertir la app en un Excel online. Significa que la
vista por defecto del patrimonio de un cliente debe ser una tabla
interactiva con las mismas columnas que el fiscalista usa en su hoja de
calculo, pero con las ventajas de estar conectada al motor fiscal:
validacion automatica, trazabilidad documental, y preparacion
declarativa.

3.2 Eje 1: Ficha de Cliente como Workspace Patrimonial

**Estado actual:** La ficha muestra unidad fiscal + lista de expedientes
+ secciones expandibles de documentos, activos y eventos. Los datos
estan fragmentados y el usuario no tiene una vista consolidada.

**Estado objetivo:** La ficha de cliente se convierte en un workspace
con pestanas que exponen toda la informacion patrimonial en formato
tabular.

**Pestanas propuestas:**

  ---------------------- ------------------------------------------- --------------------------------------------
  **Pestana**            **Contenido**                               **Funcionalidad clave**
  **Resumen**            KPIs del cliente, unidad fiscal, equipo     Vista ejecutiva con siguiente paso
  **Portfolio 720**      Tabla tipo XLS: activos por bloque 720      Filtrar, ordenar, exportar XLS, drill-down
  **Operaciones IRPF**   Dividendos, intereses, ganancias/perdidas   Vista consolidada por ejercicio
  **Patrimonio IP**      Valoracion a cierre por clase patrimonial   Tabla con metodo valoracion y umbral
  **Expedientes**        Expedientes por ejercicio con estado        Creacion, acceso directo, estado workflow
  **Documentos**         Todos los documentos del cliente            Estado extraccion, revision, origen
  ---------------------- ------------------------------------------- --------------------------------------------

La pestana Portfolio 720 es la mas critica. Debe presentar los activos
con estas columnas exactas: Clase patrimonial, Clave operativa,
ISIN/Identificador, Pais, Titularidad, Porcentaje, Valor fin ejercicio,
Saldo medio Q4, Metodo valoracion, Bloque 720, Expedientes vinculados,
Incidencias abiertas.

3.3 Eje 2: Expediente como Stepper Lineal

**Estado actual:** Un componente monolitico de 2.200 lineas con tabs que
no transmiten progresion. El usuario no sabe si esta en fase documental
o canonica, ni que le falta para avanzar.

**Estado objetivo:** Un stepper horizontal que muestra las 5 fases del
expediente (Resumen, Documental, Revision, Canonico, Modelos) con
indicador visual de completitud. Cada fase es un componente
independiente que se monta segun la fase activa.

**Cambios estructurales:**

-   Descomponer expediente-summary.tsx en 5 componentes:
    ExpedienteResumen, ExpedienteDocumental, ExpedienteRevision,
    ExpedienteCanonico, ExpedienteModelos.

-   Crear un componente ExpedienteStepper que muestre las fases como
    pasos secuenciales con estados: completada (verde), activa (azul),
    pendiente (gris), bloqueada (rojo).

-   Cada fase expone un bloque de contexto fijo en la parte superior
    (cliente, modelo, ejercicio, estado general) y su contenido
    especifico debajo.

-   La fase Canonico incluye una tabla de activos y eventos tipo XLS con
    edicion inline y aprobacion por lote.

-   La fase Modelos incluye checklist declarativo con semaforo y boton
    de exportacion condicional.

3.4 Eje 3: Capa de Componentes y Data Table

La plataforma necesita un sistema de componentes que permita construir
interfaces tabulares de calidad profesional. Esto implica dos decisiones
fundamentales:

**Decision 1: Libreria de UI.** Adoptar shadcn/ui sobre Tailwind CSS. No
es una dependencia pesada (son componentes copiados al proyecto), se
integra nativamente con Next.js, y proporciona primitivas de calidad
(Dialog, Sheet, Tabs, DropdownMenu, Toast) sin vendor lock-in. Esto
reemplaza el CSS artesanal actual.

**Decision 2: Componente de tabla de datos.** Adoptar TanStack Table
(React Table v8) como motor de tabla con renderizado custom sobre
shadcn/ui. Esto proporciona paginacion, ordenamiento, filtrado por
columna, seleccion, redimensionamiento y exportacion a XLS. Es el
estandar de facto para tablas de datos en React y no impone estilo
propio.

4\. Skills de Desarrollo y Diseno Requeridas

4.1 Mapa de Skills por Eje

  -------------------------- -------------- ------------------------------------- -----------------
  **Skill**                  **Tipo**       **Eje que habilita**                  **Prioridad**
  **ui-component-system**    Diseno + Dev   Eje 3: capa componentes               Sprint 0 (base)
  **data-table-pro**         Desarrollo     Ejes 1 y 2: tablas XLS                Sprint 0 (base)
  **fiscal-workspace-ux**    Diseno UX      Eje 1: workspace cliente              Sprint 1
  **stepper-workflow**       Desarrollo     Eje 2: expediente lineal              Sprint 1
  **xls-export-engine**      Desarrollo     Ejes 1 y 2: export XLS nativo         Sprint 2
  **form-builder-fiscal**    Desarrollo     Ejes 1 y 2: unidad fiscal, canonico   Sprint 2
  **dashboard-actionable**   Diseno UX      Dashboard operativo                   Sprint 3
  **e2e-ux-validation**      QA + Dev       Validacion end-to-end                 Transversal
  -------------------------- -------------- ------------------------------------- -----------------

4.2 Detalle de Cada Skill

ui-component-system

Migracion de CSS artesanal a shadcn/ui + Tailwind CSS. Incluye: instalar
y configurar Tailwind + shadcn/ui, crear los componentes base (Button,
Card, Badge, Dialog, Sheet, Tabs, DropdownMenu, Toast, Form, Input,
Select, Textarea), migrar cada pantalla progresivamente del CSS actual a
los nuevos componentes, eliminar globals.css cuando la migracion este
completa.

data-table-pro

Componente DataTable construido sobre TanStack Table v8 con renderizado
shadcn/ui. Funcionalidades: paginacion servidor/cliente, ordenamiento
por columna, filtrado global y por columna, seleccion de filas,
redimensionamiento de columnas, columnas fijas (sticky), formateo
numerico (moneda, porcentaje), celdas editables inline, y boton de
exportacion a XLSX (via SheetJS). Este componente se usa en Portfolio
720, Operaciones IRPF, Activos canonicos, Eventos fiscales y Bandeja de
revision.

fiscal-workspace-ux

Rediseno de la ficha de cliente como workspace con pestanas. Incluye:
layout de pestanas con badge de estado por seccion, componente
PatrimonioTable (la vista tipo XLS del 720), componente OperacionesTable
(consolidado por ejercicio), componente PatrimonioIPTable (valoracion a
cierre), panel lateral de contexto (unidad fiscal siempre visible),
drill-down desde tabla a expediente o documento origen.

stepper-workflow

Componente ExpedienteStepper con 5 fases visuales. Incluye: barra de
progreso horizontal con estados por fase, descomposicion del monolito en
5 componentes de fase, logica de bloqueo (no avanzar si fase previa
incompleta), contexto fijo compartido (cliente, modelo, ejercicio),
transiciones animadas entre fases.

xls-export-engine

Motor de exportacion XLS nativo desde las tablas de datos. Incluye:
generacion de XLSX via SheetJS desde cualquier DataTable, formatos
predefinidos para Portfolio 720, Operaciones IRPF y Patrimonio IP,
exportacion con cabeceras, formulas de subtotal y formato numerico, y un
boton Export XLS integrado en cada tabla.

form-builder-fiscal

Formularios estructurados para datos fiscales con validacion Zod.
Incluye: formulario de Unidad Fiscal con campos tipados y validacion en
tiempo real, formulario de Activo Canonico (creacion y edicion inline),
formulario de Evento Fiscal, componente de aprobacion canonica con
checklist, y formularios responsivos que funcionan tanto en modal como
en panel lateral.

dashboard-actionable

Rediseno del dashboard para priorizar accion operativa. Incluye:
reemplazar KPIs tecnicos por cards de accion (siguiente cliente,
siguiente expediente, bloqueos criticos), timeline de actividad reciente
del equipo, vista rapida de cobertura declarativa por modelo (100, 714,
720) con semaforo, y links directos al trabajo pendiente mas urgente.

e2e-ux-validation

Suite de tests E2E enfocada en flujos de usabilidad. Incluye: test de
navegacion completa (login, cartera, cliente, expediente, revision,
modelos), test de interaccion con DataTable (filtrar, ordenar, paginar,
exportar), test de flujo de expediente completo por fases, y test de
edicion de canonico con aprobacion.

5\. Plan de Ejecucion

5.1 Sprints Propuestos

  -------------- ------------------------------------------------------------------------ ----------------------------------------------- -------------------
  **Sprint**     **Alcance**                                                              **Entregable**                                  **Duracion est.**
  **Sprint 0**   Infraestructura UI: Tailwind + shadcn + DataTable base                   Libreria componentes funcionando                3-4 dias
  **Sprint 1**   Workspace cliente: pestanas + Portfolio 720 tabla + Stepper expediente   Ficha cliente rediseanda + Expediente modular   5-7 dias
  **Sprint 2**   Tablas operativas: Operaciones IRPF + Canonico editable + Export XLS     Tablas completas con export                     4-5 dias
  **Sprint 3**   Dashboard accionable + Bandeja mejorada + Formularios fiscales           UX completa end-to-end                          4-5 dias
  **Sprint 4**   E2E, polish visual, migracion CSS residual, validacion con usuario       Plataforma lista para piloto                    3-4 dias
  -------------- ------------------------------------------------------------------------ ----------------------------------------------- -------------------

**Estimacion total: 19-25 dias de desarrollo efectivo.**

5.2 Criterio de Aceptacion de la Refactorizacion

1.  El fiscalista puede ver el portfolio completo de un cliente en una
    tabla tipo XLS con filtrado, ordenamiento y exportacion.

2.  El expediente muestra progresion visual por fases y el usuario sabe
    en que punto esta y que le falta.

3.  Cada tabla de datos permite exportar a XLSX con formato profesional.

4.  El dashboard prioriza accion operativa, no metricas tecnicas.

5.  Los componentes de UI son reutilizables y consistentes (shadcn/ui).

6.  La suite E2E cubre los flujos criticos de usabilidad.

7.  El CSS monolitico ha sido eliminado en favor de Tailwind +
    componentes.

5.3 Riesgos y Mitigaciones

  ------------------------------------ --------------------------------------- -----------------------------------------------------------
  **Riesgo**                           **Impacto**                             **Mitigacion**
  Regresion funcional al migrar UI     Romper flujos criticos ya validados     Migrar progresivamente, mantener E2E verde en cada commit
  Sobrecarga de Tailwind en bundle     Aumento tiempo de build                 Purge configurado, componentes bajo demanda
  DataTable lento con muchos activos   Lag en portfolio grandes (500+ filas)   Paginacion servidor, virtualizacion si necesario
  Scope creep en diseno                Sprint 1 se extiende indefinidamente    Fijar wireframes antes de codificar, iterar despues
  ------------------------------------ --------------------------------------- -----------------------------------------------------------

6\. Stack Tecnico Propuesto

6.1 Dependencias Nuevas

  -------------------------------- ----------------------------- -------------------------------
  **Dependencia**                  **Proposito**                 **Peso estimado**
  **tailwindcss**                  Sistema de utilidades CSS     \~30KB gzip (purged)
  **\@radix-ui/\* (via shadcn)**   Primitivas accesibles de UI   Tree-shakeable, solo lo usado
  **\@tanstack/react-table**       Motor de tabla headless       \~15KB gzip
  **xlsx (SheetJS)**               Exportacion XLS nativa        \~90KB gzip (lazy load)
  **class-variance-authority**     Variantes de componentes      \~2KB gzip
  **clsx + tailwind-merge**        Utilidades de clases CSS      \~3KB gzip
  -------------------------------- ----------------------------- -------------------------------

Nota: Zod ya esta en el proyecto. No se anade peso adicional para
validacion de formularios.

6.2 Estructura de Carpetas Propuesta

apps/web/components/ui/ \-- componentes shadcn/ui base

apps/web/components/data-table/ \-- DataTable generico + variantes

apps/web/components/fiscal/ \-- componentes de dominio fiscal

apps/web/components/workspace/ \-- layouts de workspace (cliente,
expediente)

apps/web/components/stepper/ \-- componente de stepper generico

apps/web/components/forms/ \-- formularios fiscales con Zod

apps/web/hooks/ \-- hooks compartidos (useDataTable, useFiscalUnit\...)

7\. Conclusion y Siguientes Pasos

La plataforma tiene una base tecnica solida: el modelo de datos, los
flujos API, la autenticacion y el motor fiscal estan construidos
correctamente. El problema es exclusivamente de capa de presentacion: la
informacion existe pero no se expone de la forma que el fiscalista
necesita para trabajar.

La refactorizacion propuesta no toca el backend, las APIs ni el modelo
de datos. Se concentra enteramente en:

-   Adoptar un sistema de componentes profesional (shadcn/ui + Tailwind)

-   Construir un DataTable reutilizable que hable el idioma del
    fiscalista (tabla tipo XLS)

-   Redisenar la ficha de cliente como workspace patrimonial con vistas
    tabulares

-   Modularizar el expediente en un flujo por fases con progresion
    visual

-   Validar con E2E que la usabilidad no regresione

**Siguiente paso inmediato:** Aprobar esta propuesta y arrancar Sprint 0
(infraestructura UI). Una vez que Tailwind, shadcn/ui y el DataTable
base esten operativos, cada sprint posterior construye sobre esa base
sin riesgo de regresion.

\-\--

*Documento preparado como base de decision para la refactorizacion UX de
la Plataforma Fiscal Patrimonial.*
