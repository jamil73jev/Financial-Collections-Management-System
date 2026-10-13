# Pendientes técnicos conocidos

Observaciones de la revisión del código de octubre de 2026. No cambian cómo funciona hoy el sistema; son mejoras recomendadas, ordenadas por prioridad.

| # | Hallazgo | Dónde | Riesgo | Recomendación |
|:-:|---|---|---|---|
| 1 | **13 funciones están declaradas dos o más veces** en el mismo proyecto, 10 de ellas con contenido distinto | Patente Municipal. Ver el detalle abajo | En Apps Script gana la definición que se carga al final y la otra queda oculta. Con `setConfig` las firmas ni siquiera coinciden. Según el orden de los archivos en el editor, el comportamiento puede diferir del que se lee en el código | Elegir una definición por función y renombrar o eliminar la otra. Bahías ya evitó el problema dando sufijo `_` a las funciones internas |
| 2 | Módulo de integración con Power BI heredado, sin punto de entrada | `PowerBIService.gs`, `PowerBITest.gs`, `SecretsService.gs` (`installSecrets`) | Código sin uso que confunde y mantiene una clave de API sin necesidad | Retirarlo o archivarlo en una rama |
| 3 | Archivos de depuración y datos de prueba dentro del proyecto de producción | `debug_full.gs`, `Debug_full.gs`, `TestData.gs`, `testHojaGestiones.gs`, `MantenimientoColumna.gs`, `Scripts/Mantenimiento.gs` | Funciones de limpieza o de datos de prueba al alcance del editor | Moverlos a un proyecto de pruebas separado |
| 4 | Un permiso con nombre de rol bajo da acceso a todos los roles superiores | `Constants.gs`: `VER_BITACORA` exige `AUDITOR` (nivel 1) y el control es por nivel mínimo | La interfaz oculta la bitácora al Gestor, pero el servidor, al controlar por nivel mínimo, permitiría la consulta a cualquier rol de nivel igual o superior a Auditor si se invoca la API directamente | Confirmar si es lo deseado. Si la bitácora debe ser solo de auditoría, crear un permiso exclusivo y validarlo también en el servidor |
| 5 | La aplicación web se despliega con acceso `ANYONE` | `appsscript.json` | Cualquier cuenta de Google llega a la pantalla de inicio de sesión | Restringir al dominio institucional si la política de Workspace lo permite (ver `SEGURIDAD.md`) |
| 6 | Las dos instancias son copias que ya divergieron | Los 38 archivos que comparten (`.gs` y `.html`) tienen diferencias; en Bahías las funciones internas llevan sufijo `_` | Una corrección hay que hacerla dos veces y a mano | Evaluar una biblioteca de Apps Script compartida o un solo código con configuración por instancia |
| 7 | Disparador de carga desde Drive sin instalar en Bahías | `TriggerService.gs` de Bahías | Ninguno hoy: la carga es manual con vista previa | Eliminar el código o documentar que es heredado |
| 8 | Las pruebas automáticas cubren solo el ETL | `pruebas/` (17 pruebas) | Los estados del expediente, los pagos y los permisos se validan a mano | Ampliar las pruebas a esas áreas |
| 9 | No hay capturas de la aplicación en la documentación | `docs/` | La presentación depende solo de texto y diagramas | Agregar capturas con datos ficticios en `docs/img/` |

### Detalle del punto 1 (Patente Municipal)

| Función | Declarada en | Contenido |
|---|---|---|
| `syncMasterData` | `ImportService.gs`, `PowerBIService.gs` | Distinto: una escribe siempre en `CONTRIBUYENTES`; la otra infiere la hoja según las columnas (por defecto `DATA_POWERBI_IMPORT`) |
| `setConfig` | `AdminAPI.gs`, `ConfigService.gs` | Distinto, con distinta firma: `(clave, valor)` y `(token, clave, nuevoValor)` |
| `_hashPasswordConSalt` | `Auth.gs`, `Setup.gs` | Distinto |
| `getBitacora`, `getAlertSummary`, `getConfigMap`, `runFullCheck` | Servicio y API o utilidades | Distinto |
| `getExpediente`, `getGestiones`, `getHistorialExpediente`, `getSeguimientoData` | `ExpedienteAPI.gs` y el servicio correspondiente | Distinto |
| `diagnosticarContribuyentes`, `_fmt` | Varios archivos | Funciones auxiliares repetidas |

Antes de corregir hay que saber cuál definición se está ejecutando hoy. Se ve en el editor de Apps Script: el orden de los archivos de la lista lateral es el orden de carga y la última definición es la que gana. La prueba `pruebas/estructura.test.js` fija esta lista para detectar duplicados nuevos.

## Qué ya está resuelto

- Las contraseñas iniciales y las claves salen de las propiedades del script, no del código.
- La importación de Bahías es idempotente, con vista previa, respaldo previo y reporte.
- Hay respaldo diario y bitácora de auditoría.
- El repositorio tiene verificación automática de datos sensibles y enlaces (`.github/scripts/verificar.py`) y 17 pruebas del ETL (`npm test`).
