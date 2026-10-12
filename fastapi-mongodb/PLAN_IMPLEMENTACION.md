# SIGECO — Plan de Implementación Profesional
## Departamento Control Financiero y Estadística
**Versión:** 1.0 | **Fecha:** 2026-03-18 | **Estado:** Aprobado para ejecución

---

## Resumen Ejecutivo

El sistema SIGECO MVP tiene una base funcional sólida con 7 módulos operativos y
~442,000 registros tributarios integrados. Este plan consolida las 3 fases de
maduración para convertirlo en un sistema institucional seguro, completo y sostenible.

| Fase | Nombre | Duración estimada | Prioridad |
|------|--------|-------------------|-----------|
| 1 | Seguridad e Infraestructura | 2–3 semanas | CRÍTICA |
| 2 | Operativa Completa | 4–6 semanas | ALTA |
| 3 | Sistema Institucional | 6–8 semanas | MEDIA |

---

## FASE 1 — Seguridad e Infraestructura

> Objetivo: Hacer el sistema seguro y desplegable en red institucional.

### 1.1 Autenticación y Autorización (JWT + Roles)

**Archivos a crear/modificar:**
- `backend/auth.py` — módulo de autenticación
- `backend/main.py` — proteger endpoints con dependencias
- `frontend/login.html` — pantalla de login
- `frontend/index.html` — agregar header Authorization en fetch

**Dependencias nuevas (requirements.txt):**
```
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
```

**Roles del sistema:**
```
ADMINISTRADOR   → acceso total, gestión de usuarios
SUPERVISOR      → lectura + editar notificaciones + ver auditoría
GESTOR          → crear/editar notificaciones asignadas a sí mismo
AUDITOR         → solo lectura de todos los módulos
```

**Implementación:**
```python
# backend/auth.py
- POST /api/auth/login          → retorna JWT (access_token 8h + refresh_token 24h)
- POST /api/auth/refresh        → renovar token
- POST /api/auth/logout         → invalidar token (blacklist Redis o TTL corto)
- GET  /api/auth/me             → perfil del usuario autenticado
- GET  /api/usuarios            → listar usuarios (solo ADMIN)
- POST /api/usuarios            → crear usuario (solo ADMIN)
- PUT  /api/usuarios/{uid}      → editar usuario (solo ADMIN)
- PUT  /api/usuarios/{uid}/password → cambiar contraseña

# Dependencia FastAPI en cada endpoint protegido:
async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserInDB
async def require_role(*roles): ...
```

**Colección MongoDB nueva: `usuarios`**
```json
{
  "_id": ObjectId,
  "username": "jperez",
  "nombre": "Jorge Pérez",
  "email": "jperez@municipio.gob.ec",
  "cargo": "Gestor de Cobranza",
  "role": "GESTOR",          // ADMINISTRADOR | SUPERVISOR | GESTOR | AUDITOR
  "activo": true,
  "passwordHash": "bcrypt_hash",
  "fechaCreacion": ISODate,
  "ultimoAcceso": ISODate
}
```

**Frontend — flujo de login:**
```
1. Cargar login.html si localStorage no tiene JWT válido
2. POST /api/auth/login con username/password
3. Guardar access_token en memory (no localStorage) + refresh_token en httpOnly cookie
4. Cada llamada api() incluye: Authorization: Bearer <token>
5. Si 401 → intentar refresh, si falla → redirigir a login
6. Mostrar nombre del usuario + rol en la topbar
7. Ocultar secciones según rol (ej: Auditoría solo para ADMIN/AUDITOR)
```

**Auditoría mejorada:** Cada evento de auditoría debe registrar el userId real del usuario autenticado (actualmente registra "sistema").

---

### 1.2 MongoDB con Autenticación

**Pasos:**
```bash
# 1. Habilitar autenticación en mongod.conf
security:
  authorization: enabled

# 2. Crear usuario administrador de la base
use Base1,5
db.createUser({
  user: "sigeco_app",
  pwd: "<password_fuerte>",
  roles: [{ role: "readWrite", db: "Base1,5" }]
})

# 3. Usuario de solo lectura para Thunder (datos fuente)
db.createUser({
  user: "sigeco_readonly",
  pwd: "<password>",
  roles: [{ role: "read", db: "Base1,5" }]
})
```

