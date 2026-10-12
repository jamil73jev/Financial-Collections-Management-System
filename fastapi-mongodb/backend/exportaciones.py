"""
SIGECO — Módulo de Exportaciones
==================================
Genera archivos Excel y PDF descargables desde el frontend.

Dependencias:
    pip install openpyxl reportlab

Endpoints:
    GET /api/export/morosidad.xlsx
    GET /api/export/notificaciones.xlsx
    GET /api/export/contribuyentes.xlsx
    GET /api/export/recaudacion.xlsx
    GET /api/export/reporte_morosidad.pdf
    GET /api/export/notificacion/{nid}.pdf
"""

import io
import os
from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pymongo import DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

from auth import require_any, require_gestor, require_supervisor

# ── Configuración ─────────────────────────────────────────────────────────────
MONGO_URI   = os.getenv("MONGO_URI",   "mongodb://localhost:27017")
DB_NAME     = os.getenv("DB_NAME",     "Thunder")
COL_CONTRIB = os.getenv("COL_CONTRIB", "Base1,5")

_client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db_obj = _client[DB_NAME]

def _db():
    return _db_obj

router = APIRouter(prefix="/api/export", tags=["Exportaciones"])


# ── Helpers de estilo Excel ────────────────────────────────────────────────────
def _apply_excel_styles(wb, ws, headers: list, col_widths: list):
    """Aplica estilos profesionales a la hoja Excel."""
    from openpyxl.styles import (
        Font, PatternFill, Alignment, Border, Side, GradientFill
    )
    from openpyxl.utils import get_column_letter

    # Colores institucionales
    COLOR_HEADER  = "1A2472"   # Azul municipio
    COLOR_ACCENT  = "F5C000"   # Amarillo acento
    COLOR_ROW_ODD = "F0F4FF"   # Azul muy claro para filas alternas

    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # Encabezado
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.value = header
        cell.font  = Font(bold=True, color="FFFFFF", size=10, name="Calibri")
        cell.fill  = PatternFill("solid", fgColor=COLOR_HEADER)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

    # Altura del encabezado
    ws.row_dimensions[1].height = 30

    # Anchos de columna
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width

    # Filas de datos
    for row_num in range(2, ws.max_row + 1):
        fill_color = COLOR_ROW_ODD if row_num % 2 == 0 else "FFFFFF"
        for col_num in range(1, len(headers) + 1):
            cell = ws.cell(row=row_num, column=col_num)
            cell.fill   = PatternFill("solid", fgColor=fill_color)
            cell.font   = Font(size=9, name="Calibri")
            cell.border = border
            cell.alignment = Alignment(vertical="center")

    # Congelar fila de encabezado
    ws.freeze_panes = "A2"

    # Filtro automático
    ws.auto_filter.ref = ws.dimensions

    return wb


def _excel_header_row(ws, titulo: str, subtitulo: str, num_cols: int):
    """Inserta 2 filas de título institucional antes de los datos."""
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    ws.insert_rows(1, 2)

    # Fila 1: Título principal
    cell = ws.cell(row=1, column=1)
    cell.value = f"MUNICIPIO DE GUAYAQUIL — {titulo}"
    cell.font  = Font(bold=True, size=13, color="1A2472", name="Calibri")
    cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
    ws.row_dimensions[1].height = 22

    # Fila 2: Subtítulo + fecha
    cell2 = ws.cell(row=2, column=1)
    cell2.value = f"{subtitulo}   |   Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')}"
    cell2.font  = Font(size=9, color="666666", name="Calibri", italic=True)
    cell2.alignment = Alignment(horizontal="left", vertical="center")
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_cols)
    ws.row_dimensions[2].height = 16


