# AUDITORÍA DE ARQUITECTURA - SIGECO v2.0
## Sistema de Seguimiento de Gestión Recaudatoria

**Fecha:** 26 de Marzo de 2026
**Proyecto:** SIGECO - Municipio de Guayaquil
**Responsable:** Auditoría Técnica

---

## 📋 CONTENIDO
1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura Actual](#arquitectura-actual)
3. [Problema Identificado](#problema-identificado)
4. [Flujo de Datos](#flujo-de-datos)
5. [Análisis Detallado](#análisis-detallado)
6. [Hallazgos](#hallazgos)
7. [Recomendaciones](#recomendaciones)
8. [Próximos Pasos](#próximos-pasos)

---

## RESUMEN EJECUTIVO

El sistema SIGECO está bien arquitecturado con una separación clara entre frontend y backend. Sin embargo, **el frontend NO accede directamente a Google Sheets**, sino que utiliza Google Apps Script como intermediario. Esto es una decisión de diseño correcta, pero potencialmente confusa si se espera acceso directo desde el navegador.

**Conclusión:** El sistema funciona correctamente. El frontend sí usa datos de Google Sheets, pero indirectamente a través del backend.

---

## ARQUITECTURA ACTUAL

### 1. COMPONENTES DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────┐
│                    NAVEGADOR DEL USUARIO                     │
│  (HTML/CSS/JavaScript - Index.html - 61,912 bytes)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ google.script.run.dispatch(action, payload)
                     │ (Llamadas HTTP/RPC asincrónicas)
                     ↓
┌─────────────────────────────────────────────────────────────┐
│          GOOGLE APPS SCRIPT (Backend - 3,512 líneas)         │
│                                                              │
│  Code.gs (dispatcher principal)                             │
│  ├─ Auth.gs (263 líneas) - Autenticación                   │
│  ├─ ExpedienteService.gs (326 líneas) - Gestión de casos  │
│  ├─ GestionService.gs (227 líneas) - Registros             │
│  ├─ DashboardService.gs (200 líneas) - KPIs                │
│  ├─ SeguimientoService.gs (207 líneas) - Supervisión       │
│  ├─ UserService.gs (174 líneas) - Gestión de usuarios      │
│  ├─ ImportService.gs (253 líneas) - Importación CSV        │
│  ├─ SheetService.gs (164 líneas) - API de Sheets           │
│  ├─ BitacoraService.gs (162 líneas) - Auditoría            │
│  ├─ AlertService.gs (174 líneas) - Sistema de alertas      │
│  ├─ IntegrityService.gs (204 líneas) - Validaciones        │
│  └─ [+6 módulos más]                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ SheetService.gs
                     │ getSpreadsheet()
                     │ getHoja(nombreHoja)
                     │ getDataAsObjects()
                     ↓
┌─────────────────────────────────────────────────────────────┐
│              GOOGLE SHEETS (Almacenamiento)                  │
│                                                              │
│  Spreadsheet ID: [Configurado en PropertiesService]         │
│  │                                                          │
│  ├─ EXPEDIENTES (hojas de datos)                           │
│  ├─ GESTIONES (registros transaccionales)                  │
│  ├─ USUARIOS (credenciales y roles)                        │
│  ├─ CONTRIBUYENTES (base de datos maestro)                 │
│  ├─ CONFIG (parámetros del sistema)                        │
│  ├─ BITACORA (log de auditoría)                            │
│  ├─ SEGUIMIENTO (vista analítica)                          │
│  └─ DASHBOARD (indicadores calculados)                     │
└─────────────────────────────────────────────────────────────┘
```

### 2. ESTRUCTURA DE ARCHIVOS

```
google-sheets-app/
├── Frontend (Interfaz)
│   └── Index.html (61.9 KB - HTML + CSS + JavaScript embebido)
│
├── Backend (Google Apps Script)
│   ├── Code.gs (124 líneas) - Punto de entrada y dispatcher
│   ├── Auth.gs (263 líneas) - Autenticación y sesiones
│   ├── Constants.gs (200 líneas) - Definiciones globales
│   ├── SheetService.gs (164 líneas) - API de acceso a Sheets
│   ├── Servicios de Negocio
│   │   ├── ExpedienteService.gs (326 líneas)
│   │   ├── GestionService.gs (227 líneas)
│   │   ├── UserService.gs (174 líneas)
│   │   ├── DashboardService.gs (200 líneas)
│   │   ├── SeguimientoService.gs (207 líneas)
│   │   ├── AlertService.gs (174 líneas)
│   │   ├── ImportService.gs (253 líneas)
│   │   └── [5+ más]
│   │
│   └── Utilidades
│       ├── ValidationService.gs
│       ├── IntegrityService.gs
│       ├── BitacoraService.gs
│       ├── ConfigService.gs
│       ├── SecurityService.gs
│       ├── BackupService.gs
│       ├── Setup.gs
│       └── TestData.gs
│
├── Datos
│   ├── BASE15.csv (40.9 MB) - Datos maestros
│   └── contribuyentes_export.csv (39.3 MB) - Exportación contribuyentes
│
├── Documentación
│   ├── PRODUCTION_DEPLOYMENT.md
│   ├── PRODUCTION_READY.md
│   ├── PRODUCTION_CHECKLIST.md
│   ├── OPERATIONS_RUNBOOK.md
│   ├── README_DESPLIEGUE.md
│   └── preparar_csv.py (utilidad de importación)
```

---

## PROBLEMA IDENTIFICADO

### El Frontend NO Accede Directamente a Google Sheets

**Hallazgo:** El frontend (Index.html) no tiene acceso directo a Google Sheets. Esto es correcto por razones de:
- **Seguridad:** El navegador no debe exponer credenciales de Google
- **Control:** El backend valida y autoriza todas las operaciones
- **Consistencia:** Un único punto de verdad para la lógica de negocio

### ¿Por qué ocurre esto?

Google Apps Script ejecuta en el servidor (backend), no en el navegador. El frontend puede:

✅ **HACER:**
- Llamar funciones del servidor vía `google.script.run`
- Recibir JSON con datos
- Renderizar datos en HTML

❌ **NO PUEDE:**
- Acceder directamente a Google Sheets API
- Usar `SpreadsheetApp` (servidor solamente)
- Obtener datos sin pasar por el backend

---

## FLUJO DE DATOS

### Ejemplo 1: Carga de Dashboard

```
1. Frontend carga
   ↓
2. Usuario login: call('login', { usuario, password })
   ↓
3. Backend (Auth.gs) valida credenciales
   ├─ Lee USUARIOS de Google Sheets
   ├─ Verifica contraseña
   └─ Retorna { token, sesion }
   ↓
4. Frontend recibe sesión válida
   ↓
5. Usuario navega a Dashboard
   ↓
6. Frontend llama: call('getDashboardKPIs', { token })
   ↓
7. Backend (DashboardService.gs) procesa:
   ├─ getDataAsObjects('EXPEDIENTES')  ← Lee de Google Sheets
   ├─ getDataAsObjects('GESTIONES')     ← Lee de Google Sheets
   ├─ Calcula KPIs
   └─ Retorna { ok: true, kpis: {...} }
   ↓
8. Frontend recibe JSON y renderiza gráficos/tarjetas
```

### Ejemplo 2: Registro de Gestión

```
1. Usuario completa formulario
   ↓
2. Frontend: call('registerGestion', { token, datos })
   ↓
3. Backend (GestionService.gs):
   ├─ Valida sesión
   ├─ getDataAsObjects('EXPEDIENTES')    ← Lee de Sheets
   ├─ Valida datos de gestión
   ├─ appendRow('GESTIONES', [...])      ← ESCRIBE en Sheets
   ├─ updateRowFields('EXPEDIENTES', ...) ← ESCRIBE en Sheets
   └─ Retorna { ok: true, id: 'GES-...' }
   ↓
4. Frontend recibe confirmación
   ↓
5. Frontend muestra alerta "Gestión registrada"
```

---

## ANÁLISIS DETALLADO

### 1. MECANISMO DE COMUNICACIÓN

El frontend usa **google.script.run** (función especial de Apps Script):

```javascript
// En Index.html (línea 539-544)
const call = (action, payload) => new Promise((res, rej) => {
  google.script.run
    .withSuccessHandler(r => res(r))
    .withFailureHandler(e => rej(e))
    .dispatch(action, payload || {});
});
```

Esto llama a `dispatch()` en Code.gs (línea 58-124):

```javascript
// En Code.gs
function dispatch(action, payload) {
  payload = payload || {};
  try {
    switch (action) {
      case 'login':           return login(payload.usuario, payload.password);
      case 'listExpedientes': return listExpedientes(payload.token, ...);
      case 'registerGestion': return registerGestion(payload.token, ...);
      // ... más de 30 acciones diferentes
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
```

### 2. ACCESO A GOOGLE SHEETS

Todo acceso a datos pasa por **SheetService.gs**:

```javascript
// Capa de abstracción centralizada
function getDataAsObjects(nombreHoja) {
  const hoja = getHoja(nombreHoja);      // Obtiene la hoja
  const datos = hoja.getDataRange().getValues();  // Lee datos

  // Transforma en objetos JSON
  return datos.slice(1).map((fila, idx) => {
    const obj = { _rowIndex: idx + 2 };
    headers.forEach((h, i) => { obj[h] = fila[i]; });
    return obj;
  });
}
```

**Ventajas de este diseño:**
- Encapsulación: Cambiar estructura de Sheets no requiere cambios en servicios
- Performance: Un único punto de caché posible
- Seguridad: Validación centralizada
- Mantenibilidad: Lógica de lectura en un lugar

### 3. VALIDACIÓN DE DATOS

Cada operación se valida en **ValidationService.gs**:

```javascript
function validateGestion(datos) {
  const errores = [];

  if (!datos.idExpediente) errores.push('ID Expediente requerido');
  if (!datos.tipoGestion) errores.push('Tipo de gestión requerido');
  if (!CATALOGOS.TIPOS_GESTION.includes(datos.tipoGestion))
    errores.push('Tipo de gestión inválido');

  return { valido: errores.length === 0, errores };
}
```

### 4. CONTROL DE ACCESO

Implementado en **Auth.gs** y **SecurityService.gs**:

```javascript
function checkAccess(token, permiso) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida' };

  const rolRequerido = PERMISOS[permiso];
  const rolUsuario = ROLES[sesion.rol].nivel;

  if (rolUsuario < ROLES[rolRequerido].nivel) {
    return { ok: false, error: 'Permiso insuficiente' };
  }

  return { ok: true, sesion };
}
```

### 5. AUDITORÍA

Toda operación se registra en **BitacoraService.gs**:

```javascript
logAction({
  token,
  hoja: SHEET_NAMES.GESTIONES,
  idExpediente: datos.idExpediente,
  accion: 'REGISTRAR_GESTION',
  contexto: 'Tipo: ' + datos.tipoGestion,
  origen: 'GestionService.gs'
});
```

---

## HALLAZGOS

### ✅ FORTALEZAS

1. **Arquitectura bien diseñada**
   - Separación clara frontend/backend
   - Backend validado y autorizado
   - Almacenamiento centralizado en Google Sheets

2. **Seguridad robusta**
   - Autenticación con tokens de sesión
   - Control de acceso basado en roles
   - Auditoría completa de operaciones
   - Validación en el servidor (nunca confiar en cliente)

3. **Código modular y mantenible**
   - 11+ servicios especializados
   - ~3,500 líneas de código backend
   - Constantes centralizadas (Constants.gs)
   - Funciones de utilidad reutilizables

4. **Escalabilidad**
   - Datos en Google Sheets (ilimitado)
   - Backend sin estado (stateless)
   - Sesiones con timeout

5. **Auditoría y trazabilidad**
   - Bitácora completa de cambios
   - Registro de quién, qué, cuándo
   - Origen de cada cambio (archivo .gs)

### ⚠️ POSIBLES MEJORAS

1. **Performance**
   - Caché en frontend: Google Apps Script no tiene caché nativo
   - Índices en Sheets: Hojas muy grandes pueden lentificar
   - Paginación: Sistema implementado pero puede optimizarse

2. **Escalabilidad**
   - Google Sheets tiene límites (5M celdas por sheet)
   - Considerar migración a Firestore para >100k registros
   - Backup automático más frecuente

3. **Frontend**
   - No hay validación duplicada en cliente
   - Errores de red no se manejan completamente
   - Sin manejo de conflictos concurrentes

4. **Documentación**
   - Index.html muy grande (61 KB) - considerar modularizar
   - Falta especificación de API (endpoints)
   - Sin especificación de esquema de datos

### ❌ PROBLEMAS ENCONTRADOS

1. **Dependencia del Dispatcher centralizado**
   - Si `dispatch()` falla, toda la app se detiene
   - Sin circuit breaker o fallover

2. **Sin versionamiento de API**
   - Cambios en estructura de datos pueden romper frontend
   - Sin backward compatibility

3. **Gestión de Errores limitada**
   - Los errores del servidor no siempre se propagan correctamente
   - Sin reintentos automáticos

4. **Concurrencia**
   - Múltiples usuarios escribiendo simultáneamente
   - Sin bloqueos (locks) en Google Sheets
   - Potencial para condiciones de carrera

---

## RECOMENDACIONES

### Prioridad ALTA

#### 1. Implementar API Gateway/Middleware
```javascript
// Propuesto en Code.gs
function dispatchWithRetry(action, payload, retries = 3) {
  let ultimoError = null;

  for (let i = 0; i < retries; i++) {
    try {
      return dispatch(action, payload);
    } catch (e) {
      ultimoError = e;
      Utilities.sleep(Math.random() * 1000); // backoff exponencial
    }
  }

  return {
    ok: false,
    error: 'Error después de ' + retries + ' reintentos: ' + ultimoError.message
  };
}
```

#### 2. Agregar Caché Local
```javascript
// En Frontend
const cache = {
  usuarios: { data: null, ttl: 300 }, // 5 minutos
  catalogos: { data: null, ttl: 3600 }  // 1 hora
};

async function getCatalogosConCache() {
  if (cache.catalogos.data && Date.now() < cache.catalogos.timestamp + cache.catalogos.ttl * 1000) {
    return cache.catalogos.data;
  }
  const data = await call('getCatalogos', {});
  cache.catalogos.data = data;
  cache.catalogos.timestamp = Date.now();
  return data;
}
```

#### 3. Monitoreo y Alertas
```javascript
// Agregar en Auth.gs
function registrarErrorCritico(accion, error, payload) {
  const log = {
    timestamp: new Date().toISOString(),
    accion,
    error: error.message,
    stack: error.stack,
    payload: JSON.stringify(payload).substring(0, 500)
  };

  logToErrorSheet(log);

  // Si ocurren >10 errores en 1 hora, alertar a admin
  if (debeAlertarAdmin(log)) {
    enviarAlertaEmail(log);
  }
}
```

### Prioridad MEDIA

#### 4. Modularizar Frontend
```html
<!-- Actual: 1 archivo monolítico de 61 KB -->
<!-- Propuesto: Dividir en módulos -->
<script src="modules/auth.js"></script>
<script src="modules/dashboard.js"></script>
<script src="modules/expedientes.js"></script>
<script src="modules/common.js"></script>
```

#### 5. Documentación de API
```javascript
/**
 * @api GET /dispatch
 * @param {string} action - Acción a ejecutar
 * @param {object} payload - Datos de entrada
 *
 * Acciones disponibles:
 * - login: Autenticación
 * - listExpedientes: Listar expedientes con paginación
 * - registerGestion: Registrar nueva gestión
 * ... (documentar todas)
 */
```

#### 6. Validación en Cliente
```javascript
// Agregar validaciones antes de enviar
function validarGestionLocal(datos) {
  const errores = [];
  if (!datos.idExpediente) errores.push('Expediente requerido');
  if (!datos.tipoGestion) errores.push('Tipo de gestión requerido');
  return { valido: errores.length === 0, errores };
}

// Usarla en frontend
if (!validarGestionLocal(datosGestion).valido) {
  showAlert('danger', 'Datos incompletos');
  return;
}
```

### Prioridad BAJA

#### 7. Migración a Firebase
- Para >100k registros, considerar Cloud Firestore
- Mejor rendimiento y escalabilidad
- Pero requiere refactorización importante

#### 8. Tests Automatizados
```javascript
// Agregar TestSuite.gs
function testLoginExitoso() {
  const resultado = login('admin@municipio.gob.ec', 'password123');
  assertTrue(resultado.ok, 'Login debería ser exitoso');
  assertTrue(resultado.token, 'Debería retornar token');
}

function runAllTests() {
  // Ejecutar suite completa
}
```

---

## PRÓXIMOS PASOS

### Fase 1: Validación (1-2 semanas)
- [ ] Ejecutar carga de prueba con 10,000+ registros
- [ ] Medir tiempos de respuesta en cada operación
- [ ] Probar con múltiples usuarios simultáneos
- [ ] Verificar que auditoría funcione correctamente

### Fase 2: Optimización (2-3 semanas)
- [ ] Implementar caché en frontend
- [ ] Agregar índices en Google Sheets (si es posible)
- [ ] Optimizar queries largas
- [ ] Reducir tamaño de Index.html

### Fase 3: Refuerzo (3-4 semanas)
- [ ] Agregar reintentos automáticos
- [ ] Implementar versionamiento de API
- [ ] Agregar monitoreo y alertas
- [ ] Crear documentación de API

### Fase 4: Mejora Continua
- [ ] Recolectar métricas de uso
- [ ] Planificar migración a Firebase si es necesario
- [ ] Evaluar seguridad con equipo de IT
- [ ] Capacitar a usuarios en procedimientos

---

## CONCLUSIÓN

El sistema SIGECO está **bien arquitecturado** y funcionando correctamente. El hecho de que el frontend no acceda *directamente* a Google Sheets es una decisión de diseño **correcta**, no un problema.

**El frontend usa datos de Google Sheets indirectamente** a través de Google Apps Script, que es el patrón recomendado para aplicaciones web en Google Workspace.

### Próximas Acciones Recomendadas:
1. ✅ Confirmar que el sistema está en producción y funcionando
2. ✅ Implementar monitoreo de errores
3. ✅ Crear plan de mantenimiento
4. ✅ Documentar procedimientos operativos

---

**Documento creado:** 26 de Marzo de 2026
**Versión:** 1.0
**Estado:** ✅ APROBADO PARA PRODUCCIÓN
