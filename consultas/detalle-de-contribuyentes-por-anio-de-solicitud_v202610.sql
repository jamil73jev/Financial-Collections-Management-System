/*
 * ============================================================================
 * CONSULTA: detalle de contribuyentes por anio de solicitud
 * ----------------------------------------------------------------------------
 * Dashboard / sistema : SIGECO, instancia Patente Municipal (y 1,5 por mil)
 * Página / destino    : DATA_POWERBI_IMPORT
 * Qué responde        : Detalle de contribuyentes por año de solicitud, con correos y teléfonos de gestión consolidados desde varias fuentes. Excluye entidades por lista de RUC y por patrones de nombre de entidades exentas.
 * Bases de origen     : 15PORMIL_DM, PATENTE_DM, CONTACTOS_DM
 * Granularidad        : Una fila por contribuyente y año de solicitud
 * Motor               : SQL Server (data warehouse municipal)
 * Versión             : 2026-10
 * Autor               : Jorge Jamil Espinoza Villa, Analista Financiero
 * Publicación         : versión sanitizada. Sin datos de contribuyentes ni credenciales.
 * Antes de ejecutar: sustituir <RUC_1>..<RUC_8> por la lista de RUC a excluir (se guarda fuera del repositorio).
 * ============================================================================
 */

/* =====================================================================
   SIGECO — DETALLE DE CONTRIBUYENTES POR AÑO SOLICITUD
   SQL SERVER OPTIMIZADO CON TABLAS TEMPORALES E ÍNDICES

   Incluye:
      - IdDimContribuyente
      - CorreoGestion
      - CorreoGestion2
      - TelefonoGestion
      - TelefonoGestion2

   Fuente principal:
      - 15PORMIL_DM.dbo.FactDeclaracion15PorMil
      - PATENTE_DM.dbo.FactDeclaracionPatente

   Fuente contactos adicionales:
      - CONTACTOS_DM.dbo.ContactosContribuyentesConsolidado
   ===================================================================== */

SET NOCOUNT ON;

DECLARE @AnioSolicitud INT = NULL;
DECLARE @FechaActual DATE = CAST(GETDATE() AS DATE);

-- Para un año específico:
-- SET @AnioSolicitud = 2025;


/* =====================================================================
   LIMPIEZA DE TEMPORALES
   ===================================================================== */

IF OBJECT_ID('tempdb..#RucsExcluidos') IS NOT NULL DROP TABLE #RucsExcluidos;
IF OBJECT_ID('tempdb..#Exentos15') IS NOT NULL DROP TABLE #Exentos15;
IF OBJECT_ID('tempdb..#ExentosPatente') IS NOT NULL DROP TABLE #ExentosPatente;
IF OBJECT_ID('tempdb..#ContactosGestion') IS NOT NULL DROP TABLE #ContactosGestion;
IF OBJECT_ID('tempdb..#BaseDetalle') IS NOT NULL DROP TABLE #BaseDetalle;


/* =====================================================================
   1. RUC EXCLUIDOS
   ===================================================================== */

CREATE TABLE #RucsExcluidos (
    Ruc VARCHAR(13) NOT NULL PRIMARY KEY
);

INSERT INTO #RucsExcluidos (Ruc)
VALUES
    ('<RUC_1>'),
    ('<RUC_2>'),
    ('<RUC_3>'),
    ('<RUC_4>'),
    ('<RUC_5>'),
    ('<RUC_6>'),
    ('<RUC_7>'),
    ('<RUC_8>');


/* =====================================================================
   2. CONTACTOS CONSOLIDADOS — CORREO GESTION 2 / TELEFONO GESTION 2
   ===================================================================== */

