# Despliegue de una instancia de SIGCC

1. Crear una hoja de cálculo de Google nueva para la instancia (Bahías o Patente Municipal).
2. Desde la hoja: **Extensiones > Apps Script**. Copiar los archivos `.gs` y `.html` de la carpeta correspondiente y el contenido de `appsscript.json`.
3. Definir en **Propiedades del script** la cuenta del primer administrador:
   - Bahías: `BOOTSTRAP_ADMIN_EMAIL` (correo del dominio permitido) y `BOOTSTRAP_ADMIN_PASSWORD` (mínimo 12 caracteres). `setupSystem` la borra después de crear el usuario.
   - Patente Municipal: `ADMIN_INITIAL_PASSWORD`.
   En ambos casos el administrador debe cambiar la clave en su primer ingreso.
4. Ejecutar la función `setupSystem` (`Setup.gs`) una sola vez: crea las hojas, los encabezados, la configuración por defecto y el usuario administrador. No ejecutar `limpiarSistemaCompleto`: borra la base.
5. Instalar los triggers con `installAllTriggers` (alertas, respaldo, limpieza de sesiones; en Patente Municipal también la carga diaria desde Drive).
6. **Implementar > Nueva implementación > Aplicación web.** El `appsscript.json` del repositorio la configura para ejecutarse como el usuario que implementa (`USER_DEPLOYING`) con acceso `ANYONE` (cualquier cuenta de Google); el control real de acceso es el inicio de sesión propio de SIGCC. Evaluar restringirlo más (ver `SEGURIDAD.md`).
7. Preparar el ETL y cargar el padrón. Los datos reales nunca se suben a este repositorio.
   - Bahías: crear la hoja de preparación desde la aplicación (botón de ETL de contribuyentes), pegar la tabla exportada, revisar la vista previa y confirmar.
   - Patente Municipal: ejecutar `setupDriveFolders` (crea `SIGECO_ETL/IMPORTS` y `PROCESSED`), subir el CSV a `IMPORTS` y esperar el disparador de las 6:00 o ejecutar `importCSVFromDrive`. Para pagos, crear la hoja con `setupPagosETLSheet` y usar el botón de ETL de pagos.
8. Verificar con `?health=1` en la URL de la aplicación.

Solo Patente Municipal: `installSecrets` (`SecretsService.gs`) guarda una clave en las propiedades del script. La usaba el módulo heredado `PowerBIService.gs`; la conexión directa con Power BI se eliminó (`doPost` ya no existe), así que el flujo actual no la necesita.

## Pruebas

La lógica de importación se prueba sin desplegar nada: `npm test` (Node 22 o superior) carga los archivos `.gs` reales con las APIs de Google simuladas y comprueba la normalización de identificaciones e importes, la vista previa de Bahías y el análisis de CSV de Patente Municipal. La misma prueba corre en GitHub en cada cambio.
