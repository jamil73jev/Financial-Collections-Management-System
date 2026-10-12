# SIGECO — Guía de Despliegue en Google Apps Script

## Arquitectura Híbrida (V2.0)
Este sistema utiliza una arquitectura **Opción A+**:
1. **Google Sheets**: Para Usuarios, Auditoría, Gestiones y Campañas (Gratis y fácil de editar).
2. **MongoDB Atlas**: Para los 441,000 Contribuyentes (Supera los límites de Excel y es ultra rápido).

---

## Paso 1: Configurar MongoDB Atlas (Nube)
Si ya tienes tus datos en MongoDB Compass local, haz esto para llevarlos a la nube:

1. Crea un Cluster gratuito en **[mongodb.com/atlas](https://www.mongodb.com/cloud/atlas)**.
2. Usa MongoDB Compass para conectar con tu cluster de Atlas y **Copiar/Pegar** tu colección `Thunder.Base1,5` desde tu PC a Atlas.
3. En el panel de Atlas (web), ve a **"App Services"** (arriba) -> **"Data API"** (lateral).
4. Haz clic en **"Enable Data API"**.
5. Selecciona tu Cluster y haz clic en **"Install"**.
6. **Copia estos 3 datos:**
   - **App ID** (aparece arriba a la izquierda del panel de Data API).
   - **Cluster Name** (ej. `Cluster0`).
   - Crea un **API Key** en la pestaña "API Keys" -> Dale un nombre -> **Copia la clave secreta**.

---

## Paso 2: Crear el proyecto en Apps Script

1. Ir a **[script.google.com](https://script.google.com)**
2. Click en **"Nuevo proyecto"**
3. Cambiar el nombre: click en "Proyecto sin título" → escribir **"SIGECO"**

---

## Paso 2: Copiar los archivos

En el editor de Apps Script, por defecto existe un archivo `Código.gs`. Debes **reemplazar** su contenido y **crear archivos adicionales**:

### Archivos a crear:

| Archivo en Apps Script | Contenido desde |
|---|---|
| `Code.gs` (renombrar `Código.gs`) | `google-sheets-app/Code.gs` |
| `Auth.gs` | `google-sheets-app/Auth.gs` |
| `Data.gs` | `google-sheets-app/Data.gs` |
| `Campanas.gs` | `google-sheets-app/Campanas.gs` |
| `Index.html` | `google-sheets-app/Index.html` |

### Cómo crear cada archivo:
- Click en el ícono **"+"** junto a "Archivos"
- Para `.gs`: seleccionar **"Secuencia de comandos"**
- Para `.html`: seleccionar **"HTML"**
- Pegar el contenido correspondiente

> **Importante:** El archivo HTML debe llamarse exactamente `Index` (sin extensión, Apps Script la agrega).

---

## Paso 3: Configurar el Spreadsheet (base de datos)

1. En el editor, seleccionar la función `setupSpreadsheet` del menú desplegable de funciones
2. Click en **▶ Ejecutar**
3. Aprobar los permisos cuando se soliciten (Google pedirá acceso a Drive y Sheets)
4. Verificar en los **Registros (Logs)** que aparezca:
   ```
   ✅ Spreadsheet creado exitosamente
   🔗 URL: https://docs.google.com/spreadsheets/d/...
   ```
5. Abrir esa URL para verificar que se crearon las 8 hojas

### Credenciales de prueba creadas:
| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `Admin2024!` | Administrador |

---

## Paso 4: Vincular Apps Script con Atlas
1. En el editor de Apps Script, selecciona la función **`configurarAtlas`**.
2. Dale a **▶ Ejecutar**. Google te pedirá pasar los argumentos (si lo haces desde la interfaz de usuario que crearemos, es más fácil, pero por ahora puedes editarlos en el código de `Code.gs` temporalmente o usar los campos que agregamos).
3. **Alternativa recomendada:** Abre la consola del editor (View -> Execution log) y asegúrate de que no haya errores de conexión.

---

## Paso 5: Publicar como Web App

1. Click en **"Implementar"** → **"Nueva implementación"**
2. Click en el ícono de engranaje ⚙ → seleccionar **"Aplicación web"**
3. Configurar:
   - **Descripción:** SIGECO v2.0
   - **Ejecutar como:** Yo (tu cuenta)
   - **Quién tiene acceso:** **Cualquier usuario** ← Importante para que funcione sin login Google
4. Click en **"Implementar"**
5. Copiar la **URL de la aplicación web** → esto es el link que usarán los usuarios

> La URL tendrá el formato: `https://script.google.com/macros/s/XXXXXXXX/exec`

---

## Paso 5: Instalar limpieza de sesiones (recomendado)

Para limpiar automáticamente las sesiones expiradas:

1. En el editor, seleccionar la función `installCleanupTrigger`
2. Click en **▶ Ejecutar**
3. Verificar en los Logs: `✅ Trigger de limpieza instalado`

---

## Paso 6: Importar los 441,000 contribuyentes

### Opción A: Desde el dump de MongoDB (recomendado)

```bash
cd c:\Users\jorge\Downloads\SIGECO_MVP\google-sheets-app
python preparar_csv.py
```

Esto generará `contribuyentes_export.csv`. Luego:

1. Abrir el Google Spreadsheet creado en el Paso 3
2. Ir a la hoja **"Contribuyentes"**
3. **Archivo → Importar → Subir** el CSV
4. Opciones: separador = coma, agregar a la hoja existente (sin reemplazar fila 1)

### Opción B: Importar directamente desde Google Sheets
1. En Contribuyentes → abrir el Google Sheet
2. Usar **Extensiones → Hojas de cálculo → Importar datos**

> ⚠️ Google Sheets tiene un límite de **10 millones de celdas**. Con 441K contribuyentes y 22 columnas = ~9.7M celdas, está cerca del límite. Considera importar por año si hay problemas.

---

## Actualizar la Web App (cuando hagas cambios)

1. Click en **"Implementar"** → **"Gestionar implementaciones"**
2. Click en el ícono de edición ✏
3. En "Versión" → seleccionar **"Nueva versión"**
4. Click en **"Implementar"**

> La URL no cambia al actualizar.

---

## Configurar Looker Studio (Dashboard avanzado)

1. Ir a **[lookerstudio.google.com](https://lookerstudio.google.com)**
2. Crear informe → origen de datos: **Google Sheets**
3. Seleccionar el spreadsheet SIGECO
4. Crear gráficos con las hojas: Contribuyentes, Gestiones, Convenios, Coactivas

---

## Troubleshooting

| Problema | Solución |
|---|---|
| "SPREADSHEET_ID no configurado" | Ejecutar `setupSpreadsheet()` nuevamente |
| Login no funciona | Verificar que la Web App esté publicada como "Cualquier usuario" |
| "Sin permisos" al ejecutar | Re-ejecutar y aprobar todos los permisos de Google |
| Error 401 | La sesión expiró, volver a hacer login |
| Cambios no se reflejan | Crear nueva versión en "Gestionar implementaciones" |