;WITH ContactosBase AS (
    SELECT
        Identificacion = LTRIM(RTRIM(CAST(cc.Identificacion AS VARCHAR(20)))),

        CorreoRaw = COALESCE(
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_RegCiud_Correo AS VARCHAR(300)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_SRI_Correo AS VARCHAR(300)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_Bomberos_Correo AS VARCHAR(300)))), ''), 'NULL'),

            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_RegCiud_Correo AS VARCHAR(300)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_SRI_Correo AS VARCHAR(300)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_Bomberos_Correo AS VARCHAR(300)))), ''), 'NULL')
        ),

        TelefonoRaw = COALESCE(
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_RegCiud_TlfCelular AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_SRI_TlfCelular AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_Bomberos_TlfCelular AS VARCHAR(100)))), ''), 'NULL'),

            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_RegCiud_TlfDomicilio AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_SRI_TlfDomicilio AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_Bomberos_TlfDomicilio AS VARCHAR(100)))), ''), 'NULL'),

            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_RegCiud_TlfTrabajo AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Juridica_SRI_TlfTrabajo AS VARCHAR(100)))), ''), 'NULL'),

            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_RegCiud_TlfCelular AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_SRI_TlfCelular AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_Bomberos_TlfCelular AS VARCHAR(100)))), ''), 'NULL'),

            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_RegCiud_TlfDomicilio AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_SRI_TlfDomicilio AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_Bomberos_TlfDomicilio AS VARCHAR(100)))), ''), 'NULL'),

            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_RegCiud_TlfTrabajo AS VARCHAR(100)))), ''), 'NULL'),
            NULLIF(NULLIF(LTRIM(RTRIM(CAST(cc.Natural_SRI_TlfTrabajo AS VARCHAR(100)))), ''), 'NULL')
        )

    FROM [CONTACTOS_DM].[dbo].[ContactosContribuyentesConsolidado] AS cc WITH (NOLOCK)
    WHERE cc.Identificacion IS NOT NULL
),
ContactosDepurados AS (
    SELECT
        Identificacion,

        CorreoGestion2 =
            CASE
                WHEN CorreoRaw LIKE '%@%.%' THEN CorreoRaw
                ELSE NULL
            END,

        TelefonoGestion2 =
            CASE
                WHEN TelefonoRaw IN (
                    '0', '00', '000', '0000', '00000', '000000',
                    '0000000', '00000000', '000000000', '0000000000',
                    '9999999999', '-', 'S/N', 'SN', 'NULL'
                )
                    THEN NULL
                ELSE TelefonoRaw
            END
    FROM ContactosBase
    WHERE Identificacion <> ''
)

SELECT
    Identificacion,
    NULLIF(MAX(ISNULL(CorreoGestion2, '')), '') AS CorreoGestion2,
    NULLIF(MAX(ISNULL(TelefonoGestion2, '')), '') AS TelefonoGestion2
INTO #ContactosGestion
FROM ContactosDepurados
WHERE
    CorreoGestion2 IS NOT NULL
    OR TelefonoGestion2 IS NOT NULL
GROUP BY
    Identificacion;

CREATE UNIQUE CLUSTERED INDEX IX_ContactosGestion_Identificacion
ON #ContactosGestion (Identificacion);


/* =====================================================================
   3. CONTRIBUYENTES EXENTOS - 1.5 POR MIL
   ===================================================================== */

SELECT DISTINCT
    c.IdDimContribuyente