# ═══════════════════════════════════════════════════════════════════════════════
# EXCEL ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/morosidad.xlsx", summary="Exportar morosidad a Excel")
async def export_morosidad_excel(
    clasificacion: str   = Query(None),
    tipoPersona:   str   = Query(None),
    minDeuda:      float = Query(None, ge=0),
    maxDeuda:      float = Query(None, ge=0),
    anio:          int   = Query(None),
    current_user:  dict  = Depends(require_any),
):
    """Exporta el listado de morosidad con los filtros activos a Excel."""
    import openpyxl

    db = _db()

    from main import _mora_pipeline_stages
    stages = _mora_pipeline_stages()
    match: dict = {"_saldo": {"$gt": 0}}
    if clasificacion: match["clasificacionMora"] = clasificacion
    if tipoPersona:   match["TipoPersona"]       = tipoPersona
    if minDeuda is not None: match.setdefault("_saldo", {})["$gte"] = minDeuda
    if maxDeuda is not None: match.setdefault("_saldo", {})["$lte"] = maxDeuda
    if anio:          match["AnioSolicitud"]      = anio

    pipeline = stages + [
        {"$match": match},
        {"$sort": {"deudaVencida": -1}},
        {"$limit": 10000},
        {"$project": {
            "Ruc": 1, "NombreContribuyente": 1, "TipoPersona": 1,
            "ActividadEconomicaPrincipal": 1, "CorreoEMAS": 1, "TelefonoEMAS": 1,
            "EstadoDeclaracion": 1, "AnioSolicitud": 1,
            "deudaTotal": 1, "deudaVencida": 1, "diasMora": 1,
            "clasificacionMora": 1, "prioridadGestion": 1,
        }},
    ]
    cursor = db[COL_CONTRIB].aggregate(pipeline, allowDiskUse=True)
    docs = await cursor.to_list(10000)

    # Crear workbook
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Morosidad"

    headers = [
        "RUC / Cédula", "Contribuyente", "Tipo Persona",
        "Actividad Económica", "Deuda Total $", "Deuda Vencida $",
        "Días Mora *", "Clasificación", "Prioridad",
        "Estado Declaración", "Año Fiscal", "Correo", "Teléfono",
    ]
    col_widths = [16, 35, 12, 30, 14, 14, 10, 14, 10, 18, 10, 28, 14]

    for col, h in enumerate(headers, 1):
        ws.cell(row=1, column=col).value = h

    for doc in docs:
        ws.append([
            doc.get("Ruc", ""),
            doc.get("NombreContribuyente", ""),
            doc.get("TipoPersona", ""),
            (doc.get("ActividadEconomicaPrincipal") or "")[:50],
            round(doc.get("deudaTotal", 0), 2),
            round(doc.get("deudaVencida", 0), 2),
            doc.get("diasMora", 0),
            doc.get("clasificacionMora", ""),
            doc.get("prioridadGestion", ""),
            doc.get("EstadoDeclaracion", ""),
            doc.get("AnioSolicitud", ""),
            doc.get("CorreoEMAS", ""),
            doc.get("TelefonoEMAS", ""),
        ])

    _apply_excel_styles(wb, ws, headers, col_widths)
    _excel_header_row(ws, "REPORTE DE MOROSIDAD",
                      "Depto. Control Financiero y Estadística", len(headers))

    # Nota al pie
    last_row = ws.max_row + 2
    ws.cell(row=last_row, column=1).value = (
        "* Días Mora es un valor estimado (Saldo / 5). "
        "No existe campo FechaVencimiento en el sistema fuente."
    )
    from openpyxl.styles import Font
    ws.cell(row=last_row, column=1).font = Font(size=8, italic=True, color="999999")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"morosidad_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/notificaciones.xlsx", summary="Exportar notificaciones a Excel")
async def export_notificaciones_excel(
    estado:       str  = Query(None),
    empleadoId:   str  = Query(None),
    current_user: dict = Depends(require_gestor),
):
    import openpyxl

    db = _db()
    query: dict = {}
    if estado:     query["estado"]     = estado
    if empleadoId: query["empleadoId"] = empleadoId

    cursor = db["notificaciones"].find(query).sort("fechaCreacion", DESCENDING).limit(10000)
    docs = await cursor.to_list(10000)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Notificaciones"

    headers = [
        "Contribuyente", "RUC / Cédula", "Empleado Asignado",
        "Estado", "Medio", "Monto Impuesto $",
        "Ejercicio Fiscal", "Fecha Creación", "Fecha Actualización", "Observaciones",
    ]
    col_widths = [35, 16, 25, 14, 12, 16, 14, 18, 18, 40]

    for col, h in enumerate(headers, 1):
        ws.cell(row=1, column=col).value = h

    for d in docs:
        ws.append([
            d.get("contribuyente", ""),
            d.get("ruc", ""),
            d.get("empleado", ""),
            d.get("estado", ""),
            d.get("medioNotificacion", ""),
            round(float(d.get("impuesto") or 0), 2),
            d.get("ejercicioFiscal", ""),
            (d.get("fechaCreacion") or "")[:16],
            (d.get("fechaActualizacion") or "")[:16],
            d.get("observaciones", ""),
        ])

    _apply_excel_styles(wb, ws, headers, col_widths)
    _excel_header_row(ws, "REPORTE DE NOTIFICACIONES",
                      "Depto. Control Financiero y Estadística", len(headers))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"notificaciones_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/contribuyentes.xlsx", summary="Exportar contribuyentes a Excel")
