# PRD Funcional y Trazabilidad

Referencia de producto actualizada a 2026-03-09.

Fuentes de verdad funcional usadas para esta PRD:

- `docs/HANDOFF_2026-03-07.md`
- `docs/BASELINE_FUNCIONAL_2026-03-06.md`
- `docs/phases-roadmap.md`
- `docs/architecture.md`
- runtime actual de `apps/web`

## 1. Proposito del producto

La aplicacion ya no debe entenderse como un visor de extracciones ni como una herramienta de parsing.

Su proposito es ser una plataforma de gestion patrimonial-fiscal para despacho, centrada en:

1. Cliente
2. Unidad fiscal del cliente
3. Expediente anual por ejercicio
4. Registro canonico de activos patrimoniales
5. Registro canonico de eventos fiscales
6. Preparacion y salida de modelos AEAT

Modelos objetivo:

- Modelo 100 IRPF
- Modelo 714 Impuesto sobre el Patrimonio
- Modelo 720

## 2. Objetivo funcional

Permitir que un despacho fiscal-patrimonial trabaje de forma operativa sobre una cartera de clientes asignados, recorriendo un flujo anual de trabajo:

`cliente -> expediente -> documental -> revision -> canonico -> modelos AEAT`

El sistema debe servir para:

- ordenar la carga real de trabajo por cliente y expediente
- consolidar documentacion y evidencias
- convertir evidencias en registro canonico patrimonial-fiscal
- preparar validaciones, informes, XLS y salidas AEAT
- hacer visible que falta, que esta bloqueado y que esta listo para cierre

## 3. Usuarios y roles

### 3.1 Roles de producto

- `admin`
  - administra usuarios, accesos y configuracion de plataforma
  - puede editar unidad fiscal y gobernar operativa completa

- `fiscal_senior`
  - revisa, aprueba canonicamente y cierra preparacion declarativa
  - puede editar unidad fiscal y aprobar trabajo funcional

- `fiscal_junior`
  - trabaja documental, revision manual, preparacion y seguimiento de expedientes
  - no gobierna configuracion ni aprobacion funcional final

- `solo_lectura`
  - consulta cartera, cliente, expediente y modelos
  - no altera datos ni estados

### 3.2 Personas operativas

- Responsable de cartera
- Fiscalista documental
- Fiscalista revisor
- Responsable de cierre declarativo
- Usuario demo o stakeholder de presentacion

## 4. Modelo de objetos del producto

### 4.1 Cliente

Objeto raiz de navegacion y asignacion.

Debe concentrar:

- identificacion fiscal y comercial
- equipo asignado
- unidad fiscal
- expedientes por ejercicio
- documentacion agregada
- portfolio patrimonial agregado
- eventos fiscales agregados

### 4.2 Unidad fiscal

Subobjeto del cliente que gobierna todos los expedientes anuales.

Campos funcionales minimos:

- sujeto pasivo
- NIF del sujeto pasivo
- conyuge
- NIF del conyuge
- alcance declarativo
- condicion del declarante
- condicion del conyuge
- vinculacion fiscal
- notas

### 4.3 Expediente

Objeto anual de trabajo. Debe existir explicitamente y no nacer como efecto lateral de la ingesta.

Clave funcional:

- `cliente + ejercicio + modelo + referencia`

Responsabilidades:

- concentrar el estado documental
- concentrar el estado de revision
- gobernar el canonico del ejercicio
- preparar el modelo AEAT correspondiente

### 4.4 Documento y extraccion

No son el objeto nuclear del sistema. Son evidencia y origen.

Responsabilidades:

- custodiar el documento fuente
- registrar la extraccion
- permitir correccion y aprobacion
- mantener trazabilidad hacia el registro canonico

### 4.5 Activo canonico

Representa un activo patrimonial consolidado del cliente.

Campos funcionales relevantes:

- clase patrimonial
- clave operativa
- ISIN o identificador
- pais
- titularidad
- porcentaje
- valor fin de ejercicio
- saldo medio Q4
- metodo de valoracion
- bloque 720
- expedientes vinculados
- operaciones/eventos vinculados

### 4.6 Evento fiscal canonico

Hecho fiscal atomico asociado a un activo.

Tipos funcionales:

- dividendo
- interes
- adquisicion
- transmision
- retencion
- ganancia/perdida
- posicion

### 4.7 Modelo / export

Artefacto derivado, nunca fuente de verdad.

Salidas esperadas:

- validacion
- informe
- XLS operativo
- AEAT

## 5. Principios de arquitectura funcional