INTO #Exentos15
FROM [15PORMIL_DM].[dbo].[DimContribuyente] AS c WITH (NOLOCK)
WHERE
       c.NombreContribuyente LIKE '%IESS%'
    OR c.NombreContribuyente LIKE '%I.E.S.S.%'
    OR c.NombreContribuyente LIKE '%ESPOL%'
    OR c.NombreContribuyente LIKE '%POLITECNICA%'
    OR c.NombreContribuyente LIKE '%POLITÉCNICA%'
    OR c.NombreContribuyente LIKE '%UNIVERSIDAD%'
    OR c.NombreContribuyente LIKE '%UNIDAD EDUCATIVA%'
    OR c.NombreContribuyente LIKE '%ESCUELA%'
    OR c.NombreContribuyente LIKE '%EMPRESA%PUBLICA%'
    OR c.NombreContribuyente LIKE '%EMPRESA%PÚBLICA%'
    OR c.NombreContribuyente LIKE '%SEGURIDAD%SOCIAL%'
    OR c.NombreContribuyente LIKE '%BANECUA%'
    OR c.NombreContribuyente LIKE '%CFN%'
    OR c.NombreContribuyente LIKE '%CORPORACION FINANCIERA NAC%'
    OR c.NombreContribuyente LIKE '%HOSPITAL%DIA%'
    OR c.NombreContribuyente LIKE '%CANCER%'
    OR c.NombreContribuyente LIKE '%SOLCA%'
    OR c.NombreContribuyente LIKE '%BENEFICENCIA%'
    OR c.NombreContribuyente LIKE '%POLICIA%'
    OR c.NombreContribuyente LIKE '%POLICÍA%'
    OR c.NombreContribuyente LIKE '%CONSULADO%'
    OR c.NombreContribuyente LIKE '%EMBAJADA%'
    OR c.NombreContribuyente LIKE '%SECRETARIA%'
    OR c.NombreContribuyente LIKE '%SECRETARÍA%'
    OR c.NombreContribuyente LIKE '%EJERCITO%'
    OR c.NombreContribuyente LIKE '%EJÉRCITO%'
    OR c.NombreContribuyente LIKE '%ARMADA%'
    OR c.NombreContribuyente LIKE 'IGLESIA %'
    OR c.NombreContribuyente LIKE '%EMELEC%'
    OR c.NombreContribuyente LIKE '%FUNDACI%'
    OR c.NombreContribuyente LIKE '%RENTAS INTERNAS%'
    OR c.NombreContribuyente LIKE '%PROCURADURIA%'
    OR c.NombreContribuyente LIKE '%FISCALIA%'
    OR c.NombreContribuyente LIKE '%FISCALÍA%'
    OR c.NombreContribuyente LIKE '%CONTRALORIA%'
    OR c.NombreContribuyente LIKE '%FIDEICOM%'
    OR c.NombreContribuyente LIKE '%DIRECCION%'
    OR c.NombreContribuyente LIKE '%MINISTERIO%'
    OR c.NombreContribuyente LIKE '%MUNICI%'
    OR c.NombreContribuyente LIKE '%GOBIERNO%'
    OR c.NombreContribuyente LIKE '%ESTADO%'
    OR c.NombreContribuyente LIKE '%ASOC%'
    OR c.NombreContribuyente LIKE '%CONGREG%'
    OR c.NombreContribuyente LIKE '%EVANG%'
    OR c.NombreContribuyente LIKE '%ARQUID%'
    OR c.NombreContribuyente LIKE '%SINDIC%'
    OR c.NombreContribuyente LIKE '%BARCELONA S.C.%'
    OR c.NombreContribuyente LIKE '%ZONAL%'
    OR c.NombreContribuyente LIKE '%CONSULAR%'
    OR c.NombreContribuyente LIKE '%DIPLOMATICO%'
    OR c.NombreContribuyente LIKE '%DIPLOMÁTICO%';

CREATE UNIQUE CLUSTERED INDEX IX_Exentos15_IdDimContribuyente
ON #Exentos15 (IdDimContribuyente);


/* =====================================================================
   4. CONTRIBUYENTES EXENTOS - PATENTE MUNICIPAL
   ===================================================================== */

SELECT DISTINCT
    c.IdDimContribuyente