**Variables de entorno (.env):**
```
MONGODB_URI=mongodb://sigeco_app:<password>@localhost:27017/Base1,5?authSource=Base1,5
JWT_SECRET=<cadena_aleatoria_64_chars>
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=8
PORT=8000
CORS_ORIGINS=http://sigeco.municipio.gob.ec
```

---

### 1.3 Índices MongoDB (Rendimiento)

**Script: `backend/setup_indexes.py`**
```python
# Índices críticos para 442K registros en Thunder
db.Thunder.create_index("Ruc")
db.Thunder.create_index("NombreContribuyente")
db.Thunder.create_index([("Saldo", -1)])
db.Thunder.create_index("EstadoDeclaracion")
db.Thunder.create_index("TipoPersona")
db.Thunder.create_index([("AnioSolicitud", 1), ("Saldo", -1)])

# Índices en colecciones del sistema
db.notificaciones.create_index("ruc")
db.notificaciones.create_index("estado")
db.notificaciones.create_index([("fechaCreacion", -1)])
db.notificaciones.create_index("empleadoId")

db.auditoria.create_index([("fecha", -1)])
db.auditoria.create_index("tipo")
db.auditoria.create_index("usuario")
```

---

### 1.4 Nginx + HTTPS + Servidor Web

**Arquitectura objetivo:**
```
Internet/LAN Municipal
        │
   [Nginx :443 HTTPS]
   /              \
[Frontend         [API Proxy]
 /var/www/sigeco]  → http://127.0.0.1:8000
```

**nginx.conf (fragmento):**
```nginx
server {
    listen 443 ssl;
    server_name sigeco.municipio.gob.ec;

    ssl_certificate     /etc/ssl/sigeco/fullchain.pem;
    ssl_certificate_key /etc/ssl/sigeco/privkey.pem;

    # Frontend estático
    root /var/www/sigeco;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Forzar HTTPS
    location / {
        try_files $uri /index.html;
    }
}
server {
    listen 80;
    return 301 https://$host$request_uri;
}
```

**Frontend: cambiar URL hardcodeada**
```javascript
// frontend/index.html — reemplazar:
const API = 'http://localhost:8000';
// Por:
const API = '/api';  // relativo — funciona en cualquier servidor
// Quitar /api del path en todas las llamadas:
// api('/contribuyentes') en lugar de api('/api/contribuyentes')
```

---

### 1.5 Docker + docker-compose

**Estructura:**
```
SIGECO_MVP/
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   └── main.py
├── nginx/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── ssl/
└── frontend/
    └── index.html
```

**docker-compose.yml:**
```yaml
version: '3.9'
services:
  backend:
    build: ./backend
    env_file: .env
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      - mongodb
    restart: unless-stopped

  nginx:
    build: ./nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./frontend:/var/www/sigeco:ro
      - ./nginx/ssl:/etc/ssl/sigeco:ro
    depends_on:
      - backend
    restart: unless-stopped

  mongodb:
    image: mongo:7.0
    volumes:
      - mongo_data:/data/db
      - ./backup:/backup
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASS}
    restart: unless-stopped

volumes:
  mongo_data:
```

---

### 1.6 Backup Automático

**Script: `scripts/backup_mongo.sh`**
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M)
BACKUP_DIR="/backup/sigeco/$DATE"
mongodump \
  --uri="$MONGODB_URI" \
  --db="Base1,5" \
  --out="$BACKUP_DIR"
# Comprimir
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"
# Eliminar backups de más de 30 días
find /backup/sigeco -name "*.tar.gz" -mtime +30 -delete
echo "Backup completado: $BACKUP_DIR.tar.gz"
```

**Cron (servidor Linux):**
```
0 2 * * * /opt/sigeco/scripts/backup_mongo.sh >> /var/log/sigeco_backup.log 2>&1
```

---

### 1.7 Logging Estructurado

**backend/main.py — agregar:**
```python
import logging, json
from datetime import datetime

class JSONFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({
            "ts": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "module": record.module,
            "msg": record.getMessage(),
            "user": getattr(record, "user", None),
            "endpoint": getattr(record, "endpoint", None),
        })

