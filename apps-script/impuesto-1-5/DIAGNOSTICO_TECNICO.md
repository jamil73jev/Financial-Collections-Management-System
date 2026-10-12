# DIAGNÓSTICO TÉCNICO - Verificación del Flujo Frontend-Google Sheets

**Documento:** Verificación de conectividad y flujo de datos
**Fecha:** 26 de Marzo de 2026
**Estado:** 🔍 PARA VALIDACIÓN EN ENTORNO DE PRODUCCIÓN

---

## PARTE 1: VERIFICACIÓN DEL FLUJO DE DATOS

### ✓ Checklist de Funcionamiento

#### Frontend → Backend
```
✓ Frontend carga Index.html correctamente
✓ google.script.run está disponible
✓ Función call() ejecuta sin errores
✓ Timeout de respuesta < 30 segundos
```

#### Backend → Google Sheets
```
✓ getSpreadsheet() retorna el spreadsheet
✓ getHoja(nombreHoja) encuentra todas las hojas
✓ getDataAsObjects() transforma datos a JSON
✓ Datos retornados al frontend sin errores
```

#### Validaciones
```
✓ Credenciales de usuario se validan contra USUARIOS sheet
✓ Permisos se validan contra tabla de roles
✓ Operaciones se registran en BITACORA
✓ Alertas se calculan correctamente
```

---

## PARTE 2: PUNTOS DE CONEXIÓN CLAVE

### 1️⃣ LOGIN (Autenticación)

**Frontend** → **Backend** → **Google Sheets**

```
Frontend:
  call('login', { usuario: 'jduran@municipio.gob.ec', password: '***' })

Backend (Auth.gs):
  function login(usuario, password) {
    // 1. Busca usuario en USUARIOS sheet
    const usuarioRecord = findRowByField('USUARIOS', 'CORREO_INSTITUCIONAL', usuario);

    // 2. Si existe, valida contraseña
    if (!usuarioRecord) return { ok: false, error: 'Usuario no encontrado' };

    const passwordValido = verificarPassword(password, usuarioRecord.PASSWORD_HASH);
    if (!passwordValido) return { ok: false, error: 'Contraseña incorrecta' };

    // 3. Crea sesión y token
    const token = generarToken();
    sesiones[token] = {
      usuario: usuarioRecord.CORREO_INSTITUCIONAL,
      rol: usuarioRecord.ROL,
      nivel: ROLES[usuarioRecord.ROL].nivel,
      timestamp: new Date()
    };

    // 4. Retorna al frontend
    return { ok: true, token, sesion: sesiones[token] };
  }

Google Sheets:
  - Lee de: USUARIOS sheet
  - Columnas: CORREO_INSTITUCIONAL, PASSWORD_HASH, PASSWORD_SALT, ROL
```

**Verificación:**
- [ ] Conectarse con credenciales válidas
- [ ] Obtener token de sesión
- [ ] Verificar que Token aparece en Console del navegador

---

### 2️⃣ CARGA DE EXPEDIENTES

**Frontend** → **Backend** → **Google Sheets**

```
Frontend (Index.html línea 777):
  async function buscarExpedientes(pagina) {
    const r = await call('listExpedientes', { token: TOKEN, pagina, filtros });
    // Renderiza en tabla
  }

Backend (ExpedienteService.gs):
  function listExpedientes(token, pagina, filtros) {
    // 1. Valida sesión y permisos
    const sesion = verificarSesion(token);
    if (!sesion) return { ok: false, error: 'Sesión inválida' };

    // 2. Lee datos de Google Sheets
    let expedientes = getDataAsObjects('EXPEDIENTES');

    // 3. Aplica filtros
    if (filtros.estado) {
      expedientes = expedientes.filter(e =>
        e.ESTADO_EXPEDIENTE === filtros.estado
      );
    }

    // 4. Aplica paginación
    const pagina = parseInt(pagina) || 1;
    const pageSize = PARAMS.PAGE_SIZE; // 50
    const inicio = (pagina - 1) * pageSize;
    const datos = expedientes.slice(inicio, inicio + pageSize);

    // 5. Transforma a formato frontend
    return {
      ok: true,
      expedientes: datos.map(e => ({
        id: e.ID_EXPEDIENTE,
        contribuyente: e.CONTRIBUYENTE,
        ruc: e.RUC,
        estado: e.ESTADO_EXPEDIENTE,
        alerta: e.ALERTA_ESTADO
      })),
      total: expedientes.length,
      pagina
    };
  }

Google Sheets:
  - Lee de: EXPEDIENTES sheet
  - Columnas: ID_EXPEDIENTE, CONTRIBUYENTE, RUC, ESTADO_EXPEDIENTE, ALERTA_ESTADO, etc.
  - Registros: 10,000+ esperados
```

