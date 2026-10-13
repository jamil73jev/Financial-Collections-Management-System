# Historial de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen `MAYOR.MENOR.PARCHE`.

## [1.2.0] - 2026-10-13

### Agregado
- `AVISO.md`: aviso de uso y propiedad intelectual de este repositorio.
- Se explica la sigla CEP (Código Electrónico de Pago) donde aparece.

## [1.1.0] - 2026-10-13

### Agregado
- 17 pruebas automáticas del ETL que cargan el código real de Apps Script (`npm test`) y corren en GitHub.
- Capturas de la interfaz (instancia Bahías) con datos ficticios en `docs/img/`.
- Hallazgo documentado: 13 funciones duplicadas en Patente Municipal, 10 con contenido distinto.

## [1.0.0] - 2026-10-13

Primera versión presentada de forma profesional.

### Agregado
- Documentación como ETL: flujo Power BI, DAX Studio, Apps Script, Google Sheets y aplicación web.
- Guía rápida del ETL (`docs/guia-etl.md`) y lista de pendientes técnicos.
- Consultas SQL sanitizadas de la instancia Patente Municipal (`consultas/`).
- Diagramas de arquitectura, flujo de trabajo, ciclo de vida del expediente y modelo de datos.
- Matriz de roles y permisos generada desde `Constants.gs`.
- Verificación automática de datos sensibles y enlaces, plantilla de cambios y responsable del código.

### Cambiado
- SIGECO queda solo en Apps Script y Google Sheets, en dos instancias (Bahías y Patente Municipal).

### Eliminado
- Prototipo FastAPI + MongoDB.
- Datos, respaldos y claves del repositorio.
