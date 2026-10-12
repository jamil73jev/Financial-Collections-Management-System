# SIGECO: Sistema Integral de Gestión de Cobranza

Aplicación web para el seguimiento operativo de la cobranza municipal: expedientes, asignación a funcionarios, gestiones, pagos, alertas y bitácora de auditoría.

| | |
|---|---|
| **Responsable** | Jorge Jamil Espinoza Villa, Analista Financiero |
| **Área** | Dirección General Financiera, M.I. Municipalidad de Guayaquil |
| **Estado** | En operación, dos instancias |
| **Plataforma** | Google Apps Script (V8) y Google Sheets |
| **Uso** | Interno. Repositorio privado |

## Qué hace

- Carga el padrón de contribuyentes con deuda desde el reporte de origen.
- Crea un expediente por contribuyente y lo asigna a un gestor.
- Registra cada gestión de cobro (llamada telefónica, correo electrónico y otros) con su resultado y próxima fecha.
- Registra pagos y calcula saldo pendiente y porcentaje recuperado.
- Genera alertas por días sin movimiento (15 por defecto) y por gestiones vencidas, con aviso por correo.
- Cierra expedientes y los archiva con motivo y responsable.
- Deja una bitácora de auditoría de cada cambio.
- Entrega un tablero de indicadores y respaldos diarios.

## Instancias

Un mismo sistema desplegado para dos líneas de cobro. Cada instancia tiene su propia hoja de cálculo y su propio proyecto de Apps Script.

| Instancia | Carpeta | Particularidades |
|---|---|---|
| Bahías | [`apps-script/bahias/`](apps-script/bahias/) | Datos del puesto comercial: mercado, asociación, giro del negocio, código CEP |
| Patente Municipal | [`apps-script/patente-municipal/`](apps-script/patente-municipal/) | Deuda por año e impuesto; integración con Power BI y gestión de claves en propiedades del script |

## Estructura del repositorio

```
.
├── apps-script/
│   ├── bahias/               código del proyecto Apps Script
│   └── patente-municipal/    código del proyecto Apps Script
├── docs/
│   ├── modelo-de-datos.md
│   ├── arquitectura-y-modulos.md
│   └── despliegue.md
└── SEGURIDAD.md
```

## Documentación

| Documento | Contenido |
|---|---|
| [Modelo de datos](docs/modelo-de-datos.md) | Hojas, columnas y relaciones de cada instancia |
| [Arquitectura y módulos](docs/arquitectura-y-modulos.md) | Roles, módulos y automatizaciones |
| [Despliegue](docs/despliegue.md) | Instalación paso a paso de una instancia |
| [Seguridad](SEGURIDAD.md) | Qué nunca se sube y qué hacer si ocurre |

## Datos y seguridad

Este repositorio **no contiene datos de contribuyentes, claves ni respaldos**. Las bases de datos se guardan en el almacenamiento institucional. Las claves se leen de las propiedades del script. Ver [`SEGURIDAD.md`](SEGURIDAD.md).