# Rotación de logs: 10MB, guardar 30 días
from logging.handlers import RotatingFileHandler
handler = RotatingFileHandler("logs/sigeco.log", maxBytes=10_000_000, backupCount=30)
handler.setFormatter(JSONFormatter())
```

---

### Checklist Fase 1

- [ ] Módulo auth.py con JWT y 4 roles
- [ ] Login screen (login.html)
- [ ] Proteger todos los endpoints con Depends(get_current_user)
- [ ] MongoDB con autenticación habilitada
- [ ] Archivo .env con todos los secretos
- [ ] Índices MongoDB creados (setup_indexes.py)
- [ ] URL API cambiada a relativa (/api) en frontend
- [ ] Nginx configurado con proxy y HTTPS
- [ ] Docker + docker-compose funcionando
- [ ] Script backup + cron configurado
- [ ] Logging estructurado con rotación
- [ ] Auditoría usa usuario real del JWT
- [ ] CORS restringido al dominio institucional
- [ ] Primer usuario admin creado (script seed)

---

## FASE 2 — Operativa Completa

> Objetivo: Completar todas las funcionalidades de gestión de cobranza.

### 2.1 Exportación Excel y PDF

**Dependencias nuevas:**
```
openpyxl==3.1.2
reportlab==4.2.0
Jinja2==3.1.3      # ya incluida con FastAPI, para templates PDF
```

**Endpoints nuevos:**
```python
# Excel
GET /api/export/morosidad.xlsx        → listado filtrado de morosos
GET /api/export/notificaciones.xlsx   → historial de notificaciones
GET /api/export/contribuyentes.xlsx   → padrón filtrado
GET /api/export/recaudacion.xlsx      → resumen por sector

# PDF
GET /api/export/reporte_morosidad.pdf     → reporte ejecutivo
GET /api/export/notificacion/{nid}.pdf    → carta formal al contribuyente
GET /api/export/reporte_recaudacion.pdf   → informe de recaudación mensual
```

**Botones en frontend:**
- Toolbar de cada sección: icono Excel (verde) + icono PDF (rojo)
- Los filtros activos se aplican a la exportación
- Feedback: "Generando archivo..." mientras descarga

**Template carta notificación (PDF):**
```
[MEMBRETE MUNICIPIO / DEPARTAMENTO]
Notificación Nº: {correlativo}
Fecha: {fecha}
Señor/a: {NombreContribuyente}
RUC/Cédula: {Ruc}
...
Por medio de la presente, el Departamento de Control Financiero y Estadística
le notifica que registra una obligación pendiente de:
  Impuesto: ${ValorImpuesto}
  Pagado:   ${ValorPagado}
  SALDO:    ${Saldo}
...
[Firma empleado] [Sello]
```

---

### 2.2 Envío Real de Email

**Dependencias:**
```
aiosmtplib==3.0.1  # SMTP async
email-validator==2.1.0
```

**Variables de entorno:**
```
SMTP_HOST=smtp.municipio.gob.ec
SMTP_PORT=587
SMTP_USER=sigeco@municipio.gob.ec
SMTP_PASS=<password>
SMTP_FROM=Control Financiero <sigeco@municipio.gob.ec>
```

**Nuevo endpoint:**
```python
POST /api/notificaciones/{nid}/enviar-email
  → Lee notificación + datos de contribuyente
  → Genera PDF de carta
  → Envía email con adjunto PDF
  → Registra en historial: "Email enviado a {correo}" + timestamp
  → Cambia estado a "enviada"
```

**Template email HTML:**
```html
Asunto: Notificación de Obligación Tributaria — {NombreContribuyente}
Cuerpo: Mensaje formal con tabla de deuda, instrucciones de pago,
        datos de contacto del departamento.