async def export_contribuyentes_excel(
    search:       str  = Query(None),
    estado:       str  = Query(None),
    current_user: dict = Depends(require_any),
):
    import openpyxl

    db = _db()
    query: dict = {}
    if search:
        query["$or"] = [
            {"NombreContribuyente": {"$regex": search, "$options": "i"}},
            {"Ruc": {"$regex": search, "$options": "i"}},
        ]
    if estado:
        query["EstadoDeclaracion"] = {"$regex": estado, "$options": "i"}

    cursor = db[COL_CONTRIB].find(query).limit(10000)
    docs = await cursor.to_list(10000)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Contribuyentes"

    headers = [
        "RUC / Cédula", "Nombre / Razón Social", "Tipo Persona",
        "Rep. Legal", "Actividad Económica", "Estado Declaración",
        "Valor Impuesto $", "Valor Pagado $", "Saldo $",
        "Dirección", "Correo", "Teléfono",
    ]
    col_widths = [16, 35, 12, 28, 30, 18, 15, 15, 12, 35, 28, 14]

    for col, h in enumerate(headers, 1):
        ws.cell(row=1, column=col).value = h

    def _num(v):
        try: return round(float(v or 0), 2)
        except: return 0.0

    for d in docs:
        ws.append([
            d.get("Ruc", ""),
            d.get("NombreContribuyente", ""),
            d.get("TipoPersona", ""),
            d.get("RepresentanteLegal", ""),
            (d.get("ActividadEconomicaPrincipal") or "")[:40],
            d.get("EstadoDeclaracion", ""),
            _num(d.get("ValorImpuesto")),
            _num(d.get("ValorPagado")),
            _num(d.get("Saldo")),
            (d.get("Direccion") or "")[:50],
            d.get("CorreoEMAS", ""),
            d.get("TelefonoEMAS", ""),
        ])

    _apply_excel_styles(wb, ws, headers, col_widths)
    _excel_header_row(ws, "PADRÓN DE CONTRIBUYENTES",
                      "Depto. Control Financiero y Estadística", len(headers))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"contribuyentes_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/recaudacion.xlsx", summary="Exportar recaudación a Excel")
async def export_recaudacion_excel(current_user: dict = Depends(require_any)):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    db = _db()
    pipeline = [
        {"$group": {
            "_id": {"$ifNull": ["$TipoPersona", "$TipoDeclaracion", "Sin clasificar"]},
            "totalImpuesto": {"$sum": {"$convert": {
                "input": {"$ifNull": ["$ValorImpuesto", "$Impuesto", 0]},
                "to": "double", "onError": 0.0, "onNull": 0.0,
            }}},
            "totalPagado": {"$sum": {"$convert": {
                "input": {"$ifNull": ["$ValorPagado", "$MontoPagado", 0]},
                "to": "double", "onError": 0.0, "onNull": 0.0,
            }}},
            "count": {"$sum": 1},
        }},
        {"$sort": {"totalImpuesto": -1}},
    ]
    cursor = db[COL_CONTRIB].aggregate(pipeline)
    docs = await cursor.to_list(100)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Recaudación"

    headers = [
        "Sector / Clasificación", "Nº Contribuyentes",
        "Total Impuesto $", "Total Cobrado $", "Saldo Pendiente $", "% Cumplimiento",
    ]
    col_widths = [28, 18, 18, 18, 18, 15]

    for col, h in enumerate(headers, 1):
        ws.cell(row=1, column=col).value = h

    total_imp = total_pag = total_sal = 0
    for d in docs:
        imp = round(d["totalImpuesto"], 2)
        pag = round(d["totalPagado"], 2)
        sal = round(imp - pag, 2)
        pct = round((pag / imp * 100) if imp else 0, 1)
        total_imp += imp; total_pag += pag; total_sal += sal
        ws.append([d["_id"] or "Sin clasificar", d["count"], imp, pag, sal, pct])

    # Fila de totales
    total_row = ws.max_row + 1
    ws.cell(row=total_row, column=1).value = "TOTAL GENERAL"
    ws.cell(row=total_row, column=3).value = round(total_imp, 2)
    ws.cell(row=total_row, column=4).value = round(total_pag, 2)
    ws.cell(row=total_row, column=5).value = round(total_sal, 2)
    ws.cell(row=total_row, column=6).value = round((total_pag / total_imp * 100) if total_imp else 0, 1)

    for col in range(1, 7):
        cell = ws.cell(row=total_row, column=col)
        cell.font = Font(bold=True, color="FFFFFF", name="Calibri", size=10)
        cell.fill = PatternFill("solid", fgColor="1A2472")

    _apply_excel_styles(wb, ws, headers, col_widths)
    _excel_header_row(ws, "RESUMEN DE RECAUDACIÓN",
                      "Depto. Control Financiero y Estadística", len(headers))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"recaudacion_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# PDF ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