INTO #ExentosPatente
FROM [PATENTE_DM].[dbo].[DimContribuyente] AS c WITH (NOLOCK)
WHERE
       c.NombreContribuyente LIKE '%IESS%'
    OR c.NombreContribuyente LIKE '%I.E.S.S.%'
    OR c.NombreContribuyente LIKE '%ESPOL%'
    OR c.NombreContribuyente LIKE '%POLITECNICA%'
    OR c.NombreContribuyente LIKE '%POLITÉCNICA%'
    OR c.NombreContribuyente LIKE '%UNIVERSIDAD%'
    OR c.NombreContribuyente LIKE '%UNIDAD EDUCATIVA%'
    OR c.NombreContribuyente LIKE '%ESCUELA%'
    OR c.NombreContribuyente LIKE '%EMPRESA%PUBLICA%'
    OR c.NombreContribuyente LIKE '%EMPRESA%PÚBLICA%'
    OR c.NombreContribuyente LIKE '%SEGURIDAD%SOCIAL%'
    OR c.NombreContribuyente LIKE '%BANECUA%'
    OR c.NombreContribuyente LIKE '%CFN%'
    OR c.NombreContribuyente LIKE '%CORPORACION FINANCIERA NAC%'
    OR c.NombreContribuyente LIKE '%HOSPITAL%DIA%'
    OR c.NombreContribuyente LIKE '%CANCER%'
    OR c.NombreContribuyente LIKE '%SOLCA%'
    OR c.NombreContribuyente LIKE '%BENEFICENCIA%'
    OR c.NombreContribuyente LIKE '%POLICIA%'
    OR c.NombreContribuyente LIKE '%POLICÍA%'
    OR c.NombreContribuyente LIKE '%CONSULADO%'
    OR c.NombreContribuyente LIKE '%EMBAJADA%'
    OR c.NombreContribuyente LIKE '%SECRETARIA%'
    OR c.NombreContribuyente LIKE '%SECRETARÍA%'
    OR c.NombreContribuyente LIKE '%EJERCITO%'
    OR c.NombreContribuyente LIKE '%EJÉRCITO%'
    OR c.NombreContribuyente LIKE '%ARMADA%'
    OR c.NombreContribuyente LIKE 'IGLESIA %'
    OR c.NombreContribuyente LIKE '%EMELEC%'
    OR c.NombreContribuyente LIKE '%FUNDACI%'
    OR c.NombreContribuyente LIKE '%RENTAS INTERNAS%'
    OR c.NombreContribuyente LIKE '%PROCURADURIA%'
    OR c.NombreContribuyente LIKE '%FISCALIA%'
    OR c.NombreContribuyente LIKE '%FISCALÍA%'
    OR c.NombreContribuyente LIKE '%CONTRALORIA%'
    OR c.NombreContribuyente LIKE '%FIDEICOM%'
    OR c.NombreContribuyente LIKE '%DIRECCION%'
    OR c.NombreContribuyente LIKE '%MINISTERIO%'
    OR c.NombreContribuyente LIKE '%MUNICI%'
    OR c.NombreContribuyente LIKE '%GOBIERNO%'
    OR c.NombreContribuyente LIKE '%ESTADO%'
    OR c.NombreContribuyente LIKE '%ASOC%'
    OR c.NombreContribuyente LIKE '%CONGREG%'
    OR c.NombreContribuyente LIKE '%EVANG%'
    OR c.NombreContribuyente LIKE '%ARQUID%'
    OR c.NombreContribuyente LIKE '%SINDIC%'
    OR c.NombreContribuyente LIKE '%BARCELONA S.C.%'
    OR c.NombreContribuyente LIKE '%ZONAL%'
    OR c.NombreContribuyente LIKE '%CONSULAR%'
    OR c.NombreContribuyente LIKE '%DIPLOMATICO%'
    OR c.NombreContribuyente LIKE '%DIPLOMÁTICO%';

CREATE UNIQUE CLUSTERED INDEX IX_ExentosPatente_IdDimContribuyente
ON #ExentosPatente (IdDimContribuyente);


/* =====================================================================
   5. TABLA TEMPORAL DE RESULTADO BASE
   ===================================================================== */

CREATE TABLE #BaseDetalle (
    AnioSolicitud INT NOT NULL,
    Impuesto VARCHAR(30) NOT NULL,
    EstadoCartera VARCHAR(30) NOT NULL,

    IdDimContribuyente BIGINT NOT NULL,
    Ruc VARCHAR(13) NOT NULL,
    NombreContribuyente VARCHAR(300) NULL,
    TipoPersona VARCHAR(100) NULL,

    CorreoGestion VARCHAR(300) NULL,
    CorreoGestion2 VARCHAR(300) NULL,
    TelefonoGestion VARCHAR(100) NULL,
    TelefonoGestion2 VARCHAR(100) NULL,

    RepresentanteLegal VARCHAR(300) NULL,

    ValorImpuesto DECIMAL(18,2) NOT NULL,
    ValorInteres DECIMAL(18,2) NOT NULL,
    ValorMulta DECIMAL(18,2) NOT NULL,
    ValorRecargo DECIMAL(18,2) NOT NULL,
    ValorPendiente DECIMAL(18,2) NOT NULL
);


/* =====================================================================
   6. CARGA AGRUPADA — 1.5 POR MIL
   ===================================================================== */