Adjunto: carta_notificacion_{nid}.pdf
```

**Frontend:**
- Botón "Enviar Email" en modal de notificación (solo si tiene CorreoEMAS)
- Indicador de cargando + toast de éxito/error
- Badge "Email enviado ✓" en tabla de notificaciones

---

### 2.3 Formulario de Gestión (Visita / Llamada)

**Nueva colección MongoDB: `gestiones`**
```json
{
  "_id": ObjectId,
  "notificacionId": ObjectId,
  "ruc": "string",
  "contribuyente": "string",
  "tipo": "visita_domiciliaria | llamada_telefonica | email | oficio",
  "fecha": ISODate,
  "empleadoId": ObjectId,
  "empleado": "string",
  "resultado": "contacto_exitoso | sin_respuesta | numero_equivocado | acuerdo_pago | rechazo",
  "observaciones": "string",
  "proximaAccion": "string",
  "fechaProximaAccion": ISODate,
  "adjuntos": ["url_foto_o_doc"]
}
```

**Endpoints:**
```python
GET  /api/gestiones                    → listar gestiones (filtros: empleado, tipo, fecha)
POST /api/gestiones                    → registrar gestión
GET  /api/gestiones/{nid}/por-notif    → gestiones de una notificación
GET  /api/gestiones/mis-gestiones      → gestiones del empleado logueado
```

**Frontend — Modal "Gestión":**
- Tipo de gestión (select)
- Resultado (select)
- Observaciones (textarea)
- Próxima acción + fecha programada
- Integrado en tabla Morosidad (botón "Gestión" que actualmente es placeholder)

---

### 2.4 Módulo Convenios de Pago

**Nueva colección: `convenios`**
```json
{
  "_id": ObjectId,
  "ruc": "string",
  "contribuyente": "string",
  "montoTotal": 1500.00,
  "numeroCuotas": 6,
  "cuotas": [
    { "numero": 1, "monto": 250.00, "fechaVencimiento": ISODate,
      "fechaPago": null, "estado": "pendiente" }
  ],
  "estado": "activo | cumplido | incumplido | cancelado",
  "empleadoId": ObjectId,
  "fechaCreacion": ISODate,
  "observaciones": "string"
}
```

**Endpoints:**
```python
GET  /api/convenios                → listar convenios
POST /api/convenios                → crear convenio
PUT  /api/convenios/{cid}/cuota   → registrar pago de cuota
GET  /api/convenios/vencimientos  → cuotas próximas a vencer (alertas)
```

**Integración con Morosidad:**
- Contribuyentes con convenio activo → clasificación "CONVENIO" (verde)
- Botón "Coactiva" solo habilitado si no tiene convenio activo

---

### 2.5 Módulo Coactiva

**Nueva colección: `coactivas`**
```json
{
  "_id": ObjectId,
  "ruc": "string",
  "contribuyente": "string",
  "montoTotal": "decimal",
  "etapa": "inicio | citacion | embargo | remate | cobro",
  "expediente": "COA-2026-001",
  "juicio": "string",
  "abogado": "string",
  "fechaInicio": ISODate,
  "fechaUltimaActuacion": ISODate,
  "actuaciones": [
    { "tipo": "string", "descripcion": "string", "fecha": ISODate, "usuario": "string" }
  ],
  "estado": "activo | suspendido | cerrado"
}
```

**Frontend:** Tabla con etapas visuales (stepper), botón "Agregar Actuación"

---

### 2.6 Días de Mora Reales

**Problema actual:** `diasMora = saldo / 5` es una aproximación inválida.

**Solución:**
1. Verificar con el equipo TI si existe campo `FechaVencimiento` o `FechaPago` en alguna colección de Thunder o sistema fuente
2. Si existe → usar fecha real
3. Si no existe → importar tabla de vencimientos desde Excel/CSV fuente
4. Endpoint de carga: `POST /api/admin/importar-vencimientos` (acepta CSV)

**Script de importación:**
```python
# Leer CSV con columnas: Ruc, AnioFiscal, FechaVencimiento
# Crear colección `vencimientos` en MongoDB
# Backend morosidad usa JOIN con vencimientos para dias reales
```

---

### 2.7 Notificaciones Masivas Programadas

**Dependencias:**
```
apscheduler==3.10.4  # scheduler en proceso
```

**Funcionalidad:**
```python
# Tarea diaria 08:00 — revisar morosos sin notificación reciente
POST /api/admin/campana-masiva
  body: { "filtro": { "clasificacion": "MORA_ALTA" }, "empleadoId": "...", "mensaje": "..." }
  → Crea N notificaciones en estado "pendiente"
  → Las encola para envío de email en batch
  → Retorna resumen: { total_creadas: 150, con_email: 120, sin_email: 30 }