def _pdf_header(canvas, doc, titulo: str, subtitulo: str = ""):
    """Cabecera institucional para todas las páginas del PDF."""
    from reportlab.lib.colors import HexColor
    from reportlab.lib.units import cm

    w, h = doc.pagesize
    PRIMARY = HexColor("#1A2472")
    ACCENT  = HexColor("#F5C000")

    # Barra superior azul
    canvas.setFillColor(PRIMARY)
    canvas.rect(0, h - 2.2 * cm, w, 2.2 * cm, fill=True, stroke=False)

    # Línea acento dorada
    canvas.setFillColor(ACCENT)
    canvas.rect(0, h - 2.4 * cm, w, 0.2 * cm, fill=True, stroke=False)

    # Texto cabecera
    canvas.setFillColor(HexColor("#FFFFFF"))
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(1 * cm, h - 1.2 * cm, "MUNICIPIO DE GUAYAQUIL")
    canvas.setFont("Helvetica", 9)
    canvas.drawString(1 * cm, h - 1.8 * cm,
                      "Depto. de Control Financiero y Estadística")

    # Título del reporte (derecha)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawRightString(w - 1 * cm, h - 1.2 * cm, titulo)
    if subtitulo:
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(w - 1 * cm, h - 1.8 * cm, subtitulo)

    # Pie de página
    canvas.setFillColor(HexColor("#999999"))
    canvas.setFont("Helvetica", 7)
    fecha = datetime.now().strftime("%d/%m/%Y %H:%M")
    canvas.drawString(1 * cm, 0.6 * cm, f"Generado: {fecha} — SIGECO v2.0")
    canvas.drawRightString(w - 1 * cm, 0.6 * cm, f"Página {doc.page}")

    # Línea separadora pie
    canvas.setStrokeColor(HexColor("#DDDDDD"))
    canvas.line(1 * cm, 1 * cm, w - 1 * cm, 1 * cm)