**Verificación:**
- [ ] Navegador abre pestaña "Expedientes"
- [ ] Tabla se llena con datos (si existen)
- [ ] Paginación funciona (si hay >50 registros)
- [ ] Filtros funcionan correctamente

---

### 3️⃣ REGISTRO DE GESTIÓN

**Frontend** → **Backend** → **Google Sheets (ESCRITO)**

```
Frontend (Index.html línea 900+):
  async function guardarGestion() {
    const datos = {
      idExpediente: document.getElementById('gest-exp-id').value,
      tipoGestion: document.getElementById('gest-tipo').value,
      resultado: document.getElementById('gest-resultado').value,
      observacion: document.getElementById('gest-obs').value,
      fechaProximaGestion: document.getElementById('gest-fecha-prox').value,
      estadoPostGestion: document.getElementById('gest-estado-post').value
    };
    const r = await call('registerGestion', { token: TOKEN, datos });
  }

Backend (GestionService.gs):
  function registerGestion(token, datos) {
    // 1. Valida sesión y permisos
    const acceso = checkAccess(token, 'REGISTRAR_GESTION');
    if (!acceso.ok) return acceso;

    // 2. Valida datos
    const validacion = validateGestion(datos);
    if (!validacion.valido) return { ok: false, error: validacion.errores };

    // 3. Lee expediente de Google Sheets
    const expediente = findRowByField('EXPEDIENTES', 'ID_EXPEDIENTE', datos.idExpediente);
    if (!expediente) return { ok: false, error: 'Expediente no encontrado' };

    // 4. ESCRIBE en GESTIONES sheet
    appendRow('GESTIONES', [
      generarIdGestion(),                      // ID_GESTION
      new Date(),                              // FECHA_REGISTRO
      datos.idExpediente,                      // ID_EXPEDIENTE
      acceso.sesion.usuario,                   // FUNCIONARIO
      datos.tipoGestion,                       // TIPO_GESTION
      datos.resultado,                         // RESULTADO
      datos.observacion || '',                 // OBSERVACION
      datos.fechaProximaGestion || '',         // FECHA_PROXIMA_GESTION
      datos.estadoPostGestion || '',           // ESTADO_POST_GESTION
      acceso.sesion.usuario,                   // USUARIO_EDITOR
      new Date().toISOString()                 // TIMESTAMP
    ]);

    // 5. ACTUALIZA EXPEDIENTES sheet
    updateRowFields('EXPEDIENTES', expediente._rowIndex, {
      'FECHA_ULTIMA_GESTION': new Date(),
      'RESULTADO_ULTIMA_GESTION': datos.resultado,
      'DIAS_SIN_MOVIMIENTO': 0,
      'ALERTA_ESTADO': 'OK'
    });

    // 6. Registra en BITACORA
    logAction({
      token,
      hoja: 'GESTIONES',
      idExpediente: datos.idExpediente,
      accion: 'REGISTRAR_GESTION',
      contexto: 'Tipo: ' + datos.tipoGestion
    });

    // 7. Retorna al frontend
    return { ok: true, id: generarIdGestion() };
  }

Google Sheets:
  - ESCRIBE en: GESTIONES sheet (nueva fila)
  - ACTUALIZA: EXPEDIENTES sheet (campos derivados)
  - ESCRIBE en: BITACORA sheet (registro de auditoría)
```

**Verificación:**
- [ ] Modal "Registrar Gestión" se abre
- [ ] Formulario se completa y valida
- [ ] Al guardar, obtener "Gestión registrada" exitosamente
- [ ] Verificar en Google Sheets que la fila se agregó
- [ ] Verificar en BITACORA que se registró el cambio

---

## PARTE 3: MONITOREO DEL FLUJO

### Cómo Verificar que Google Sheets se Está Usando

