# SIGECO: Sistema Integral de Gestión de Cobranza

Aplicación web para el seguimiento operativo de la cobranza municipal: expedientes, asignación a funcionarios, gestiones, pagos, alertas y bitácora de auditoría.

| | |
|---|---|
| **Responsable** | Jorge Jamil Espinoza Villa, Analista Financiero |
| **Área** | Dirección General Financiera, M.I. Municipalidad de Guayaquil |
| **Estado** | En operación, dos instancias |
| **Plataforma** | Google Apps Script (V8) y Google Sheets |
| **Uso** | Interno. Repositorio privado |

## Contenido

[Qué hace](#qué-hace) · [Arquitectura](#arquitectura) · [Flujo de trabajo](#flujo-de-trabajo) · [Ciclo de vida del expediente](#ciclo-de-vida-del-expediente) · [Alertas](#alertas) · [Roles y permisos](#roles-y-permisos) · [Instancias](#instancias) · [Estructura](#estructura-del-repositorio) · [Ejemplo](#ejemplo-con-datos-ficticios) · [Consultas SQL](#consultas-sql) · [Documentación](#documentación) · [Seguridad](#datos-y-seguridad)

## Qué hace

- Carga el padrón de contribuyentes con deuda desde el reporte de origen.
- Crea un expediente por contribuyente y lo asigna a un gestor.
- Registra cada gestión de cobro (llamada telefónica, correo electrónico y otros) con su resultado y próxima fecha.
- Registra pagos y calcula saldo pendiente y porcentaje recuperado.
- Genera alertas por días sin movimiento y por gestiones vencidas, con aviso por correo.
- Cierra expedientes y los archiva con motivo y responsable.
- Deja una bitácora de auditoría de cada cambio.
- Entrega un tablero de indicadores y respaldos diarios.

## Arquitectura

```mermaid
flowchart LR
    subgraph U["Usuarios (inicio de sesión propio)"]
        direction TB
        A["Administrador"]
        S["Supervisor"]
        G["Gestor"]
        AU["Auditor"]
    end
    subgraph GAS["Google Apps Script"]
        direction TB
        W["Aplicación web<br/>Code.gs + Index.html"]
        SV["Servicios<br/>sesiones · expedientes · gestiones · pagos<br/>alertas · importación · tablero · bitácora"]
        T["Triggers<br/>alertas diarias 07:00 · respaldo diario<br/>limpieza de sesiones cada 4 h · cola de tareas"]
    end
    DB[("Google Sheets<br/>una hoja de cálculo por instancia")]
    EXT["Gmail · Calendar · Drive"]
    PBI["Power BI<br/>solo Patente Municipal"]

    U --> W --> SV --> DB
    T --> SV
    SV --> EXT
    PBI <-.-> SV
```

## Flujo de trabajo

```mermaid
flowchart TD
    I["Administrador importa el padrón"] --> E["Se crea un expediente por contribuyente<br/>PENDIENTE_ASIGNACION"]
    E --> AS["Supervisor asigna a un gestor"]
    AS --> GE["Gestor registra una gestión<br/>llamada · correo · otro"]
    GE --> R{"Resultado"}
    R -->|"No contactado o número equivocado"| GE
    R -->|"Promesa de pago"| C["COMPROMETIDO_PAGO"]
    R -->|"Requiere revisión"| D["DERIVADO_SUPERVISOR"]
    D --> AS
    C --> P["Supervisor registra el pago<br/>abono · pago total · cuota de convenio"]
    P --> Z{"Saldo pendiente"}
    Z -->|"Mayor que cero"| GE
    Z -->|"Cero"| X["CERRADO_EXITOSO<br/>pasa a EXPEDIENTES_CERRADOS"]
    GE -.-> B[("BITACORA<br/>cada cambio queda registrado")]
    P -.-> B
```

## Ciclo de vida del expediente

Estados definidos en `Constants.gs`. El flujo habitual es el siguiente; el sistema no impone un orden fijo entre estados.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> PENDIENTE_ASIGNACION
    PENDIENTE_ASIGNACION --> EN_GESTION: asignación
    EN_GESTION --> CONTACTADO
    EN_GESTION --> NO_CONTACTADO
    NO_CONTACTADO --> EN_GESTION: nuevo intento
    CONTACTADO --> COMPROMETIDO_PAGO
    COMPROMETIDO_PAGO --> PAGO_POR_CONFIRMAR
    PAGO_POR_CONFIRMAR --> CERRADO_EXITOSO
    EN_GESTION --> DERIVADO_SUPERVISOR
    DERIVADO_SUPERVISOR --> EN_GESTION
    EN_GESTION --> CERRADO_EXENTO: exención verificada
    CERRADO_EXITOSO --> [*]
    CERRADO_EXENTO --> [*]
```

La instancia de Patente Municipal agrega los estados `GESTION_PAUSADA`, `CERRADO_SIN_ACUERDO` y `DERIVADO_TITULO`.

## Alertas

Cada expediente lleva un estado de alerta que se recalcula todos los días a las 7:00 y alimenta la hoja `SEGUIMIENTO`.

| Alerta | Parámetro en `Constants.gs` | Valor |
|---|---|---|
| `OK` | | |
| `SIN_MOVIMIENTO` | `DIAS_ALERTA_SIN_MOVIMIENTO` | 15 días sin gestión |
| `PROXIMO_VENCER` | `DIAS_ALERTA_PROXIMO_VENCER` | 3 |
| `VENCIDO` | `DIAS_ALERTA_VENCIDO` | 0 |
| `CRITICO` | `DIAS_ALERTA_CRITICO` | 30 |

Los valores se ajustan en la hoja `CONFIG` sin tocar el código. Las alertas `VENCIDO` y `CRITICO` pueden enviarse por correo.

## Roles y permisos

Cuatro roles jerárquicos. Cada acción exige un nivel mínimo, tomado de `PERMISOS` en `Constants.gs`.

| Acción | Administrador | Supervisor | Gestor | Auditor |
|---|:-:|:-:|:-:|:-:|
| Ver todos los expedientes | ✔ | ✔ | – | – |
| Ver sus propios expedientes | ✔ | ✔ | ✔ | – |
| Crear expediente | ✔ | ✔ | ✔ | – |
| Actualizar expediente | ✔ | ✔ | ✔ | – |
| Marcar cierre exitoso | ✔ | ✔ | ✔ | – |
| Reasignar expediente | ✔ | ✔ | – | – |
| Cerrar expediente | ✔ | ✔ | – | – |
| Cerrar por exención | ✔ | ✔ | – | – |
| Ver expedientes cerrados | ✔ | ✔ | – | – |
| Reabrir expediente | ✔ | ✔ | – | – |
| Registrar gestión | ✔ | ✔ | ✔ | – |
| Ver seguimiento y alertas | ✔ | ✔ | – | – |
| Ver bitácora de auditoría | ✔ | ✔ | ✔ | ✔ |
| Ver tablero de indicadores | ✔ | ✔ | ✔ | – |
| Importar contribuyentes | ✔ | – | – | – |
| Gestionar usuarios | ✔ | – | – | – |
| Modificar configuración | ✔ | – | – | – |
| Registrar pago | ✔ | ✔ | – | – |
| Verificar integridad de datos | ✔ | – | – | – |
| Insertar datos de prueba | ✔ | – | – | – |

La sesión dura 8 horas, el inicio de sesión se bloquea 15 minutos tras 5 intentos fallidos y solo se aceptan correos del dominio institucional.

## Instancias

Un mismo sistema desplegado para dos líneas de cobro. Cada instancia tiene su propia hoja de cálculo y su propio proyecto de Apps Script.

| Instancia | Carpeta | Particularidades |
|---|---|---|
| Bahías | [`apps-script/bahias/`](apps-script/bahias/) | Datos del puesto comercial: mercado, asociación, giro del negocio, código CEP |
| Patente Municipal | [`apps-script/patente-municipal/`](apps-script/patente-municipal/) | Deuda por año e impuesto; integración con Power BI; claves en propiedades del script; estados adicionales |

## Estructura del repositorio

```
.
├── apps-script/
│   ├── bahias/                     proyecto Apps Script de la instancia Bahías
│   │   ├── Code.gs                 punto de entrada de la aplicación web
│   │   ├── Index.html              interfaz
│   │   ├── Constants.gs            catálogos, roles, permisos y parámetros
│   │   ├── Auth.gs · SecurityService.gs   sesiones y permisos
│   │   ├── Expediente*.gs · GestionService.gs · PagoService.gs   núcleo de cobranza
│   │   ├── AlertService.gs · SeguimientoService.gs   alertas y seguimiento
│   │   ├── ImportService.gs · DriveImportService.gs   carga del padrón
│   │   ├── DashboardService.gs     indicadores
│   │   ├── BitacoraService.gs      auditoría
│   │   ├── BackupService.gs        respaldo diario
│   │   └── Setup.gs                instalación inicial
│   └── patente-municipal/          misma estructura, más PowerBIService.gs,
│                                   SecretsService.gs y ExportService.gs
├── consultas/                      consultas SQL de la instancia Patente Municipal
│   ├── README.md
│   ├── detalle-de-contribuyentes-por-anio-de-solicitud_v202610.sql
│   └── pagos-y-reversos-patente-y-1-5-por-mil_v202610.sql
├── docs/
│   ├── modelo-de-datos.md          hojas, columnas y relaciones
│   ├── arquitectura-y-modulos.md   módulos y automatizaciones
│   └── despliegue.md               instalación paso a paso
└── SEGURIDAD.md                    qué nunca se sube
```

## Ejemplo con datos ficticios

Un expediente tal como lo ve el sistema. Todos los datos son inventados.

| Campo | Valor de ejemplo |
|---|---|
| `ID_EXPEDIENTE` | `EXP-000123` |
| `RUC` | `0990000000001` |
| `CONTRIBUYENTE` | `COMERCIAL EJEMPLO S.A.` |
| `TIPO_OBLIGACION` | `IMPUESTO_PATENTE` |
| `ESTADO_EXPEDIENTE` | `COMPROMETIDO_PAGO` |
| `PRIORIDAD` | `ALTA` |
| `FUNCIONARIO_ASIGNADO` | `gestor.ejemplo@guayaquil.gob.ec` |
| `TOTAL_DEUDA` | 1.200,00 |
| `MONTO_PAGADO` | 300,00 |
| `SALDO_PENDIENTE` | 900,00 |
| `PORCENTAJE_RECUPERADO` | 25 % |
| `ALERTA_ESTADO` | `PROXIMO_VENCER` |

Gestiones registradas sobre ese expediente:

| Fecha | Tipo | Resultado | Próxima gestión |
|---|---|---|---|
| 2026-01-12 | `LLAMADA_TELEFONICA` | `NO_CONTACTADO` | 2026-01-14 |
| 2026-01-14 | `LLAMADA_TELEFONICA` | `CONTACTO_EFECTIVO` | 2026-01-21 |
| 2026-01-21 | `CORREO_ELECTRONICO` | `PROMESA_PAGO` | 2026-02-04 |

## Consultas SQL

La instancia Patente Municipal se alimenta con 2 consultas al data warehouse municipal: el detalle de contribuyentes por año de solicitud y los pagos y reversos de patente y del 1,5 por mil. Están en [`consultas/`](consultas/README.md) como versiones sanitizadas, sin RUC ni servidor.

## Documentación

| Documento | Contenido |
|---|---|
| [Modelo de datos](docs/modelo-de-datos.md) | Hojas, columnas y relaciones de cada instancia |
| [Arquitectura y módulos](docs/arquitectura-y-modulos.md) | Roles, módulos y automatizaciones |
| [Despliegue](docs/despliegue.md) | Instalación paso a paso de una instancia |
| [Seguridad](SEGURIDAD.md) | Qué nunca se sube y qué hacer si ocurre |

## Datos y seguridad

Este repositorio **no contiene datos de contribuyentes, claves ni respaldos**. Las bases de datos se guardan en el almacenamiento institucional. Las claves se leen de las propiedades del script. Ver [`SEGURIDAD.md`](SEGURIDAD.md).
