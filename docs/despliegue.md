# Despliegue de una instancia de SIGECO

1. Crear una hoja de cálculo de Google nueva para la instancia (Bahías o Patente Municipal).
2. Desde la hoja: **Extensiones > Apps Script**. Copiar los archivos `.gs` y `.html` de la carpeta correspondiente y el contenido de `appsscript.json`.
3. Definir en **Propiedades del script** la cuenta del primer administrador:
   - Bahías: `BOOTSTRAP_ADMIN_EMAIL` (correo del dominio permitido) y `BOOTSTRAP_ADMIN_PASSWORD` (mínimo 12 caracteres). `setupSystem` la borra después de crear el usuario.
   - Patente Municipal: `ADMIN_INITIAL_PASSWORD`.
   En ambos casos el administrador debe cambiar la clave en su primer ingreso.
4. Ejecutar la función `setupSystem` (`Setup.gs`) una sola vez: crea las hojas, los encabezados, la configuración por defecto y el usuario administrador. No ejecutar `limpiarSistemaCompleto`: borra la base.
5. Instalar los triggers (alertas, respaldo, limpieza de sesiones).
6. **Implementar > Nueva implementación > Aplicación web.** El `appsscript.json` del repositorio la configura para ejecutarse como el usuario que implementa (`USER_DEPLOYING`) con acceso `ANYONE` (cualquier cuenta de Google); el control real de acceso es el inicio de sesión propio de SIGECO. Evaluar restringirlo más (ver `SEGURIDAD.md`).
7. Cargar el padrón con el módulo de importación. Los datos reales nunca se suben a este repositorio.
8. Verificar con `?health=1` en la URL de la aplicación.

Solo Patente Municipal: ejecutar `installSecrets` (`SecretsService.gs`) para generar la clave de sincronización con Power BI y guardarla únicamente en las propiedades del script.
