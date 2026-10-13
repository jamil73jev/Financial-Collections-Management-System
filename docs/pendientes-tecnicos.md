# Pendientes técnicos conocidos

Observaciones de la revisión del código de octubre de 2026. No cambian cómo funciona hoy el sistema; son mejoras recomendadas, ordenadas por prioridad.

| # | Hallazgo | Dónde | Riesgo | Recomendación |
|:-:|---|---|---|---|
| 1 | La función `syncMasterData` está definida dos veces en el mismo proyecto | Patente Municipal: `ImportService.gs` y `PowerBIService.gs` | En Apps Script gana la definición que se carga al final. La carga desde Drive puede escribir en una hoja distinta de la esperada | Dejar una sola definición (la de `ImportService.gs`) |
| 2 | Módulo de integración con Power BI heredado, sin punto de entrada | `PowerBIService.gs`, `PowerBITest.gs`, `SecretsService.gs` (`installSecrets`) | Código sin uso que confunde y mantiene una clave de API sin necesidad | Retirarlo o archivarlo en una rama |
| 3 | Archivos de depuración y datos de prueba dentro del proyecto de producción | `debug_full.gs`, `Debug_full.gs`, `TestData.gs`, `testHojaGestiones.gs`, `MantenimientoColumna.gs`, `Scripts/Mantenimiento.gs` | Funciones de limpieza o de datos de prueba al alcance del editor | Moverlos a un proyecto de pruebas separado |
| 4 | Un permiso con nombre de rol bajo da acceso a todos los roles superiores | `Constants.gs`: `VER_BITACORA` exige `AUDITOR` (nivel 1) y el control es por nivel mínimo | El Gestor, el Supervisor y el Administrador también ven la bitácora | Confirmar si es lo deseado. Si la bitácora debe ser solo de auditoría, crear un permiso exclusivo |
| 5 | La aplicación web se despliega con acceso `ANYONE` | `appsscript.json` | Cualquier cuenta de Google llega a la pantalla de inicio de sesión | Restringir al dominio institucional si la política de Workspace lo permite (ver `SEGURIDAD.md`) |
| 6 | Las dos instancias son copias que ya divergieron | Los 38 archivos que comparten (`.gs` y `.html`) tienen diferencias; en Bahías las funciones internas llevan sufijo `_` | Una corrección hay que hacerla dos veces y a mano | Evaluar una biblioteca de Apps Script compartida o un solo código con configuración por instancia |
| 7 | Disparador de carga desde Drive sin instalar en Bahías | `TriggerService.gs` de Bahías | Ninguno hoy: la carga es manual con vista previa | Eliminar el código o documentar que es heredado |
| 8 | No hay pruebas automatizadas | Todo el proyecto | Los cambios se validan a mano | Empezar por pruebas de las reglas de importación y de los estados del expediente |
| 9 | No hay capturas de la aplicación en la documentación | `docs/` | La presentación depende solo de texto y diagramas | Agregar capturas con datos ficticios en `docs/img/` |

## Qué ya está resuelto

- Las contraseñas iniciales y las claves salen de las propiedades del script, no del código.
- La importación de Bahías es idempotente, con vista previa, respaldo previo y reporte.
- Hay respaldo diario y bitácora de auditoría.
- El repositorio tiene verificación automática de datos sensibles y enlaces (`.github/scripts/verificar.py`).
