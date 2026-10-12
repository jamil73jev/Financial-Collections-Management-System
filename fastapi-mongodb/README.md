# SIGECO MVP — Sistema de Gestión de Cobros
## Municipio de Guayaquil — Impuesto 1.5‰

---

## Arquitectura (3 capas)

```
Frontend  →  Backend API REST  →  MongoDB
(HTML/JS)    (Python FastAPI)     localhost:27017
                                  DB: BASE 1,5
                                  Col: Thunder
```

---

## Requisitos previos

- Python 3.10 o superior
- MongoDB corriendo en `localhost:27017`
- Acceso a la base de datos `BASE 1,5` / colección `Thunder`

---

## Instalación y uso

### Paso 1 — Instalar dependencias
```
Ejecutar: instalar.bat
```

### Paso 2 — Iniciar el backend
```
Ejecutar: iniciar.bat
```

### Paso 3 — Abrir el frontend
```
Abrir en el navegador: frontend/index.html
```

---

## Endpoints del API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado de conexión MongoDB |
| GET | `/api/schema` | Campos disponibles en Thunder |
| GET | `/api/contribuyentes` | Lista contribuyentes con búsqueda |
| GET | `/api/contribuyentes/{id}` | Detalle de un contribuyente |
| PUT | `/api/contribuyentes/{id}` | Actualizar campos |
| GET | `/api/dashboard/kpis` | KPIs para el dashboard |
| GET | `/api/notificaciones` | Lista de notificaciones |
| POST | `/api/notificaciones` | Crear notificación |
| PUT | `/api/notificaciones/{id}` | Editar notificación |
| PUT | `/api/notificaciones/{id}/estado` | Cambiar estado |
| DELETE | `/api/notificaciones/{id}` | Eliminar notificación |
| GET | `/api/empleados` | Lista de empleados |
| POST | `/api/empleados` | Crear empleado |
| GET | `/api/recaudacion` | Recaudación por sector |
| GET | `/api/auditoria` | Log de cambios |

Documentación interactiva: `http://localhost:8000/docs`

---

## Colecciones MongoDB

| Colección | Origen | Descripción |
|-----------|--------|-------------|
| `Thunder` | Existente | Contribuyentes del 1.5‰ |
| `notificaciones` | Nueva | Notificaciones de cobro |
| `empleados` | Nueva | Analistas de cobro |
| `auditoria` | Nueva | Log de cambios del sistema |

---

## Variables de entorno (opcional)

Puedes cambiar la configuración sin editar el código:

```
set MONGO_URI=mongodb://localhost:27017
set DB_NAME=BASE 1,5
set COL_CONTRIB=Thunder
set PORT=8000
python backend/main.py
```

---

## Escalabilidad futura (próximas versiones)

- Autenticación JWT para múltiples usuarios
- Conexión a cubos Power BI via API REST
- Importación/exportación a Excel
- Módulo de liquidación masiva
- Panel de supervisor con asignación automática
- Notificaciones por email (SMTP)
- Integración directa con SQL Server del Municipio

---

*SIGECO MVP v1.0 — Control Financiero, Municipio de Guayaquil*