```

---

### Checklist Fase 2

- [ ] Endpoints exportación Excel (4 reportes)
- [ ] Endpoints exportación PDF (3 reportes + carta formal)
- [ ] Template carta notificación PDF con membrete
- [ ] Botones Excel/PDF en todas las secciones del frontend
- [ ] Configuración SMTP institucional
- [ ] Envío real de email con adjunto PDF
- [ ] Colección y módulo `gestiones`
- [ ] Modal "Gestión" operativo en Morosidad
- [ ] Colección y módulo `convenios`
- [ ] Colección y módulo `coactivas`
- [ ] Importación vencimientos desde CSV
- [ ] Dias mora reales basados en FechaVencimiento
- [ ] Notificaciones masivas (campana)
- [ ] Botón "Coactiva" operativo con formulario

---

## FASE 3 — Sistema Institucional

> Objetivo: Analytics avanzado, integración institucional, sostenibilidad.

### 3.1 Dashboard Ejecutivo con Metas

**Nuevas métricas:**
```
Meta mensual de recaudación (configurable por ADMIN)
  → % de cumplimiento vs meta
  → Proyección al fin de mes (tendencia)
  → Semáforo: verde ≥85%, amarillo 60-84%, rojo <60%

Ranking de gestores:
  → Notificaciones creadas / mes
  → Tasa de cobro efectivo
  → Tiempo promedio de gestión

KPIs comparativos:
  → Recaudación actual vs mismo mes año anterior
  → Contribuyentes en mora vs año anterior
  → Nuevas morosidades del mes
```

**Nuevos endpoints:**
```python
GET /api/dashboard/metas           → configuración de metas
PUT /api/dashboard/metas           → actualizar metas (ADMIN)
GET /api/dashboard/ranking-gestores
GET /api/dashboard/comparativo-anual
GET /api/dashboard/proyeccion-mensual
```

---

### 3.2 Mapa de Morosidad Geoespacial

**Tecnología:** Leaflet.js (open source, sin costo)

**Datos necesarios:**
- Coordenadas o parroquia de cada contribuyente
- Thunder tiene `Direccion` — geocodificación batch

**Implementación:**
```javascript
// Nueva sección "Mapa" en sidebar
// Heatmap de deuda por zona con Leaflet + plugin heatmap
// Filtros por clasificación, año, tipo persona
// Click en zona → lista de contribuyentes de esa zona
```

**Backend:**
```python
GET /api/mapa/morosidad     → GeoJSON con puntos/zonas y montos
GET /api/mapa/parroquias    → polígonos de parroquias con totales
```

---

### 3.3 Integración Power BI / Metabase

**Opción A — MongoDB BI Connector (gratuito):**
```bash
# Instalar mongosqld
# Expone MongoDB como SQL para Power BI/Tableau/Metabase
mongosqld --mongo-uri "mongodb://..." --addr "0.0.0.0:3307"
```

**Opción B — ETL a PostgreSQL (recomendado):**
```python
# Script nightly: migrar Thunder → PostgreSQL normalizado
# Tablas: contribuyentes, declaraciones, pagos, morosidad_snapshot
# Power BI conecta a PostgreSQL directamente
# Ventaja: consultas SQL estándar, joins más rápidos
```

**Opción C — API para Power BI:**
```python
# Endpoints con token especial para Power BI Web connector
GET /api/powerbi/contribuyentes    → JSON flat para Power BI
GET /api/powerbi/morosidad-summary → agregados por período
GET /api/powerbi/recaudacion       → serie temporal
```

---

### 3.4 Importación de Datos desde Excel

**Casos de uso:**
1. Carga masiva de nuevos contribuyentes
2. Actualización de montos desde sistema fuente
3. Importación de pagos registrados manualmente
4. Carga de fechas de vencimiento

**Endpoint:**
```python
POST /api/admin/importar
  form-data: file (xlsx/csv), tipo (contribuyentes|pagos|vencimientos)
  → Valida columnas requeridas
  → Preview primeras 10 filas antes de confirmar
  → Procesamiento en background con progreso
  → Reporte final: N insertados, M actualizados, K errores