#### Método 1: Console del Navegador

1. Abrir DevTools (F12)
2. Ir a "Network" o "Console"
3. Ejecutar una acción (ej. clic en Dashboard)
4. Ver las llamadas a `google.script.run`:

```javascript
// En Console, ejecutar:
google.script.run.withSuccessHandler(r => console.log(r)).dispatch('getDashboardKPIs', { token: window.TOKEN });
```

5. La respuesta debería incluir datos de Google Sheets:
```json
{
  "ok": true,
  "kpis": {
    "expActivos": 145,
    "expSinMovimiento": 23,
    "expVencidos": 8,
    "gestionesMes": 342,
    "porEstado": { "EN_GESTION": 67, "COMPROMETIDO_PAGO": 45, ... }
  }
}
```

---

#### Método 2: Auditar Google Sheets Directamente

1. Abrir el Google Sheet de SIGECO
2. Ir a la pestaña "BITACORA"
3. Deberías ver registros como:

```
FECHA_HORA           | USUARIO              | ACCION              | CAMPO
2026-03-26 14:30:45 | jduran@municipio.... | REGISTRAR_GESTION   | FECHA_REGISTRO
2026-03-26 14:31:20 | jduran@municipio.... | ACTUALIZAR_EXPEDIENTE | DIAS_SIN_MOVIMIENTO
2026-03-26 14:32:10 | admin@municipio....  | LOGIN               | TOKEN_GENERADO
```

Esto prueba que:
- ✅ Backend está leyendo Google Sheets
- ✅ Backend está escribiendo en Google Sheets
- ✅ Frontend está enviando datos al backend

---

#### Método 3: Ejecutar Script de Prueba

Agregar esta función en `Code.gs`:

```javascript
/**
 * Función de prueba para verificar conectividad
 * Ejecutar desde: Apps Script > Ejecutar función > testConectividadSheets
 */
function testConectividadSheets() {
  const resultado = {
    timestamp: new Date().toISOString(),
    pruebas: {}
  };

  try {
    // Prueba 1: Acceder a Spreadsheet
    const ss = getSpreadsheet();
    resultado.pruebas.spreadsheet = { ok: true, id: ss.getId() };
  } catch (e) {
    resultado.pruebas.spreadsheet = { ok: false, error: e.message };
  }

  try {
    // Prueba 2: Leer USUARIOS
    const usuarios = getDataAsObjects('USUARIOS');
    resultado.pruebas.usuariosRead = { ok: true, count: usuarios.length };
  } catch (e) {
    resultado.pruebas.usuariosRead = { ok: false, error: e.message };
  }

  try {
    // Prueba 3: Leer EXPEDIENTES
    const expedientes = getDataAsObjects('EXPEDIENTES');
    resultado.pruebas.expedientesRead = { ok: true, count: expedientes.length };
  } catch (e) {
    resultado.pruebas.expedientesRead = { ok: false, error: e.message };
  }

  try {
    // Prueba 4: Calcular KPIs
    const kpis = getDashboardKPIs('DUMMY_TOKEN_PARA_TEST');
    resultado.pruebas.kpisCalculados = { ok: true, indicadores: Object.keys(kpis.kpis || {}).length };
  } catch (e) {
    resultado.pruebas.kpisCalculados = { ok: false, error: e.message };
  }

  // Registrar resultado
  Logger.log(JSON.stringify(resultado, null, 2));

  return resultado;
}
```

Luego ejecutar desde Google Apps Script Editor:
1. Abrir Script Editor (Extensiones > Apps Script)
2. Menú: Ejecutar > testConectividadSheets
3. Ver resultados en Registros

Resultado esperado:
```json
{
  "timestamp": "2026-03-26T14:35:22.123Z",
  "pruebas": {
    "spreadsheet": { "ok": true, "id": "1a2b3c4d..." },
    "usuariosRead": { "ok": true, "count": 8 },
    "expedientesRead": { "ok": true, "count": 1247 },
    "kpisCalculados": { "ok": true, "indicadores": 8 }
  }
}
```

---

## PARTE 4: DIAGNÓSTICO DE PROBLEMAS

### Escenario: Frontend no muestra datos

**Síntoma:** Página vacía cuando debería mostrar expedientes

**Diagnóstico:**