1. La entrada natural de trabajo es la cartera del usuario, no la cola tecnica del parser.
2. El cliente es la raiz de navegacion.
3. El expediente es el contenedor anual de trabajo.
4. El parser queda subordinado al flujo documental.
5. El registro canonico es la fuente de verdad patrimonial-fiscal.
6. Los modelos AEAT consumen canonico y workflow, no extracciones raw.
7. Configuracion no debe mezclarse con trabajo operativo.

## 6. Arquitectura de informacion y menu lateral

El menu lateral del producto debe representar la logica de trabajo del despacho.

Opciones actuales objetivo:

1. `Mi cartera`
2. `Clientes`
3. `Bandeja de trabajo`
4. `Modelos AEAT`
5. `Configuracion`

### 6.1 Mi cartera (`/`)

Proposito:

- ser la home operativa del usuario autenticado
- priorizar trabajo real
- responder que cliente o expediente requiere atencion ahora

Que debe mostrar:

- clientes asignados al usuario
- expedientes activos y su prioridad
- pendientes de revision
- alertas abiertas y criticas
- recomendacion de siguiente paso
- cobertura por modelo

Logica funcional:

- si hay revision manual o alertas abiertas, el CTA principal debe llevar a `Bandeja de trabajo`
- si no hay bloqueos y existen expedientes activos, el CTA principal debe llevar al expediente mas prioritario
- si no hay expedientes, el CTA principal debe llevar a `Clientes`

No debe mostrar como foco principal:

- metricas tecnicas de parser
- un expediente demo fijo
- lenguaje de consola de extraccion

Historias de usuario:

- `HU-DASH-01`: como fiscalista quiero entrar y ver mi carga priorizada por cliente y expediente
- `HU-DASH-02`: como responsable quiero detectar rapidamente revision manual y alertas criticas
- `HU-DASH-03`: como usuario quiero saltar desde la home al siguiente workspace correcto

### 6.2 Clientes (`/clientes`)

Proposito:

- servir como base de cartera del despacho
- permitir entrar a un cliente concreto
- permitir alta de cliente cuando el rol lo permita

Que debe mostrar:

- listado de clientes visibles
- estado del cliente
- numero de expedientes
- carga documental y revision
- ultima actividad

Logica funcional:

- la tabla es una cartera, no una agenda comercial
- el click principal entra a la ficha singular del cliente
- el alta de cliente es secundaria respecto a la cartera

Historias de usuario:

- `HU-CLI-01`: como usuario quiero ver todos mis clientes y su carga operativa
- `HU-CLI-02`: como admin quiero poder dar de alta un cliente nuevo
- `HU-CLI-03`: como fiscalista quiero entrar a un cliente y ver sus expedientes por ejercicio

### 6.3 Bandeja de trabajo (`/review`)

Proposito:

- separar la cola operativa del fiscalista de la gestion por expediente
- resolver revision manual e incidencias documentales

Que debe mostrar:

- items pendientes priorizados
- filtros por cliente, expediente, cola, prioridad, modelo y ejercicio
- detalle del item
- registros extraidos editables
- alertas del expediente
- workflow reciente

Logica funcional:

- la bandeja es transversal y multi-expediente
- las acciones `mantener`, `rechazar` y `aprobar` deben alterar estado real
- el sistema debe dejar claro que cambia cada accion
- tras resolver un item, el usuario debe poder ir al expediente o volver al cliente

Historias de usuario:

- `HU-REV-01`: como fiscalista quiero una cola priorizada de revision manual
- `HU-REV-02`: como fiscalista quiero corregir registros antes de aprobar
- `HU-REV-03`: como responsable quiero que la bandeja refleje ownership, prioridad y siguiente accion

### 6.4 Modelos AEAT (`/modelos`)

Proposito:

- funcionar como mesa declarativa
- mostrar si cada expediente esta listo, con atencion o bloqueado

Que debe mostrar:

- resumen por modelo
- work items por expediente y modelo
- unidad fiscal del cliente
- bloqueos declarativos
- siguiente accion operativa

Logica funcional:

- no es un listado de exportes sin contexto
- debe responder por que un expediente no esta listo
- debe conectar con la fase `modelos` del expediente

Historias de usuario:

- `HU-MOD-01`: como fiscalista quiero saber que expedientes estan listos para Modelo 100, 714 o 720
- `HU-MOD-02`: como responsable quiero ver bloqueos declarativos por modelo
- `HU-MOD-03`: como usuario quiero saltar desde la mesa declarativa al expediente correcto

### 6.5 Configuracion (`/configuracion`)

Proposito:

- alojar solo gobierno de plataforma

Que debe mostrar:

- usuarios
- roles
- asignaciones
- estado de entorno
- limites de que pertenece o no a configuracion

Logica funcional:

