# Arquitectura y módulos de SIGCC

SIGCC es un ETL con aplicación web. Los datos salen del modelo de Power BI (exportados a CSV con DAX Studio), Google Apps Script los procesa, Google Sheets los guarda y una aplicación web en HTML los presenta (`doGet` en `Code.gs` sirve `Index.html`). Cada instancia (Bahías, Patente Municipal) es un proyecto independiente con su propia hoja.

## Roles

| Rol | Nivel | Alcance |
|---|---|---|
| Administrador | 4 | Todo, incluida la gestión de usuarios y la configuración |
| Supervisor | 3 | Ve todos los expedientes y asigna |
| Gestor | 2 | Ve y gestiona solo sus expedientes |
| Auditor | 1 | Consulta de bitácora |

Los permisos por acción se definen en `Constants.gs`.

## Módulos (carpeta `apps-script/<instancia>/`)

| Grupo | Archivos |
|---|---|
| Entrada y configuración | `Code.gs`, `Index.html`, `Constants.gs`, `ConfigService.gs`, `Setup.gs`, `appsscript.json` |
| Seguridad y usuarios | `Auth.gs`, `SecurityService.gs`, `AdminAPI.gs`, `UtilAPI.gs`, `ValidationService.gs` |
| Núcleo de cobranza | `ExpedienteService.gs`, `ExpedienteAPI.gs`, `GestionService.gs`, `PagoService.gs`, `AssignmentService.gs`, `ExpedientesCerradosService.gs`, `ResultadosService.gs` |
| Alertas y seguimiento | `AlertService.gs`, `SeguimientoService.gs`, `NotificationService.gs`, `CalendarService.gs`, `AutomationService.gs` |
| ETL: carga y transformación | Bahías: `Production.gs` (importación productiva), `ImportService.gs`, `DataManagementService.gs`. Patente Municipal: `DriveImportService.gs`, `ImportService.gs`, `DataManagementService.gs` |
| Reportes | `DashboardService.gs`, `DocumentService.gs` |
| Auditoría e integridad | `BitacoraService.gs`, `Auditoria.gs`, `IntegrityService.gs`, `VerificacionService.gs` |
| Rendimiento y respaldo | `CacheAPI.gs`, `AsyncService.gs`, `SheetService.gs`, `BackupService.gs`, `TriggerService.gs` |
| Mantenimiento y pruebas | `MantenimientoColumna.gs`, `Scripts/Mantenimiento.gs`, `TestData.gs`, `testHojaGestiones.gs`, `debug_full.gs` |
| Solo Patente Municipal | `ExportService.gs` (exporta a Excel), `SecretsService.gs` (claves en propiedades del script), `PowerBIService.gs` y `PowerBITest.gs` (heredados: ya no hay punto de entrada que los reciba) |

## ETL

Detalle de cada etapa. El resumen con diagrama está en el [README](../README.md#flujo-de-datos-etl).

1. **Extracción (manual).** El analista exporta con DAX Studio la tabla del modelo de Power BI a CSV. Los encabezados pueden traer el prefijo «Suma de»: el ETL lo quita.
2. **Normalización.** Se detecta el delimitador (coma o punto y coma), se pasan los encabezados a mayúsculas sin tildes ni espacios y se mapean a las columnas de `CONTRIBUYENTES`. Los importes se convierten a número.
3. **Validación.** Se rechazan las filas sin RUC o identificación. Bahías exige además nombre, puesto, tipo de impuesto y periodo; detecta duplicados exactos y claves de obligación repetidas con valores distintos (conflicto).
4. **Carga.** `CONTRIBUYENTES` se reemplaza o se actualiza y se crean los expedientes de los contribuyentes nuevos. Se invalida la caché del tablero.
5. **Trazabilidad.** Cada carga queda en la bitácora. Bahías agrega el reporte `IMPORT_REPORTE` y un respaldo previo en la carpeta `SIGECO_BACKUPS`.

### ETL de pagos (ambas instancias)

`procesarPagosETL` (`procesarPagosETL_` en Bahías) lee la hoja `DATA_POWERBI_IMPORT_PAGOS` (columnas `RUC`, `MONTO_PAGADO`, `TIPO_PAGO`, `REFERENCIA`, `FECHA_PAGO`), busca el expediente activo de cada RUC y registra el pago como abono, pago total o cuota de convenio. `previewMacheoDesdeHoja` y `aplicarMacheoConfirmado` permiten conciliar pagos desde otra hoja con vista previa y confirmación.

## Automatizaciones (triggers)


- ETL desde Drive (solo Patente Municipal): diaria, 6:00. En Bahías el disparador existe pero no se instala; la carga se hace desde la aplicación.
- Alertas de expedientes: diaria, 7:00.
- Respaldo diario de la base.
- Limpieza de sesiones expiradas: cada 4 horas.
- Cola de tareas asíncronas.

Se instalan desde las funciones de cada servicio; revisar `Setup.gs` y `TriggerService.gs`.

## Estados y alertas

Los estados de expediente, prioridades y alertas están en `Constants.gs`. Los días sin movimiento alimentan la hoja `SEGUIMIENTO` y las notificaciones.

## Seguridad

- Las contraseñas se guardan como hash con sal; la clave inicial del administrador se define en las propiedades del script antes de ejecutar `setupSystem` (ver `despliegue.md`).
- Ninguna clave va en el código. Ver `SEGURIDAD.md`.