INSERT INTO #BaseDetalle (
    AnioSolicitud,
    Impuesto,
    EstadoCartera,
    IdDimContribuyente,
    Ruc,
    NombreContribuyente,
    TipoPersona,
    CorreoGestion,
    CorreoGestion2,
    TelefonoGestion,
    TelefonoGestion2,
    RepresentanteLegal,
    ValorImpuesto,
    ValorInteres,
    ValorMulta,
    ValorRecargo,
    ValorPendiente
)
SELECT
    f.AnioSolicitud,
    '1.5 POR MIL' AS Impuesto,

    CASE
        WHEN ed.CodEstadoDeclaracion = 'SGP'
            THEN 'PRESUNTIVA'
        WHEN f.FechaExigibilidad >= @FechaActual
            THEN 'DEUDA POR VENCER'
        ELSE 'VENCIDA'
    END AS EstadoCartera,

    c.IdDimContribuyente,
    c.Ruc,
    c.NombreContribuyente,
    c.TipoPersona,

    CAST(c.CorreoEMAS AS VARCHAR(300)) AS CorreoGestion,

    COALESCE(cgRuc.CorreoGestion2, cgCed.CorreoGestion2) AS CorreoGestion2,

    CAST(
        COALESCE(
            NULLIF(LTRIM(RTRIM(c.TelefonoEMAS)), ''),
            NULLIF(LTRIM(RTRIM(c.Telefono)), '')
        ) AS VARCHAR(100)
    ) AS TelefonoGestion,

    COALESCE(cgRuc.TelefonoGestion2, cgCed.TelefonoGestion2) AS TelefonoGestion2,

    CAST(
        COALESCE(
            NULLIF(LTRIM(RTRIM(c.RepresentanteLegal)), ''),
            c.NombreContribuyente
        ) AS VARCHAR(300)
    ) AS RepresentanteLegal,

    CAST(SUM(
        CASE
            WHEN ed.CodEstadoDeclaracion = 'SGP'
                THEN ISNULL(f.ValorImpuestoCalculadoSRI, 0)
            ELSE ISNULL(f.ValorImpuesto, 0)
        END
    ) AS DECIMAL(18,2)) AS ValorImpuesto,

    CAST(SUM(ISNULL(f.ValorInteres, 0)) AS DECIMAL(18,2)) AS ValorInteres,
    CAST(SUM(ISNULL(f.ValorMulta, 0)) AS DECIMAL(18,2)) AS ValorMulta,
    CAST(SUM(ISNULL(f.ValorRecargo, 0)) AS DECIMAL(18,2)) AS ValorRecargo,

    CAST(SUM(
        CASE
            WHEN ed.CodEstadoDeclaracion = 'SGP'
                THEN ISNULL(f.ValorImpuestoCalculadoSRI, 0)
            WHEN ISNULL(f.ValorPagar, 0) - ISNULL(f.ValorComprobantePago, 0) < 0
                THEN 0
            ELSE ISNULL(f.ValorPagar, 0) - ISNULL(f.ValorComprobantePago, 0)
        END
    ) AS DECIMAL(18,2)) AS ValorPendiente

FROM [15PORMIL_DM].[dbo].[FactDeclaracion15PorMil] AS f WITH (NOLOCK)

INNER JOIN [15PORMIL_DM].[dbo].[DimContribuyente] AS c WITH (NOLOCK)
    ON c.IdDimContribuyente = f.IdDimContribuyente

LEFT JOIN #ContactosGestion AS cgRuc
    ON cgRuc.Identificacion = c.Ruc

LEFT JOIN #ContactosGestion AS cgCed
    ON cgCed.Identificacion = LEFT(c.Ruc, 10)

INNER JOIN [15PORMIL_DM].[dbo].[DimEstadoDeclaracion] AS ed WITH (NOLOCK)
    ON ed.IdDimEstadoDeclaracion = f.IdDimEstadoDeclaracion

WHERE
    ed.CodEstadoDeclaracion IN ('SGP', 'SAA', 'SAJ', 'SAX')
    AND f.AnioSolicitud >= 2020
    AND (@AnioSolicitud IS NULL OR f.AnioSolicitud = @AnioSolicitud)
    AND LEN(c.Ruc) = 13
    AND SUBSTRING(c.Ruc, 3, 1) <> '6'
    AND NOT EXISTS (
        SELECT 1
        FROM #Exentos15 AS ex
        WHERE ex.IdDimContribuyente = c.IdDimContribuyente
    )
    AND NOT EXISTS (
        SELECT 1
        FROM #RucsExcluidos AS rx
        WHERE rx.Ruc = c.Ruc
    )

