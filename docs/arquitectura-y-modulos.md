# Arquitectura y módulos de SIGECO

SIGECO es una aplicación web de Google Apps Script (`doGet` en `Code.gs` sirve `Index.html`) que usa Google Sheets como base de datos. Cada instancia (Bahías, Patente Municipal) es un proyecto independiente con su propia hoja.

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
| Carga de datos | `ImportService.gs`, `DriveImportService.gs`, `DataManagementService.gs` |
| Reportes | `DashboardService.gs`, `DocumentService.gs` |
| Auditoría e integridad | `BitacoraService.gs`, `Auditoria.gs`, `IntegrityService.gs`, `VerificacionService.gs` |
| Rendimiento y respaldo | `CacheAPI.gs`, `AsyncService.gs`, `SheetService.gs`, `BackupService.gs`, `TriggerService.gs` |
| Mantenimiento y pruebas | `MantenimientoColumna.gs`, `Scripts/Mantenimiento.gs`, `TestData.gs`, `testHojaGestiones.gs`, `debug_full.gs` |
| Solo Patente Municipal | `PowerBIService.gs` (recibe datos desde Power BI), `PowerBITest.gs`, `SecretsService.gs` (claves en propiedades del script), `ExportService.gs` |

## Automatizaciones (triggers)

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
