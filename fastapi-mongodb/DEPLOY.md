# SIGECO MVP — Guía de Despliegue a Producción (Gratis)

## Arquitectura

```
Empleados municipales
        ↓ HTTPS
┌─────────────────────────────┐
│     Render.com (gratis)     │
│  FastAPI + React (1 sola)   │
│  URL: sigeco-mvp.onrender.com│
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│  MongoDB Atlas M0 (gratis)  │
│  Thunder / Base1,5          │
│  441K docs — ~347 MB        │
└─────────────────────────────┘
```

**Tiempo estimado: 2–3 horas**

---

## PASO 1 — Subir el código a GitHub

> GitHub es necesario para que Render.com detecte y despliegue automáticamente.

1. Crear cuenta en **https://github.com** (si no tienes)
2. Crear nuevo repositorio privado: `sigeco-mvp`
3. Abrir terminal (CMD o PowerShell) en la carpeta `SIGECO_MVP`:
   ```bash
   git init
   git add .
   git commit -m "SIGECO MVP - primer despliegue"
   git remote add origin https://github.com/TU_USUARIO/sigeco-mvp.git
   git push -u origin main
   ```

### Archivo .gitignore (crear en la raíz si no existe)
```
.env
__pycache__/
*.pyc
backend/logs/
backend/frontend/
frontend-v2/node_modules/
frontend-v2/dist/
*.xlsx
*.pdf
```

---

## PASO 2 — Crear base de datos en MongoDB Atlas

1. Ir a **https://cloud.mongodb.com** → Crear cuenta gratuita
2. Crear organización y proyecto (nombre: `SIGECO`)
3. Crear clúster:
   - **Tipo**: M0 Free
   - **Proveedor**: AWS
   - **Región**: São Paulo (más cercana a Ecuador)
   - **Nombre**: `sigeco-cluster`
4. Crear usuario de base de datos:
   - Database Access → Add New User
   - Usuario: `sigeco_app`
   - Contraseña: generar una segura y guardarla
   - Role: `Atlas Admin`
5. Permitir acceso desde cualquier IP:
   - Network Access → Add IP Address → `0.0.0.0/0`
   - (Render usa IPs dinámicas, por eso necesitamos abrir todo)
6. Obtener el connection string:
   - Clusters → Connect → Drivers → Python
   - Copiar la cadena: `mongodb+srv://sigeco_app:<password>@sigeco-cluster.xxxxx.mongodb.net/`

---

## PASO 3 — Migrar la base de datos local a Atlas

1. Editar el archivo `scripts/migrar_atlas.py`:
   - Reemplazar `ATLAS_URI` con tu connection string real
   - Reemplazar `USUARIO:PASSWORD` con tus credenciales

2. Ejecutar desde la carpeta `SIGECO_MVP`:
   ```bash
   pip install pymongo
   python scripts/migrar_atlas.py
   ```

3. Esperar la migración (~15–30 minutos según velocidad de internet)

4. Verificar en Atlas Dashboard → Browse Collections que aparece `Thunder` con `Base1,5`

---

## PASO 4 — Crear el servicio en Render.com

1. Ir a **https://render.com** → Crear cuenta gratuita (con GitHub)
2. Dashboard → New → Web Service
3. Conectar el repositorio `sigeco-mvp` de GitHub
4. Render detectará automáticamente el `render.yaml`
5. Configurar las variables de entorno en **Environment**:

   | Variable | Valor |
   |---|---|
   | `MONGO_URI` | `mongodb+srv://sigeco_app:PASSWORD@sigeco-cluster.xxxxx.mongodb.net/` |
   | `JWT_SECRET` | Generar con: `python -c "import secrets; print(secrets.token_hex(32))"` |
   | `DB_NAME` | `Thunder` |
   | `COL_CONTRIB` | `Base1,5` |
   | `CORS_ORIGINS` | `https://sigeco-mvp.onrender.com` |
   | `PORT` | `8000` |
   | `POWERBI_TOKEN` | Token para Power BI (opcional) |

6. Click en **Create Web Service**
7. Esperar el primer deploy (~5–10 minutos)
8. Render te dará una URL: `https://sigeco-mvp.onrender.com`

---

## PASO 5 — Configurar el frontend para la URL de producción

Crear el archivo `frontend-v2/.env.production`:
```
VITE_API_URL=https://sigeco-mvp.onrender.com
```

Luego hacer commit y push — Render re-desplegará automáticamente.

---

## PASO 6 — Crear el usuario administrador

Una vez desplegado, ejecutar localmente:
```bash
cd backend
MONGO_URI="mongodb+srv://..." python seed_admin.py
```

O desde Render → Shell:
```bash
cd backend && python seed_admin.py
```

---

## PASO 7 — Verificar que todo funciona

1. Abrir: `https://sigeco-mvp.onrender.com`
2. Iniciar sesión con las credenciales del admin
3. Verificar:
   - ✅ Dashboard carga KPIs
   - ✅ Contribuyentes muestra la lista
   - ✅ Morosidad filtra correctamente
   - ✅ Exportaciones generan archivos

---

## Conectar Power BI Desktop

1. En Power BI: Obtener datos → Web
2. URL: `https://sigeco-mvp.onrender.com/api/powerbi/contribuyentes`
3. Header: `Authorization: Bearer TU_POWERBI_TOKEN`

---

## ⚠️ Limitaciones del plan gratuito de Render

| Característica | Free Tier |
|---|---|
| RAM | 512 MB |
| CPU | Compartida |
| **Inactividad** | **Se duerme después de 15 min sin requests** |
| Ancho de banda | 100 GB/mes |
| Deploys | Ilimitados |

> **Sobre el "sleep"**: La primera visita después de inactividad tarda ~30 segundos
> en despertar. Para evitarlo, puedes configurar un ping automático gratuito
> en **https://uptimerobot.com** (monitorea cada 5 minutos = mantiene activo).

---

## Costos

| Servicio | Plan | Costo |
|---|---|---|
| Render.com | Free | **$0** |
| MongoDB Atlas | M0 Free | **$0** |
| GitHub | Free | **$0** |
| UptimeRobot | Free | **$0** |
| **TOTAL** | | **$0/mes** |

---

## Solución de problemas

**Error "Application failed to respond"**
→ Revisar logs en Render Dashboard → Logs

**Error de conexión a MongoDB**
→ Verificar que `0.0.0.0/0` está en Network Access de Atlas
→ Verificar que el connection string no tiene caracteres especiales sin escapar

**Frontend muestra pantalla en blanco**
→ Verificar que `VITE_API_URL` apunta a la URL correcta de Render
→ Revisar consola del navegador (F12)

**Datos no aparecen**
→ Verificar la migración: Atlas Dashboard → Browse Collections → Thunder → Base1,5