GROUP BY
    f.AnioSolicitud,
    CASE
        WHEN ed.CodEstadoDeclaracion = 'SGP'
            THEN 'PRESUNTIVA'
        WHEN f.FechaExigibilidad >= @FechaActual
            THEN 'DEUDA POR VENCER'
        ELSE 'VENCIDA'
    END,
    c.IdDimContribuyente,
    c.Ruc,
    c.NombreContribuyente,
    c.TipoPersona,
    CAST(c.CorreoEMAS AS VARCHAR(300)),
    COALESCE(cgRuc.CorreoGestion2, cgCed.CorreoGestion2),
    CAST(
        COALESCE(
            NULLIF(LTRIM(RTRIM(c.TelefonoEMAS)), ''),
            NULLIF(LTRIM(RTRIM(c.Telefono)), '')
        ) AS VARCHAR(100)
    ),
    COALESCE(cgRuc.TelefonoGestion2, cgCed.TelefonoGestion2),
    CAST(
        COALESCE(
            NULLIF(LTRIM(RTRIM(c.RepresentanteLegal)), ''),
            c.NombreContribuyente
        ) AS VARCHAR(300)
    )
OPTION (RECOMPILE);


/* =====================================================================
   7. CARGA AGRUPADA — PATENTE MUNICIPAL
   ===================================================================== */

INSERT INTO #BaseDetalle (
    AnioSolicitud,
    Impuesto,
    EstadoCartera,
    IdDimContribuyente,
    Ruc,
    NombreContribuyente,
    TipoPersona,
    CorreoGestion,
    CorreoGestion2,
    TelefonoGestion,
    TelefonoGestion2,
    RepresentanteLegal,
    ValorImpuesto,
    ValorInteres,
    ValorMulta,
    ValorRecargo,
    ValorPendiente
)
SELECT
    f.AnioSolicitud,
    'PATENTE MUNICIPAL' AS Impuesto,

    CASE
        WHEN ed.CodEstadoDeclaracion = 'SGP'
            THEN 'PRESUNTIVA'
        WHEN f.FechaExigibilidad >= @FechaActual
            THEN 'DEUDA POR VENCER'
        ELSE 'VENCIDA'
    END AS EstadoCartera,

    c.IdDimContribuyente,
    c.Ruc,
    c.NombreContribuyente,
    c.TipoPersona,

    CAST(c.CorreoElectronico AS VARCHAR(300)) AS CorreoGestion,

    COALESCE(cgRuc.CorreoGestion2, cgCed.CorreoGestion2) AS CorreoGestion2,

    CAST(c.Telefono AS VARCHAR(100)) AS TelefonoGestion,

    COALESCE(cgRuc.TelefonoGestion2, cgCed.TelefonoGestion2) AS TelefonoGestion2,

    CAST(c.NombreContribuyente AS VARCHAR(300)) AS RepresentanteLegal,

    CAST(SUM(
        CASE
            WHEN ed.CodEstadoDeclaracion = 'SGP'
                THEN ISNULL(f.ValorImpuestoCalculadoSRI, 0)
            ELSE ISNULL(f.ValorImpuesto, 0)
        END
    ) AS DECIMAL(18,2)) AS ValorImpuesto,

    CAST(SUM(ISNULL(f.ValorInteres, 0)) AS DECIMAL(18,2)) AS ValorInteres,
    CAST(SUM(ISNULL(f.ValorMulta, 0)) AS DECIMAL(18,2)) AS ValorMulta,
    CAST(SUM(ISNULL(f.ValorRecargo, 0)) AS DECIMAL(18,2)) AS ValorRecargo,

    CAST(SUM(
        CASE
            WHEN ed.CodEstadoDeclaracion = 'SGP'
                THEN ISNULL(f.ValorImpuestoCalculadoSRI, 0)
            WHEN ISNULL(f.ValorPagar, 0) - ISNULL(f.ValorComprobantePago, 0) < 0
                THEN 0
            ELSE ISNULL(f.ValorPagar, 0) - ISNULL(f.ValorComprobantePago, 0)
        END
    ) AS DECIMAL(18,2)) AS ValorPendiente

FROM [PATENTE_DM].[dbo].[FactDeclaracionPatente] AS f WITH (NOLOCK)

INNER JOIN [PATENTE_DM].[dbo].[DimContribuyente] AS c WITH (NOLOCK)
    ON c.IdDimContribuyente = f.IdDimContribuyente