- no debe contener trabajo operativo de cliente ni expediente
- debe separar conceptualmente `demo`, `sandbox` y `acceso autenticado`
- debe gobernar acceso, no el trabajo fiscal diario

Historias de usuario:

- `HU-CONF-01`: como admin quiero gestionar usuarios y asignaciones
- `HU-CONF-02`: como responsable quiero entender en que entorno estoy trabajando
- `HU-CONF-03`: como producto quiero evitar que configuracion absorba operativa de expedientes

## 7. Pantallas fuera del menu lateral pero nucleares

### 7.1 Login (`/login`)

Proposito:

- acceso controlado al prototipo o a la operacion autenticada

Debe mostrar:

- perfiles de acceso de test cuando aplique
- password comun de demo cuando aplique
- mensaje claro del entorno

Historias de usuario:

- `HU-ACC-01`: como tester quiero entrar con un perfil fijo sin friccion
- `HU-ACC-02`: como usuario quiero entender en que entorno estoy entrando

### 7.2 Ficha singular de cliente (`/clientes/[id]`)

Proposito:

- ser la vista raiz del trabajo de un cliente concreto

Debe mostrar:

- cabecera del cliente
- siguiente paso prioritario
- unidad fiscal editable segun rol
- expedientes por ejercicio
- documentacion y extraccion
- portfolio patrimonial
- eventos fiscales recientes
- vista tipo XLS del portfolio 720

Logica funcional:

- desde aqui se debe entrar al expediente adecuado
- la unidad fiscal debe gobernar todos los expedientes del cliente
- el portfolio debe verse de forma agregada por cliente, no solo por expediente
- debe existir una vista de hoja operativa para 720 con:
  - cuentas
  - IIC
  - valores
  - seguros
  - inmuebles
  - muebles / otros
  - clave operativa
  - bloque 720
  - valor declarable
  - titularidad
  - expedientes vinculados
  - operaciones vinculadas
  - incidencias abiertas

Historias de usuario:

- `HU-CLD-01`: como fiscalista quiero ver todos los expedientes de un cliente agrupados por ejercicio
- `HU-CLD-02`: como fiscalista quiero revisar la unidad fiscal del cliente y corregirla
- `HU-CLD-03`: como fiscalista quiero ver toda la documentacion del cliente con su estado de extraccion
- `HU-CLD-04`: como fiscalista quiero una vista tipo XLS del portfolio 720 del cliente para analizar el portfolio completo

### 7.3 Expediente anual (`/expedientes/[id]`)

Proposito:

- ser el workspace anual del cliente para un modelo y ejercicio concretos

Fases:

1. `resumen`
2. `documental`
3. `revision`
4. `canonico`
5. `modelos`

#### Fase resumen

Debe mostrar:

- estado general del expediente
- workflow
- ownership
- tarea pendiente
- siguiente hito

#### Fase documental

Debe mostrar:

- estado documental
- tabla de documentos
- formulario de carga
- explicacion de que hace la ingesta

Regla:

- la ingesta solo opera sobre expedientes existentes y vinculados a cliente

#### Fase revision

Debe mostrar:

- documentos pendientes del expediente
- acceso a bandeja filtrada
- criterio de avance

Regla:

- no debe poder cerrarse logicamente si quedan documentos en revision o fallo

#### Fase canonico

Debe mostrar:

- activos canonicos
- eventos fiscales canonicos
- edicion manual
- aprobacion canonica

Regla:

- el canonico es la fuente de verdad para AEAT

#### Fase modelos

Debe mostrar:

- checklist declarativo
- validaciones
- salidas disponibles
- informe
- XLS
- AEAT

Regla:

- no debe permitir salida AEAT final si el canonico no esta aprobado

Historias de usuario:

- `HU-EXP-01`: como fiscalista quiero recorrer el flujo completo del expediente sin salir del workspace
- `HU-EXP-02`: como revisor quiero ver que bloquea el avance del expediente
- `HU-EXP-03`: como responsable quiero aprobar el canonico antes de la salida declarativa

## 8. Workflow funcional del producto

Flujo objetivo:

1. Alta o seleccion de cliente
2. Configuracion o validacion de unidad fiscal
3. Alta de expediente anual
4. Carga documental
5. Parseo
6. Revision manual cuando aplique
7. Incorporacion al registro canonico
8. Aprobacion canonica
9. Preparacion declarativa
10. Generacion de informe / XLS / AEAT

Estados minimos que el sistema debe gobernar:

- documental
- revision
- canonico
- declarativo
- filing
- aprobacion canonica

## 9. Historias de usuario por bloque

### 9.1 Cartera

