# SIGECO MVP — Despliegue en Fly.io + Netlify
## Guía completa paso a paso

**Arquitectura final:**
```
[Navegador / Power BI]
        ↓ HTTPS
[Netlify] ← React Frontend (gratis, CDN global)
        ↓ HTTPS
[Fly.io: sigeco-backend] ← FastAPI Python (gratis, región São Paulo)
        ↓ Red privada interna
[Fly.io: sigeco-mongo]   ← MongoDB 7.0 (gratis, 3 GB volumen)
```

**Tiempo estimado:** 45–60 minutos
**Costo:** $0/mes (todo en free tier)

---

## PASO 1 — Instalar Fly CLI (5 min)

Abre PowerShell como **Administrador** y ejecuta:

```powershell
# Instalar flyctl
iwr https://fly.io/install.ps1 -useb | iex
```

Luego cierra y reabre PowerShell. Verifica:
```powershell
fly version
# Debe mostrar: fly v0.x.x ...
```

**Registrarse en Fly.io** (si aún no tienes cuenta):
- Ve a https://fly.io/app/sign-up
- Regístrate con GitHub o email
- **No requiere tarjeta de crédito** para el free tier

Inicia sesión:
```powershell
fly auth login
# Abre el navegador, inicia sesión, vuelve a PowerShell
```

---

## PASO 2 — Desplegar MongoDB en Fly.io (15 min)

Abre PowerShell en la carpeta `fly\mongodb\` del proyecto:

```powershell
cd C:\ruta\a\SIGECO_MVP\fly\mongodb
```

### 2.1 — Crear la aplicación MongoDB

```powershell
fly apps create sigeco-mongo --org personal
```

### 2.2 — Crear el volumen persistente (3 GB gratis)

```powershell
fly volumes create sigeco_mongo_data --size 3 --region gru --app sigeco-mongo
# gru = São Paulo, Brasil — región más cercana a Ecuador
```

### 2.3 — Configurar contraseñas (secretos)

Elige contraseñas seguras:

```powershell
fly secrets set --app sigeco-mongo `
  MONGO_INITDB_ROOT_USERNAME=admin `
  MONGO_INITDB_ROOT_PASSWORD=Admin2024Sigeco! `
  MONGO_APP_PASSWORD=Sgc2026MunGye!
```

> ⚠️ **Guarda estas contraseñas** — las necesitarás en pasos siguientes.

### 2.4 — Desplegar MongoDB

```powershell
fly deploy --app sigeco-mongo
# Primera vez tarda 3-5 minutos (construye la imagen Docker)
```

Verifica que está corriendo:
```powershell
fly status --app sigeco-mongo
# Debe mostrar: Machines running [1 machines, 1 running, ...]
```

---

## PASO 3 — Migrar la base de datos (15 min)

Los archivos del dump ya están en `dump\Thunder\` (96 MB comprimidos).

### 3.1 — Abrir túnel a MongoDB

Abre **una nueva ventana de PowerShell** y ejecuta:
```powershell
fly proxy 27017:27017 -a sigeco-mongo
# Deja esta ventana abierta durante todo el proceso de migración
# Verás: Proxying local port 27017 to [::]:27017 on sigeco-mongo
```

### 3.2 — Restaurar los datos

Vuelve a la ventana principal de PowerShell, ve a la raíz del proyecto:

```powershell
cd C:\ruta\a\SIGECO_MVP

.\scripts\migrar_flyio.ps1 -Password "Sgc2026MunGye!"
# Usa la misma contraseña que pusiste en MONGO_APP_PASSWORD
```

El script restaura automáticamente:
- `Thunder / Base1,5` — 441,709 contribuyentes
- `Thunder / usuarios`, `empleados`, `notificaciones`, `auditoria`, `kpis_historico`

**Tiempo estimado:** 5–10 minutos.

### 3.3 — Crear usuarios administradores

Con el proxy aún abierto:

```powershell
cd C:\ruta\a\SIGECO_MVP\backend

# Instalar dependencias si aún no lo hiciste
pip install pymongo passlib[bcrypt] bcrypt

# Crear los 4 usuarios del sistema
$env:MONGO_URI="mongodb://<USUARIO>:<PASSWORD>@<HOST>/Thunder?authSource=admin"
python seed_admin.py
```

Deberías ver:
```
✓ admin creado
✓ supervisor creado
✓ gestor1 creado
✓ auditor creado
```

Ya puedes cerrar el proxy (Ctrl+C en la ventana del proxy).

---

## PASO 4 — Desplegar Backend FastAPI en Fly.io (10 min)

### 4.1 — Crear la aplicación backend

```powershell
cd C:\ruta\a\SIGECO_MVP\backend

fly apps create sigeco-backend --org personal
```

### 4.2 — Configurar secretos del backend

```powershell
fly secrets set --app sigeco-backend `
  MONGO_URI="mongodb://<USUARIO>:<PASSWORD>@<HOST>/Thunder?authSource=admin" `
  JWT_SECRET="SiGeCo-JWT-2024-MunicipioGuayaquil-SecureKey!" `
  CORS_ORIGINS="https://sigeco-mvp.netlify.app"
```

> 📌 `sigeco-mongo.internal` es la dirección interna — solo funciona entre apps Fly.io de tu organización.

### 4.3 — Copiar el fly.toml al backend

```powershell
copy C:\ruta\a\SIGECO_MVP\fly\backend\fly.toml C:\ruta\a\SIGECO_MVP\backend\fly.toml
```

### 4.4 — Construir el frontend y copiarlo al backend

```powershell
cd C:\ruta\a\SIGECO_MVP\frontend-v2
npm install
npm run build
xcopy /E /Y dist ..\backend\frontend\
```