1. Verificar que el usuario está logueado
   ```javascript
   // En Console
   console.log(TOKEN);     // Debería mostrar un string largo
   console.log(SESION);    // Debería mostrar objeto con usuario, rol, nivel
   ```

2. Verificar que Google Sheets está accesible
   ```javascript
   // En Apps Script Console
   getSpreadsheet();  // Debería ejecutarse sin error
   ```

3. Verificar que la hoja EXPEDIENTES existe
   ```javascript
   getHoja('EXPEDIENTES');  // Debería retornar la hoja
   ```

4. Verificar que hay datos en EXPEDIENTES
   ```javascript
   const count = countRows('EXPEDIENTES');  // Debería ser > 0
   ```

5. Verificar el call al backend
   ```javascript
   // En Console del navegador
   google.script.run
     .withSuccessHandler(r => console.log('Respuesta:', r))
     .withFailureHandler(e => console.log('Error:', e))
     .dispatch('listExpedientes', { token: TOKEN, pagina: 1, filtros: {} });
   ```

6. Si error, revisar logs de Apps Script
   - Extensiones > Apps Script
   - Menú: Ejecuciones
   - Ver últimas ejecuciones y sus errores

---

### Escenario: Datos no se guardan en Google Sheets

**Síntoma:** Registro una gestión pero no aparece en la tabla

**Diagnóstico:**

1. Verificar que la operación retorna éxito
   ```javascript
   const resultado = await call('registerGestion', { token: TOKEN, datos });
   console.log(resultado);  // Debería ser { ok: true, id: 'GES-...' }
   ```

2. Si retorna error, revisar el mensaje
   - Podría ser permisos insuficientes
   - Podría ser validación fallida
   - Podría ser expediente no encontrado

3. Revisar que se escribió en Google Sheets
   - Abrir Google Sheet
   - Ir a pestaña GESTIONES
   - Última fila debería tener el nuevo registro

4. Revisar auditoría
   - Ir a pestaña BITACORA
   - Buscar registros con la acción REGISTRAR_GESTION
   - Si no aparece, el backend no escribió

5. Si BITACORA está vacío
   - El backend no está ejecutando `logAction()`
   - Revisar que `logAction()` en BitacoraService.gs funciona
   - Verificar que la hoja BITACORA existe

---

## PARTE 5: METRICAS DE SALUD

### KPIs para Monitorear

Agregar en `DashboardService.gs`:

```javascript
function getHealthMetrics(token) {
  const metricas = {
    timestamp: new Date().toISOString(),
    backend: {},
    sheets: {},
    performance: {}
  };

  // Métricas Backend
  metricas.backend.totalUsuarios = countRows('USUARIOS');
  metricas.backend.totalExpedientes = countRows('EXPEDIENTES');
  metricas.backend.totalGestiones = countRows('GESTIONES');
  metricas.backend.bitacoraSize = countRows('BITACORA');

  // Métricas Sheets
  try {
    const ss = getSpreadsheet();
    metricas.sheets.hojas = ss.getSheets().length;
    metricas.sheets.spreadsheetId = ss.getId();
    metricas.sheets.ok = true;
  } catch (e) {
    metricas.sheets.ok = false;
    metricas.sheets.error = e.message;
  }

  // Métricas Performance
  const start = Date.now();
  getDataAsObjects('EXPEDIENTES');
  metricas.performance.readExpedientesMs = Date.now() - start;

  return { ok: true, metricas };
}
```

Luego llamar regularmente:
```javascript
call('getHealthMetrics', { token: TOKEN });
```

---

## CONCLUSIÓN

El frontend **SÍ ESTÁ USANDO** datos de Google Sheets, pero indirectamente:

```
Google Sheets
    ↑↓ (SheetService.gs)
Google Apps Script (Backend)
    ↑↓ (google.script.run)
Frontend (navegador)
    ↓
Usuario
```

Este es el diseño correcto. Si falta datos en el frontend, verificar:
1. ✅ Google Sheets tiene datos
2. ✅ Backend puede leerlos (SheetService.gs)
3. ✅ Frontend puede llamar backend (google.script.run)
4. ✅ Browser muestra respuesta (HTML/JS)

---

**Fecha:** 26 de Marzo de 2026
**Última actualización:** Versión 1.0
**Estado:** ✅ LISTA PARA DIAGNOSTICO
