# Seguridad: qué nunca se sube a este repositorio

1. **Datos de contribuyentes:** RUC, nombres, direcciones, correos, teléfonos, deudas o pagos reales. Aplica a CSV, Excel, JSON y respaldos de bases de datos (`dump/`, `*.bson`).
2. **Claves y credenciales:** contraseñas, cadenas de conexión con usuario y clave, tokens, llaves privadas. Se leen de variables de entorno o de las propiedades del script de Apps Script.
3. **Configuración local:** `.claude/settings.local.json`, `.env` (solo se versiona `.env.example` con valores de ejemplo).
4. **Archivos de más de 100 MB:** GitHub los rechaza. Los archivos de Power BI (`.pbix`) no se suben.

## Si una clave o dato se subió por error

1. Cambiar la clave de inmediato, aunque el repositorio sea privado.
2. Quitar el archivo del historial de git (no basta con borrarlo en un commit nuevo).
3. Avisar a la jefatura o a seguridad de la información si eran datos personales.

## Datos de prueba

El código de ejemplo (`TestData.gs`) usa datos ficticios. No reemplazarlos por datos reales.

## Acceso a la aplicación web

El `appsscript.json` publica la aplicación con acceso `ANYONE` (cualquier cuenta de Google) y ejecución como el usuario que implementa. La protección real es el inicio de sesión de SIGCC (usuarios, roles y sesiones). Revisar con seguridad de la información si conviene restringir el acceso, por ejemplo a un dominio institucional si la cuenta lo permite.