### 4.5 — Desplegar el backend

```powershell
cd C:\ruta\a\SIGECO_MVP\backend

fly deploy --app sigeco-backend
# Tarda 3-5 minutos
```

Verifica:
```powershell
fly status --app sigeco-backend
fly logs --app sigeco-backend
```

Prueba que funciona:
```powershell
# Abre en el navegador:
start https://sigeco-backend.fly.dev/api/health
# Debe responder: {"status": "ok", ...}

start https://sigeco-backend.fly.dev/docs
# Swagger UI del backend
```

---

## PASO 5 — Desplegar Frontend en Netlify (10 min)

### 5.1 — Crear cuenta en Netlify

Ve a https://netlify.com → **Sign up with GitHub**

### 5.2 — Configurar variable de entorno del frontend

El frontend necesita saber la URL del backend. Edita el archivo:

**`frontend-v2\.env.production`** (créalo si no existe):
```
VITE_API_URL=https://sigeco-backend.fly.dev
```

Reconstruye el frontend:
```powershell
cd C:\ruta\a\SIGECO_MVP\frontend-v2
npm run build
```

### 5.3 — Subir a Netlify (opción drag & drop — la más fácil)

1. Ve a https://app.netlify.com/drop
2. Arrastra la carpeta `frontend-v2\dist\` al recuadro
3. Netlify despliega en segundos y te da una URL como `https://amazing-xyz-123.netlify.app`

### 5.4 — Personalizar el dominio (opcional)

En Netlify Dashboard → **Site settings → Domain management → Change site name**:
- Pon: `sigeco-mvp` → URL será `https://sigeco-mvp.netlify.app`

### 5.5 — Actualizar CORS en el backend

```powershell
fly secrets set --app sigeco-backend `
  CORS_ORIGINS="https://sigeco-mvp.netlify.app"

# Reiniciar el backend para aplicar el cambio
fly machines restart --app sigeco-backend
```

---

## PASO 6 — Actualizar GitHub y configurar CI/CD (5 min)

### 6.1 — Subir todos los cambios a GitHub

```powershell
cd C:\ruta\a\SIGECO_MVP

git add .
git commit -m "feat: configuración Fly.io + Netlify deployment"
git push origin main
```

### 6.2 — Conectar Netlify a GitHub (para auto-deploy)

1. En Netlify Dashboard → tu sitio → **Site configuration → Build & deploy → Link repository**
2. Selecciona tu repo de GitHub
3. **Build settings:**
   - Base directory: `frontend-v2`
   - Build command: `npm run build`
   - Publish directory: `frontend-v2/dist`
4. **Environment variables** → Add: `VITE_API_URL=https://sigeco-backend.fly.dev`

Desde ahora, cada `git push` redespliega el frontend automáticamente.

### 6.3 — Auto-deploy del backend en Fly.io

Para que el backend también se despliegue automáticamente, crea el archivo:
**`.github/workflows/deploy-backend.yml`** (ver sección de CI/CD al final de esta guía).

---

## RESUMEN FINAL

| Componente | URL | Costo |
|---|---|---|
| Frontend | https://sigeco-mvp.netlify.app | $0 |
| Backend API | https://sigeco-backend.fly.dev | $0 |
| MongoDB | sigeco-mongo.internal (privada) | $0 |
| **TOTAL** | | **$0/mes** |

### Usuarios creados
| Usuario | Contraseña | Rol |
|---|---|---|
| admin | Admin2024! | Administrador |
| supervisor | Super2024! | Supervisor |
| gestor1 | Gestor2024! | Gestor |
| auditor | Audit2024! | Auditor |

### Comandos útiles de mantenimiento

```powershell
# Ver logs del backend en tiempo real
fly logs --app sigeco-backend

# Entrar a la consola del backend
fly ssh console --app sigeco-backend

# Conectarse a MongoDB
fly proxy 27017:27017 -a sigeco-mongo
# (en otra ventana) mongosh "mongodb://<USUARIO>:<PASSWORD>@<HOST>"

# Reiniciar el backend
fly machines restart --app sigeco-backend

# Ver uso de recursos
fly status --app sigeco-backend
fly status --app sigeco-mongo
```

---

## SOLUCIÓN DE PROBLEMAS

### Backend no conecta a MongoDB
```powershell
# Verifica que las dos apps están en la misma organización y región
fly apps list
# Verifica el secreto MONGO_URI
fly secrets list --app sigeco-backend
```

### MongoDB sin espacio en disco
El volumen de 3 GB es suficiente para nuestra BD de 156 MB.
Si en el futuro crece, ampliar:
```powershell
fly volumes extend VOLUME_ID --size 5 --app sigeco-mongo
```

### Backend "sleeping" (Fly.io apaga máquinas inactivas)
Fly.io free tier apaga las máquinas después de inactividad.
Primera petición tarda ~3 segundos en despertar — normal para free tier.
Para evitarlo (opcional): configura UptimeRobot para hacer ping cada 5 min:
- URL: `https://sigeco-backend.fly.dev/api/health`
- Intervalo: 5 minutos

---

## CI/CD AUTOMÁTICO (opcional)

Crea `.github/workflows/deploy-backend.yml`:

```yaml
name: Deploy Backend to Fly.io

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - 'frontend-v2/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build frontend
        run: |
          cd frontend-v2
          npm install
          npm run build
          cp -r dist ../backend/frontend

      - name: Deploy to Fly.io
        uses: superfly/flyctl-actions/setup-flyctl@master

      - run: flyctl deploy --app sigeco-backend --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Para obtener el token:
```powershell
fly tokens create deploy -a sigeco-backend
# Copia el token
```
En GitHub → Settings → Secrets → New secret → `FLY_API_TOKEN`
