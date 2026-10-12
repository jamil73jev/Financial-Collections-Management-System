/**
 * ResultadosService.gs
 * Módulo de alertas y resultados operativos para gestores y supervisores.
 *
 * Retorna 4 conjuntos de datos:
 *   1. Promesas de pago vencidas (PROMESA_PAGO sin cumplir)
 *   2. Gestiones con fecha próxima vencida
 *   3. Expedientes COMPROMETIDO_PAGO sin pago reciente (>5 días)
 *   4. Ranking de gestores del mes actual
 *
 * Visibilidad por rol:
 *   - GESTOR     → solo sus propios expedientes/gestiones
 *   - SUPERVISOR/ADMIN → todo, con mapa de nombres de gestores
 */

function getResultadosData(token) {
  const acceso = checkAccess(token, 'VER_DASHBOARD');
  if (!acceso.ok) return acceso;
  const sesion  = acceso.sesion;

  try {
    const hoy       = new Date();
    const esGestor  = sesion.nivel <= (ROLES.GESTOR ? ROLES.GESTOR.nivel : 2);
    const miCorreo  = String(sesion.usuario || '').toLowerCase().trim();

    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
    const gestiones   = getDataAsObjects(SHEET_NAMES.GESTIONES);
    const usuarios    = getDataAsObjects(SHEET_NAMES.USUARIOS);

    // Mapa correo → nombre
    const mapaUsuarios = {};
    usuarios.forEach(u => {
      if (u.CORREO_INSTITUCIONAL) {
        mapaUsuarios[String(u.CORREO_INSTITUCIONAL).toLowerCase()] =
          u.NOMBRE || u.CORREO_INSTITUCIONAL;
      }
    });

    const _nombre = correo => {
      const k = String(correo || '').toLowerCase();
      return mapaUsuarios[k] || k.split('@')[0];
    };

    // Expedientes activos (no terminales)
    const activos = expedientes.filter(e =>
      (e.ACTIVO === 'TRUE' || e.ACTIVO === true) &&
      !esEstadoTerminal(e.ESTADO_EXPEDIENTE)
    );

    // Filtrar por gestor si aplica
    const expBase = esGestor
      ? activos.filter(e => String(e.FUNCIONARIO_ASIGNADO || '').toLowerCase().trim() === miCorreo)
      : activos;

    // ── 1. Promesas de Pago Vencidas ─────────────────────────────────────
    // Encuentra la gestión más reciente con RESULTADO=PROMESA_PAGO por expediente
    const ultimaPromesa = {};
    gestiones.forEach(g => {
      if (g.RESULTADO !== 'PROMESA_PAGO' || !g.FECHA_PROXIMA_GESTION) return;
      if (esGestor && String(g.FUNCIONARIO || '').toLowerCase().trim() !== miCorreo) return;
      const id = g.ID_EXPEDIENTE;
      const ts = g.TIMESTAMP ? new Date(g.TIMESTAMP).getTime() : 0;
      if (!ultimaPromesa[id] || ts > ultimaPromesa[id]._ts) {
        ultimaPromesa[id] = { ...g, _ts: ts };
      }
    });

    const promesasVencidas = expBase
      .filter(e => {
        const p = ultimaPromesa[e.ID_EXPEDIENTE];
        if (!p) return false;
        const fp = new Date(String(p.FECHA_PROXIMA_GESTION).substring(0, 10));
        return fp < hoy;
      })
      .map(e => {
        const p  = ultimaPromesa[e.ID_EXPEDIENTE];
        const fp = new Date(String(p.FECHA_PROXIMA_GESTION).substring(0, 10));
        const diasVencido = Math.max(0, Math.floor((hoy - fp) / 86400000));
        return {
          id:             String(e.ID_EXPEDIENTE),
          contribuyente:  String(e.CONTRIBUYENTE || ''),
          gestor:         String(e.FUNCIONARIO_ASIGNADO || ''),
          nombreGestor:   _nombre(e.FUNCIONARIO_ASIGNADO),
          estado:         String(e.ESTADO_EXPEDIENTE || ''),
          fechaPromesa:   String(p.FECHA_PROXIMA_GESTION).substring(0, 10),
          diasVencido,
          observacion:    String(p.OBSERVACION || ''),
          saldoPendiente: parseFloat(e.SALDO_PENDIENTE) || parseFloat(e.TOTAL_DEUDA) || 0,
          totalDeuda:     parseFloat(e.TOTAL_DEUDA) || 0
        };
      })
      .sort((a, b) => b.diasVencido - a.diasVencido);

    // ── 2. Gestiones con Fecha Próxima Vencida ───────────────────────────
    const gestionesVencidas = expBase
      .filter(e => {
        if (!e.FECHA_PROXIMA_GESTION) return false;
        const fp = new Date(String(e.FECHA_PROXIMA_GESTION).substring(0, 10));
        return fp < hoy;
      })
      .map(e => {
        const fp = new Date(String(e.FECHA_PROXIMA_GESTION).substring(0, 10));
        const diasVencido = Math.max(0, Math.floor((hoy - fp) / 86400000));
        return {
          id:            String(e.ID_EXPEDIENTE),
          contribuyente: String(e.CONTRIBUYENTE || ''),
          gestor:        String(e.FUNCIONARIO_ASIGNADO || ''),
          nombreGestor:  _nombre(e.FUNCIONARIO_ASIGNADO),
          prioridad:     String(e.PRIORIDAD || ''),
          estado:        String(e.ESTADO_EXPEDIENTE || ''),
          fechaProxima:  String(e.FECHA_PROXIMA_GESTION).substring(0, 10),
          diasVencido,
          totalDeuda:    parseFloat(e.TOTAL_DEUDA) || 0
        };
      })
      .sort((a, b) => b.diasVencido - a.diasVencido)
      .slice(0, 50);

    // ── 3. COMPROMETIDO_PAGO sin pago reciente (> 5 días) ────────────────
    const hace5dias = new Date(hoy.getTime() - 5 * 86400000);
    const comprometidosSinPago = expBase
      .filter(e => {
        if (e.ESTADO_EXPEDIENTE !== 'COMPROMETIDO_PAGO') return false;
        if (!e.FECHA_ULTIMO_PAGO) return true; // nunca pagó
        const fup = new Date(String(e.FECHA_ULTIMO_PAGO).substring(0, 10));
        return fup < hace5dias;
      })
      .map(e => {
        let diasSinPago = null;
        if (e.FECHA_ULTIMO_PAGO) {
          const fup = new Date(String(e.FECHA_ULTIMO_PAGO).substring(0, 10));
          diasSinPago = Math.max(0, Math.floor((hoy - fup) / 86400000));
        }
        return {
          id:              String(e.ID_EXPEDIENTE),
          contribuyente:   String(e.CONTRIBUYENTE || ''),
          gestor:          String(e.FUNCIONARIO_ASIGNADO || ''),
          nombreGestor:    _nombre(e.FUNCIONARIO_ASIGNADO),
          saldoPendiente:  parseFloat(e.SALDO_PENDIENTE) || parseFloat(e.TOTAL_DEUDA) || 0,
          fechaUltimoPago: e.FECHA_ULTIMO_PAGO ? String(e.FECHA_ULTIMO_PAGO).substring(0, 10) : null,
          diasSinPago,
          totalDeuda:      parseFloat(e.TOTAL_DEUDA) || 0
        };
      })
      .sort((a, b) => (b.diasSinPago === null ? 9999 : b.diasSinPago) -
                       (a.diasSinPago === null ? 9999 : a.diasSinPago))
      .slice(0, 30);

    // ── 4. Ranking del mes actual ─────────────────────────────────────────
    const mesActual = Utilities.formatDate(hoy, PARAMS.TIMEZONE, 'yyyy-MM');

    const porGestor = {};
    gestiones.forEach(g => {
      const correo = String(g.FUNCIONARIO || '').toLowerCase().trim();
      if (!correo) return;
      if (esGestor && correo !== miCorreo) return;
      if (!String(g.FECHA_REGISTRO || '').startsWith(mesActual)) return;

      if (!porGestor[correo]) porGestor[correo] = {
        correo, gestiones: 0, promesas: 0, pagosConfirmados: 0, montoRecaudado: 0
      };
      const g_ = porGestor[correo];
      g_.gestiones++;
      if (g.RESULTADO === 'PROMESA_PAGO')    g_.promesas++;
      if (g.RESULTADO === 'PAGO_CONFIRMADO') g_.pagosConfirmados++;
      g_.montoRecaudado += parseFloat(g.MONTO_RECAUDADO) || 0;
    });

    const ranking = Object.values(porGestor)
      .map((g, idx) => ({
        posicion:         idx + 1,
        correo:           g.correo,
        nombre:           _nombre(g.correo),
        gestiones:        g.gestiones,
        promesas:         g.promesas,
        pagosConfirmados: g.pagosConfirmados,
        montoRecaudado:   parseFloat(g.montoRecaudado.toFixed(2)),
        tasaExito:        g.gestiones > 0
          ? parseFloat((g.pagosConfirmados / g.gestiones * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.gestiones - a.gestiones)
      .map((g, idx) => ({ ...g, posicion: idx + 1 }));

    return {
      ok: true,
      mes: mesActual,
      kpis: {
        promesasVencidas:    promesasVencidas.length,
        gestionesVencidas:   gestionesVencidas.length,
        comprometidosSinPago: comprometidosSinPago.length,
        totalAlertas:        promesasVencidas.length + comprometidosSinPago.length
      },
      promesasVencidas,
      gestionesVencidas,
      comprometidosSinPago,
      ranking
    };

  } catch (err) {
    Logger.log('getResultadosData ERROR: ' + err.message + '\n' + err.stack);
    return { ok: false, error: 'Error cargando resultados: ' + err.message };
  }
}