```

**Frontend:**
- Modal "Importar datos" con drag & drop de archivo
- Barra de progreso en tiempo real (WebSocket o polling)
- Tabla de errores descargable

---

### 3.5 Alertas y Notificaciones del Sistema

**Alertas automáticas diarias (7:00 AM):**
```
- Contribuyentes que entraron en mora nueva (saldo cambió a positivo)
- Cuotas de convenio vencidas ayer sin pago
- Notificaciones en estado "pendiente" por más de 7 días
- Notificaciones en "enviada" sin respuesta por más de 15 días
- Resumen diario al supervisor: X pendientes, Y en gestión, Z cobradas
```

**Panel de alertas en frontend:**
- Badge rojo en topbar con conteo de alertas no vistas
- Drawer lateral de alertas con links directos al registro

**Backend:**
```python
GET /api/alertas              → alertas no vistas del usuario
PUT /api/alertas/{aid}/vista  → marcar como vista
GET /api/alertas/resumen      → conteo por tipo (para badge)
```

---

### 3.6 Gestión de Usuarios (Panel Admin)

**Nueva sección "Configuración" en sidebar (solo ADMIN):**

**Sub-módulos:**
1. **Usuarios** — CRUD completo, cambio de rol, desactivar
2. **Zonas de trabajo** — Asignar zonas geográficas a gestores
3. **Metas** — Configurar meta mensual de recaudación
4. **Parámetros** — Umbrales de clasificación de mora, días de gracia
5. **Plantillas** — Personalizar texto de cartas y emails institucionales
6. **Integración** — Configurar SMTP, webhooks externos

---

### 3.7 API REST Documentada (Swagger/OpenAPI)

**Ya incluida en FastAPI** (`/docs` y `/redoc`), pero mejorar:
```python
# Agregar a cada endpoint:
@router.get("/contribuyentes",
    summary="Listar contribuyentes",
    description="Retorna lista paginada de contribuyentes del padrón Thunder...",
    tags=["Contribuyentes"],
    response_model=ListaContribuyentesResponse,
    responses={401: {"description": "No autorizado"}, 403: {"description": "Sin permisos"}}
)
```

**Agregar:**
- Esquemas Pydantic para todos los responses
- Tags organizados por módulo
- Ejemplos en cada schema
- Endpoint `/api/openapi.json` protegido (solo red interna)

---

### 3.8 Rate Limiting y Seguridad Avanzada

**Dependencias:**
```
slowapi==0.1.9    # Rate limiting para FastAPI
```

```python
# Limits por rol:
AUDITOR    → 100 req/min
GESTOR     → 200 req/min
SUPERVISOR → 300 req/min
ADMIN      → sin límite