- `HU-CAR-01`: como usuario quiero ver mis clientes asignados al entrar
- `HU-CAR-02`: como usuario quiero priorizar expedientes con trabajo manual pendiente
- `HU-CAR-03`: como responsable quiero detectar alertas y bloqueos criticos

### 9.2 Cliente

- `HU-CLI-DET-01`: como usuario quiero ver todos los expedientes de un cliente
- `HU-CLI-DET-02`: como usuario quiero ver el portfolio agregado del cliente
- `HU-CLI-DET-03`: como usuario quiero analizar el 720 del cliente en una vista tipo hoja de calculo

### 9.3 Expediente

- `HU-EXP-DET-01`: como usuario quiero ver el estado documental, fiscal y declarativo del expediente
- `HU-EXP-DET-02`: como usuario quiero cargar documentos directamente en el expediente correcto
- `HU-EXP-DET-03`: como usuario quiero editar el canonico y ver el efecto en modelos

### 9.4 Revision manual

- `HU-REV-DET-01`: como fiscalista quiero corregir registros por campo
- `HU-REV-DET-02`: como fiscalista quiero mantener, rechazar o aprobar con efecto real
- `HU-REV-DET-03`: como responsable quiero trazabilidad del cambio de estado

### 9.5 Modelos AEAT

- `HU-AEAT-01`: como fiscalista quiero saber si un expediente esta listo para presentar
- `HU-AEAT-02`: como fiscalista quiero descargar informe y XLS antes del AEAT
- `HU-AEAT-03`: como responsable quiero ver bloqueos especificos de 714 y 720

### 9.6 Configuracion

- `HU-GOV-01`: como admin quiero asignar usuarios a clientes
- `HU-GOV-02`: como admin quiero ver y mantener roles operativos
- `HU-GOV-03`: como producto quiero evitar mezclar configuracion con trabajo diario

## 10. Reglas funcionales clave

1. El cliente es la raiz de navegacion.
2. El expediente es anual y explicito.
3. Documento y extraccion son evidencia, no objeto rector.
4. El canonico manda sobre informe, XLS y AEAT.
5. La bandeja de trabajo es transversal y distinta del expediente.
6. Configuracion es gobierno de plataforma, no operativa diaria.
7. La vista 720 por cliente debe permitir analizar portfolio completo, no solo activos sueltos.

## 11. No objetivo de esta PRD

No forma parte de esta PRD:

- rehacer el parser en profundidad
- convertir la aplicacion en OCR generalista
- describir detalle juridico exhaustivo de todos los supuestos normativos
- mezclar gobierno tecnico de infraestructura con experiencia funcional del despacho

## 12. Trazabilidad resumida PRD -> pantallas

| Bloque | Ruta principal | Objeto rector | Resultado esperado |
| --- | --- | --- | --- |
| Mi cartera | `/` | cartera del usuario | priorizacion del trabajo real |
| Clientes | `/clientes` | cliente | acceso a ficha singular |
| Ficha cliente | `/clientes/[id]` | cliente | unidad fiscal, expedientes, portfolio, vista 720 |
| Expediente | `/expedientes/[id]` | expediente | flujo anual completo por fases |
| Bandeja | `/review` | item de trabajo | resolucion manual y operativa |
| Modelos | `/modelos` | expediente declarativo | preparacion y bloqueo AEAT |
| Configuracion | `/configuracion` | gobierno de plataforma | usuarios, roles y asignaciones |

## 13. Trazabilidad resumida PRD -> historias clave

| Historia | Pantalla principal | Objetivo |
| --- | --- | --- |
| `HU-DASH-01` | `/` | priorizar cartera |
| `HU-CLI-03` | `/clientes` | entrar al cliente correcto |
| `HU-CLD-04` | `/clientes/[id]` | analizar portfolio 720 en vista XLS |
| `HU-EXP-01` | `/expedientes/[id]` | recorrer el flujo anual completo |
| `HU-REV-01` | `/review` | trabajar la cola manual priorizada |
| `HU-MOD-01` | `/modelos` | ver expedientes listos para 100/714/720 |
| `HU-CONF-01` | `/configuracion` | gobernar usuarios y asignaciones |

## 14. Criterio de aceptacion global

La aplicacion cumple esta PRD cuando:

1. el usuario entra por cartera y no por parser
2. el cliente es la unidad de navegacion principal
3. cada cliente permite abrir sus expedientes por ejercicio
4. cada expediente expone el flujo documental -> revision -> canonico -> modelos
5. la bandeja resuelve trabajo transversal real
6. la ficha de cliente permite analizar el portfolio completo, incluido el 720 en modo hoja/XLS
7. configuracion permanece separada de la operativa diaria