@router.get("/reporte_morosidad.pdf", summary="Reporte ejecutivo de morosidad en PDF")
async def export_morosidad_pdf(
    clasificacion: str  = Query(None),
    anio:          int  = Query(None),
    current_user:  dict = Depends(require_any),
):
    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle,
        Paragraph, Spacer, HRFlowable,
    )

    db = _db()

    # Obtener KPIs
    from main import _mora_pipeline_stages
    stages = _mora_pipeline_stages()
    match: dict = {"_saldo": {"$gt": 0}}
    if clasificacion: match["clasificacionMora"] = clasificacion
    if anio:          match["AnioSolicitud"]      = anio

    kpi_pipeline = stages + [
        {"$match": match},
        {"$group": {
            "_id": "$clasificacionMora",
            "count": {"$sum": 1},
            "monto": {"$sum": "$_saldo"},
        }},
    ]
    cursor_kpi = db[COL_CONTRIB].aggregate(kpi_pipeline, allowDiskUse=True)
    kpi_raw = await cursor_kpi.to_list(10)
    kpis = {r["_id"]: r for r in kpi_raw}

    # Top 50 morosos
    top_pipeline = stages + [
        {"$match": match},
        {"$sort": {"deudaVencida": -1}},
        {"$limit": 50},
        {"$project": {
            "Ruc": 1, "NombreContribuyente": 1, "TipoPersona": 1,
            "deudaVencida": 1, "diasMora": 1, "clasificacionMora": 1,
        }},
    ]
    cursor_top = db[COL_CONTRIB].aggregate(top_pipeline, allowDiskUse=True)
    top_docs = await cursor_top.to_list(50)

    # Construir PDF
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        rightMargin=1.5 * cm, leftMargin=1.5 * cm,
        topMargin=3 * cm,     bottomMargin=1.5 * cm,
    )

    PRIMARY = HexColor("#1A2472")
    ACCENT  = HexColor("#F5C000")
    styles  = getSampleStyleSheet()

    elements = []

    # Título
    title_style = ParagraphStyle(
        "title", parent=styles["Heading1"],
        textColor=PRIMARY, fontSize=16, spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        "sub", parent=styles["Normal"],
        textColor=HexColor("#666666"), fontSize=9, spaceAfter=12,
    )
    elements.append(Paragraph("REPORTE EJECUTIVO DE MOROSIDAD", title_style))
    elements.append(Paragraph(
        f"Impuesto 1.5‰ — {datetime.now().strftime('%B %Y').title()}",
        sub_style,
    ))
    elements.append(HRFlowable(width="100%", thickness=2, color=ACCENT))
    elements.append(Spacer(1, 0.4 * cm))

    # Tabla KPIs
    total_mora  = sum(r["count"] for r in kpi_raw)
    total_monto = sum(r["monto"] for r in kpi_raw)

    kpi_data = [
        ["Clasificación", "Contribuyentes", "Monto Vencido $"],
    ]
    CLASES = ["MORA_LEVE", "MORA_MEDIA", "MORA_ALTA", "MORA_CRITICA", "COACTIVA"]
    LABELS = ["Mora Leve (≤$200)", "Mora Media ($200-$1K)", "Mora Alta ($1K-$5K)",
              "Mora Crítica (>$5K)", "Coactiva"]
    for cls, lbl in zip(CLASES, LABELS):
        r = kpis.get(cls, {"count": 0, "monto": 0})
        kpi_data.append([lbl, f"{r['count']:,}", f"$ {r['monto']:,.2f}"])
    kpi_data.append(["TOTAL EN MORA", f"{total_mora:,}", f"$ {total_monto:,.2f}"])

    kpi_table = Table(kpi_data, colWidths=[8 * cm, 5 * cm, 6 * cm])
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 9),
        ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [HexColor("#F0F4FF"), colors.white]),
        ("BACKGROUND",   (0, -1), (-1, -1), HexColor("#E8ECF8")),
        ("FONTNAME",     (0, -1), (-1, -1), "Helvetica-Bold"),
        ("GRID",         (0, 0), (-1, -1), 0.5, HexColor("#CCCCCC")),
        ("ROWHEIGHT",    (0, 0), (-1, -1), 18),
        ("TOPPADDING",   (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
    ]))
    elements.append(kpi_table)
    elements.append(Spacer(1, 0.6 * cm))

    # Título top morosos
    elements.append(Paragraph(
        "TOP 50 CONTRIBUYENTES CON MAYOR DEUDA VENCIDA",
        ParagraphStyle("sub2", parent=styles["Heading2"],
                       textColor=PRIMARY, fontSize=11, spaceAfter=6),
    ))

    # Tabla top morosos
    top_data = [["#", "RUC / Cédula", "Contribuyente", "Tipo",
                 "Deuda Vencida $", "Días Mora*", "Clasificación"]]
    for i, d in enumerate(top_docs, 1):
        top_data.append([
            str(i),
            d.get("Ruc", ""),
            (d.get("NombreContribuyente") or "")[:40],
            d.get("TipoPersona", ""),
            f"$ {d.get('deudaVencida', 0):,.2f}",
            str(d.get("diasMora", 0)),
            d.get("clasificacionMora", ""),
        ])

    top_table = Table(
        top_data,
        colWidths=[1 * cm, 4 * cm, 9 * cm, 2.5 * cm, 4 * cm, 2.5 * cm, 4 * cm],
        repeatRows=1,
    )
    top_table.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR",      (0, 0), (-1, 0), colors.white),
        ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",       (0, 0), (-1, -1), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#F0F4FF"), colors.white]),
        ("GRID",           (0, 0), (-1, -1), 0.3, HexColor("#CCCCCC")),
        ("ALIGN",          (0, 0), (0, -1), "CENTER"),
        ("ALIGN",          (4, 0), (5, -1), "RIGHT"),
        ("ROWHEIGHT",      (0, 0), (-1, -1), 14),
        ("TOPPADDING",     (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 2),
    ]))
    elements.append(top_table)
    elements.append(Spacer(1, 0.4 * cm))
    elements.append(Paragraph(
        "* Días Mora es un valor estimado (Saldo / 5). No existe FechaVencimiento en el sistema fuente.",
        ParagraphStyle("note", parent=styles["Normal"],
                       textColor=HexColor("#999999"), fontSize=7),
    ))

    def _on_page(canvas, doc):
        _pdf_header(canvas, doc, "REPORTE DE MOROSIDAD",
                    datetime.now().strftime("%d/%m/%Y"))

    doc.build(elements, onFirstPage=_on_page, onLaterPages=_on_page)
    buf.seek(0)
    fname = f"morosidad_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )


@router.get("/notificacion/{nid}.pdf", summary="Carta formal de notificación en PDF")
async def export_carta_notificacion(
    nid:          str,
    current_user: dict = Depends(require_gestor),
):
    """Genera la carta formal de notificación de cobro para imprimir o enviar."""
    from reportlab.lib.colors import HexColor, black
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table,
        TableStyle, HRFlowable,
    )

    db = _db()

    # Obtener notificación
    try:
        oid = ObjectId(nid)
    except Exception:
        raise HTTPException(400, "ID de notificación inválido")

    notif = await db["notificaciones"].find_one({"_id": oid})
    if not notif:
        raise HTTPException(404, "Notificación no encontrada")

    # Obtener datos del contribuyente desde Thunder
    contrib = {}
    if notif.get("ruc"):
        contrib = await db[COL_CONTRIB].find_one({"Ruc": notif["ruc"]}) or {}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=2.5 * cm, leftMargin=2.5 * cm,
        topMargin=3.5 * cm,   bottomMargin=2 * cm,
    )

    PRIMARY = HexColor("#1A2472")
    ACCENT  = HexColor("#F5C000")
    styles  = getSampleStyleSheet()

    def s(name, **kw):
        return ParagraphStyle(name, parent=styles["Normal"], **kw)

    body      = s("body",      fontSize=10, leading=15, spaceAfter=6)
    bold_body = s("bold_body", fontSize=10, leading=15, fontName="Helvetica-Bold")
    small     = s("small",     fontSize=8,  textColor=HexColor("#666666"))
    heading   = s("heading",   fontSize=12, fontName="Helvetica-Bold",
                  textColor=PRIMARY, spaceAfter=8, spaceBefore=12)

    elements = []

    # Número de notificación y fecha
    fecha_str = datetime.now().strftime("%d de %B de %Y").replace(
        "January","enero").replace("February","febrero").replace("March","marzo")
        # (Español básico — reportlab no tiene i18n de meses)
    notif_num = str(notif["_id"])[-8:].upper()

    elements.append(Spacer(1, 0.3 * cm))
    ref_data = [
        ["Notificación Nº:", notif_num,  "Fecha:", fecha_str],
        ["Empleado:",       notif.get("empleado", "—"),
         "Estado:",         (notif.get("estado") or "").upper()],
    ]
    ref_table = Table(ref_data, colWidths=[3.5*cm, 5.5*cm, 2.5*cm, 5.5*cm])
    ref_table.setStyle(TableStyle([
        ("FONTSIZE",  (0, 0), (-1, -1), 8),
        ("FONTNAME",  (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME",  (2, 0), (2, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 0), (0, -1), PRIMARY),
        ("TEXTCOLOR", (2, 0), (2, -1), PRIMARY),
        ("TOPPADDING", (0,0),(-1,-1), 2),
        ("BOTTOMPADDING", (0,0),(-1,-1), 2),
    ]))
    elements.append(ref_table)
    elements.append(HRFlowable(width="100%", thickness=1, color=ACCENT,
                               spaceAfter=14))

    # Destinatario
    elements.append(Paragraph("SEÑOR/A:", bold_body))
    nombre = notif.get("contribuyente") or contrib.get("NombreContribuyente") or "—"
    ruc    = notif.get("ruc") or contrib.get("Ruc") or "—"
    dir_   = contrib.get("Direccion") or "—"

    elements.append(Paragraph(nombre.upper(), bold_body))
    elements.append(Paragraph(f"RUC / Cédula: <b>{ruc}</b>", body))
    elements.append(Paragraph(f"Dirección: {dir_}", body))
    elements.append(Spacer(1, 0.5 * cm))

    # Texto de la notificación
    elements.append(Paragraph("Estimado/a contribuyente:", body))
    elements.append(Spacer(1, 0.2 * cm))

    monto = notif.get("impuesto") or 0
    try: monto = float(monto)
    except: monto = 0.0

    fiscal = notif.get("ejercicioFiscal") or "—"
    elements.append(Paragraph(
        f"Por medio de la presente, el <b>Departamento de Control Financiero y "
        f"Estadística</b> de la Muy Ilustre Municipalidad de Guayaquil, en ejercicio "
        f"de sus atribuciones, le notifica que de acuerdo a nuestros registros usted "
        f"registra una <b>obligación tributaria pendiente</b> correspondiente al "
        f"Impuesto del 1.5 por Mil sobre los Activos Totales, período fiscal "
        f"<b>{fiscal}</b>.",
        body,
    ))
    elements.append(Spacer(1, 0.3 * cm))

    # Tabla de deuda
    imp_total = float(contrib.get("ValorImpuesto") or monto or 0)
    imp_pagado = float(contrib.get("ValorPagado") or 0)
    imp_saldo  = float(contrib.get("Saldo") or (imp_total - imp_pagado) or monto)

    deuda_data = [
        ["CONCEPTO", "MONTO"],
        ["Impuesto determinado",         f"$ {imp_total:,.2f}"],
        ["Valor pagado",                  f"$ {imp_pagado:,.2f}"],
        ["SALDO PENDIENTE DE PAGO",       f"$ {imp_saldo:,.2f}"],
    ]
    deuda_table = Table(deuda_data, colWidths=[10 * cm, 4 * cm])
    deuda_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), PRIMARY),
        ("TEXTCOLOR",     (0, 0), (-1, 0), HexColor("#FFFFFF")),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("ALIGN",         (1, 0), (1, -1), "RIGHT"),
        ("ROWBACKGROUNDS",(0, 1), (-1, -2), [HexColor("#F0F4FF"), HexColor("#FFFFFF")]),
        ("FONTNAME",      (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND",    (0, -1), (-1, -1), HexColor("#FFF3CD")),
        ("TEXTCOLOR",     (0, -1), (-1, -1), HexColor("#7D4E00")),
        ("GRID",          (0, 0), (-1, -1), 0.5, HexColor("#CCCCCC")),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elements.append(deuda_table)
    elements.append(Spacer(1, 0.4 * cm))

    elements.append(Paragraph(
        "Se le solicita regularizar esta obligación en un plazo no mayor a "
        "<b>15 días hábiles</b> contados desde la recepción de esta notificación, "
        "en las oficinas del Departamento de Control Financiero y Estadística, "
        "o a través de los canales de pago habilitados por la Municipalidad.",
        body,
    ))
    elements.append(Spacer(1, 0.2 * cm))
    elements.append(Paragraph(
        "El incumplimiento de esta obligación dará lugar a la aplicación de las "
        "acciones coactivas previstas en el Código Tributario y demás normativa "
        "municipal vigente.",
        body,
    ))

    # Observaciones si las hay
    obs = notif.get("observaciones", "")
    if obs:
        elements.append(Spacer(1, 0.3 * cm))
        elements.append(Paragraph("Observaciones adicionales:", bold_body))
        elements.append(Paragraph(obs, body))

    # Firma
    elements.append(Spacer(1, 1.5 * cm))
    firma_data = [
        ["", ""],
        ["___________________________", "___________________________"],
        [notif.get("empleado") or "Gestor de Cobranza",
         "Jefe del Depto. de Control Financiero"],
        ["Gestor de Cobranza", "y Estadística"],
    ]
    firma_table = Table(firma_data, colWidths=[8 * cm, 8 * cm])
    firma_table.setStyle(TableStyle([
        ("ALIGN",     (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE",  (0, 0), (-1, -1), 9),
        ("FONTNAME",  (0, 2), (-1, 2), "Helvetica-Bold"),
        ("TOPPADDING",(0, 0), (-1, -1), 2),
    ]))
    elements.append(firma_table)

    # Pie legal
    elements.append(Spacer(1, 0.8 * cm))
    elements.append(HRFlowable(width="100%", thickness=0.5,
                               color=HexColor("#CCCCCC"), spaceAfter=4))
    elements.append(Paragraph(
        "Municipalidad de Guayaquil — Departamento de Control Financiero y Estadística — "
        "Sistema SIGECO v2.0 — Documento generado electrónicamente",
        small,
    ))

    def _carta_header(canvas, doc):
        _pdf_header(canvas, doc, "NOTIFICACIÓN DE COBRO", f"Nº {notif_num}")

    doc.build(elements, onFirstPage=_carta_header, onLaterPages=_carta_header)
    buf.seek(0)
    fname = f"notificacion_{notif_num}_{datetime.now().strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )


# ── Helper: pipeline de morosidad (copia local para no importar circular) ─────
def _mora_pipeline_stages() -> list:
    stage1 = {"$addFields": {
        "_imp": {"$convert": {"input": {"$ifNull": ["$ValorImpuesto",
                 {"$ifNull": ["$Impuesto", {"$ifNull": ["$MontoImpuesto", 0]}]}]},
                 "to": "double", "onError": 0.0, "onNull": 0.0}},
        "_pag": {"$convert": {"input": {"$ifNull": ["$ValorPagado",
                 {"$ifNull": ["$MontoPagado", 0]}]},
                 "to": "double", "onError": 0.0, "onNull": 0.0}},
    }}
    stage2 = {"$addFields": {
        "_saldo": {"$max": [{"$cond": [
            {"$gt": [{"$ifNull": ["$Saldo", None]}, None]},
            {"$convert": {"input": "$Saldo", "to": "double", "onError": 0.0, "onNull": 0.0}},
            {"$subtract": ["$_imp", "$_pag"]},
        ]}, 0.0]},
        "_hasConvenio": {"$cond": [{"$and": [
            {"$gt": [{"$ifNull": ["$IdDimConvenio", None]}, None]},
            {"$ne": ["$IdDimConvenio", ""]}, {"$ne": ["$IdDimConvenio", 0]},
        ]}, True, False]},
    }}
    stage3 = {"$addFields": {"clasificacionMora": {"$cond": {
        "if": "$_hasConvenio", "then": "COACTIVA",
        "else": {"$switch": {"branches": [
            {"case": {"$lte": ["$_saldo", 0]},    "then": "AL_DIA"},
            {"case": {"$lte": ["$_saldo", 200]},  "then": "MORA_LEVE"},
            {"case": {"$lte": ["$_saldo", 1000]}, "then": "MORA_MEDIA"},
            {"case": {"$lte": ["$_saldo", 5000]}, "then": "MORA_ALTA"},
        ], "default": "MORA_CRITICA"}},
    }}}}
    stage4 = {"$addFields": {
        "prioridadGestion": {"$switch": {"branches": [
            {"case": {"$in": ["$clasificacionMora", ["AL_DIA", "MORA_LEVE"]]}, "then": "BAJA"},
            {"case": {"$in": ["$clasificacionMora", ["MORA_MEDIA"]]},          "then": "MEDIA"},
            {"case": {"$in": ["$clasificacionMora", ["MORA_ALTA"]]},           "then": "ALTA"},
            {"case": {"$in": ["$clasificacionMora", ["MORA_CRITICA","COACTIVA"]]}, "then": "CRITICA"},
        ], "default": "MEDIA"}},
        "diasMora": {"$cond": [{"$lte": ["$_saldo", 0]}, 0,
                     {"$toInt": {"$min": [{"$divide": ["$_saldo", 5]}, 730]}}]},
        "deudaTotal": "$_imp", "deudaVencida": "$_saldo",
    }}
    return [stage1, stage2, stage3, stage4]