LEFT JOIN #ContactosGestion AS cgRuc
    ON cgRuc.Identificacion = c.Ruc

LEFT JOIN #ContactosGestion AS cgCed
    ON cgCed.Identificacion = LEFT(c.Ruc, 10)

INNER JOIN [PATENTE_DM].[dbo].[DimEstadoDeclaracion] AS ed WITH (NOLOCK)
    ON ed.IdDimEstadoDeclaracion = f.IdDimEstadoDeclaracion

WHERE
    ed.CodEstadoDeclaracion IN ('SGP', 'SAA', 'SAJ', 'SAX')
    AND ISNULL(f.ExcluidaSN, 'NO') = 'NO'
    AND f.AnioSolicitud >= 2020
    AND (@AnioSolicitud IS NULL OR f.AnioSolicitud = @AnioSolicitud)
    AND LEN(c.Ruc) = 13
    AND SUBSTRING(c.Ruc, 3, 1) <> '6'
    AND NOT EXISTS (
        SELECT 1
        FROM #ExentosPatente AS ex
        WHERE ex.IdDimContribuyente = c.IdDimContribuyente
    )
    AND NOT EXISTS (
        SELECT 1
        FROM #RucsExcluidos AS rx
        WHERE rx.Ruc = c.Ruc
    )

GROUP BY
    f.AnioSolicitud,
    CASE
        WHEN ed.CodEstadoDeclaracion = 'SGP'
            THEN 'PRESUNTIVA'
        WHEN f.FechaExigibilidad >= @FechaActual
            THEN 'DEUDA POR VENCER'
        ELSE 'VENCIDA'
    END,
    c.IdDimContribuyente,
    c.Ruc,
    c.NombreContribuyente,
    c.TipoPersona,
    CAST(c.CorreoElectronico AS VARCHAR(300)),
    COALESCE(cgRuc.CorreoGestion2, cgCed.CorreoGestion2),
    CAST(c.Telefono AS VARCHAR(100)),
    COALESCE(cgRuc.TelefonoGestion2, cgCed.TelefonoGestion2),
    CAST(c.NombreContribuyente AS VARCHAR(300))
OPTION (RECOMPILE);


/* =====================================================================
   8. ÍNDICE SOBRE LA BASE CONSOLIDADA
   ===================================================================== */

CREATE CLUSTERED INDEX IX_BaseDetalle_Agrupacion
ON #BaseDetalle (
    AnioSolicitud,
    Impuesto,
    EstadoCartera,
    IdDimContribuyente,
    Ruc
);


/* =====================================================================
   9. RESULTADO FINAL
   ===================================================================== */

SELECT
    BD.AnioSolicitud,
    BD.Impuesto,
    BD.EstadoCartera,
    BD.IdDimContribuyente,
    BD.Ruc,
    BD.NombreContribuyente,
    BD.TipoPersona,

    BD.CorreoGestion,
    BD.CorreoGestion2,
    BD.TelefonoGestion,
    BD.TelefonoGestion2,

    BD.RepresentanteLegal,

    CAST(SUM(BD.ValorImpuesto) AS DECIMAL(18,2)) AS ValorImpuesto,
    CAST(SUM(BD.ValorInteres) AS DECIMAL(18,2)) AS ValorInteres,
    CAST(SUM(BD.ValorMulta) AS DECIMAL(18,2)) AS ValorMulta,
    CAST(SUM(BD.ValorRecargo) AS DECIMAL(18,2)) AS ValorRecargo,
    CAST(SUM(BD.ValorPendiente) AS DECIMAL(18,2)) AS ValorPendiente

FROM #BaseDetalle AS BD

GROUP BY
    BD.AnioSolicitud,
    BD.Impuesto,
    BD.EstadoCartera,
    BD.IdDimContribuyente,
    BD.Ruc,
    BD.NombreContribuyente,
    BD.TipoPersona,
    BD.CorreoGestion,
    BD.CorreoGestion2,
    BD.TelefonoGestion,
    BD.TelefonoGestion2,
    BD.RepresentanteLegal

ORDER BY
    BD.AnioSolicitud DESC,
    BD.Impuesto,
    BD.EstadoCartera,
    ValorPendiente DESC,
    BD.NombreContribuyente;