# Límites especiales:
POST /api/auth/login → 10 req/min por IP (anti-brute force)
GET /api/export/*    → 5 req/min (exportaciones pesadas)
```

**Headers de seguridad en Nginx:**
```nginx
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header X-XSS-Protection "1; mode=block";
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
add_header Content-Security-Policy "default-src 'self'; ...";
```

---

### 3.9 Monitoreo y Health Dashboard

**Endpoint mejorado `/api/health`:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-18T10:00:00Z",
  "mongodb": { "status": "ok", "latency_ms": 2, "docs_thunder": 441709 },
  "version": "2.0.0",
  "uptime_seconds": 86400,
  "memory_mb": 245
}
```

**Panel de estado (solo ADMIN):**
- Uptime del servidor
- Uso de CPU/RAM
- Tamaño de la base de datos
- Queries lentas (> 1s) del día
- Usuarios activos en este momento

---

### Checklist Fase 3

- [ ] Metas de recaudación configurables
- [ ] Ranking de gestores en dashboard
- [ ] KPIs comparativos año a año
- [ ] Mapa Leaflet de morosidad geoespacial
- [ ] ETL nightly Thunder → PostgreSQL (o MongoDB BI Connector)
- [ ] Importación Excel/CSV con preview y progreso
- [ ] Sistema de alertas automáticas diarias
- [ ] Panel de alertas en topbar del frontend
- [ ] Sección "Configuración" con gestión de usuarios, metas, plantillas
- [ ] Rate limiting por rol
- [ ] Headers de seguridad en Nginx
- [ ] Schemas Pydantic completos + documentación Swagger mejorada
- [ ] Panel de monitoreo para ADMIN
- [ ] Webhook de integración con sistema contable (si aplica)

---

## Arquitectura Final del Sistema

```
┌─────────────────────────────────────────────────┐
│               Red Municipal Interna              │
│                                                  │
│  [Navegador del funcionario]                     │
│         │ HTTPS                                  │
│         ▼                                        │
│  ┌─────────────┐   ┌──────────────────────────┐ │
│  │    Nginx    │   │   MongoDB (Auth habilitada)│ │
│  │  (HTTPS +   │   │   ├── Thunder (442K)      │ │
│  │   Proxy)    │   │   ├── notificaciones      │ │
│  └──────┬──────┘   │   ├── empleados           │ │
│         │          │   ├── usuarios             │ │
│         ▼          │   ├── gestiones            │ │
│  ┌─────────────┐   │   ├── convenios            │ │
│  │  FastAPI    │◄──┤   ├── coactivas            │ │
│  │  Backend    │   │   ├── alertas              │ │
│  │  (Auth JWT) │   │   └── auditoria            │ │
│  └─────────────┘   └──────────────────────────┘ │
│         │                                        │
│  ┌──────▼──────┐   ┌──────────────────────────┐ │
│  │  Scheduler  │   │   SMTP Municipal          │ │
│  │  (APSched.) │   │   (Envío emails)          │ │
│  └─────────────┘   └──────────────────────────┘ │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Backups: /backup/sigeco/*.tar.gz (30d)  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘

Opcional Fase 3:
[Power BI Desktop] → [PostgreSQL/MongoDB BI Connector]
```

---

## Estimación de Tiempos por Tarea

| Tarea | Estimado | Complejidad |
|-------|----------|-------------|
| Auth JWT + roles + login screen | 3 días | Alta |
| MongoDB con auth + índices | 1 día | Baja |
| Nginx + HTTPS + URL relativa | 1 día | Media |
| Docker + docker-compose | 1 día | Media |
| Backup script + cron | 0.5 días | Baja |
| Logging estructurado | 0.5 días | Baja |
| **TOTAL FASE 1** | **~7 días** | |
| | | |
| Exportación Excel (4 reportes) | 2 días | Media |
| Exportación PDF + carta formal | 3 días | Alta |
| Envío email real + adjunto | 2 días | Media |
| Módulo gestiones | 2 días | Media |
| Módulo convenios | 3 días | Alta |
| Módulo coactiva | 2 días | Media |
| Importación vencimientos CSV | 1 día | Media |
| Notificaciones masivas | 1 día | Media |
| **TOTAL FASE 2** | **~16 días** | |
| | | |
| Dashboard ejecutivo + metas | 3 días | Alta |
| Mapa Leaflet geoespacial | 4 días | Alta |
| ETL → PostgreSQL / BI Connector | 3 días | Alta |
| Importación Excel masiva | 2 días | Media |
| Sistema de alertas automáticas | 2 días | Media |
| Panel admin (usuarios, config) | 3 días | Alta |
| Rate limiting + seguridad Nginx | 1 día | Media |
| Monitoreo + health dashboard | 1 día | Baja |
| **TOTAL FASE 3** | **~19 días** | |

**Total general: ~42 días hábiles (~9 semanas)**

---

## Orden de Implementación Recomendado

```
Semana 1:   1.1 Auth + Login + Roles (bloqueador crítico)
Semana 2:   1.2 MongoDB Auth + 1.3 Índices + 1.4 Nginx + 1.5 Docker
Semana 3:   1.6 Backup + 1.7 Logging + pruebas Fase 1 + deploy en servidor
Semana 4:   2.1 Excel exports + 2.2 Email real
Semana 5:   2.3 Módulo gestiones + 2.4 Convenios
Semana 6:   2.5 Coactiva + 2.6 Dias mora reales
Semana 7:   2.7 Notificaciones masivas + pruebas Fase 2
Semana 8:   3.1 Dashboard ejecutivo + metas + 3.3 Alertas
Semana 9:   3.2 Mapa + 3.4 Importación Excel + 3.6 Panel admin
Semana 10+: 3.3 Power BI / ETL + 3.8 Rate limiting + 3.9 Monitoreo
```

---

*Documento generado por Claude Code para el Departamento de Control Financiero y Estadística.*
*Actualizar este documento al completar cada checklist de fase.*
