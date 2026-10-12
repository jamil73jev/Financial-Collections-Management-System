# SIGECO: Sistema Integral de Gestión de Cobranza

Sistema para el seguimiento operativo de la cobranza municipal: expedientes, asignación a funcionarios, gestiones, pagos, alertas y bitácora de auditoría.

**Responsable:** Jorge Jamil Espinoza Villa, Analista Financiero
**Área:** Dirección General Financiera, M.I. Municipalidad de Guayaquil
**Estado:** en operación (tres instancias)

## Instancias

SIGECO es un mismo sistema desplegado para tres líneas de cobro. Cada instancia tiene su propia base de datos y su propio proyecto de Google Apps Script.

| Instancia | Carpeta | Plataforma |
|---|---|---|
| Bahías | `apps-script/bahias/` | Google Apps Script + Google Sheets |
| Patente Municipal | `apps-script/patente-municipal/` | Google Apps Script + Google Sheets |
| Impuesto 1,5 por mil | `apps-script/impuesto-1-5/` | Google Apps Script + Google Sheets (versión 2.0) |

## Estructura

```
sigeco/
  apps-script/
    bahias/               código exportado del proyecto Apps Script
    patente-municipal/    código exportado del proyecto Apps Script
    impuesto-1-5/         SIGECO 2.0 original y su documentación de despliegue
  SEGURIDAD.md            reglas para no subir datos ni claves
```

## Cómo usar cada carpeta

- **Apps Script:** crear un proyecto nuevo, copiar los archivos `.gs` y `.html` de la instancia, enlazar la hoja de cálculo de esa instancia y ejecutar `Setup` una sola vez. Antes de crear el administrador, definir `ADMIN_INITIAL_PASSWORD` en las propiedades del script.

## Datos

Este repositorio **no contiene datos de contribuyentes**. Las bases de datos (hojas de cálculo y archivos de importación) se guardan en el almacenamiento institucional. Ver `SEGURIDAD.md`.
