/*
 * ============================================================================
 * CONSULTA: pagos y reversos patente y 1 5 por mil
 * ----------------------------------------------------------------------------
 * Dashboard / sistema : SIGECO, instancia Patente Municipal (y 1,5 por mil)
 * Página / destino    : DATA_POWERBI_IMPORT_PAGOS
 * Qué responde        : Pagos y reversos de patente municipal y del 1,5 por mil: impuesto principal, interés, multa, recargo, coactiva, convenios y valor pagado neto. El valor de convenio es informativo y no se suma otra vez al total pagado.
 * Bases de origen     : RECAUDACION_DM (cobros y ConveniosPago), 15PORMIL_DM
 * Granularidad        : Una fila por pago o reverso
 * Motor               : SQL Server (data warehouse municipal)
 * Versión             : 2026-10
 * Autor               : Jorge Jamil Espinoza Villa, Analista Financiero
 * Publicación         : versión sanitizada. Sin datos de contribuyentes ni credenciales.
 * ============================================================================
 */

/* ============================================================
   PAGOS Y REVERSOS OPTIMIZADO PARA POWER BI
   PATENTE MUNICIPAL Y 1.5 POR MIL

   INCLUYE:
       - ValorImpuestoPrincipal
       - ValorInteres
       - ValorMulta
       - ValorRecargo
       - ValorPagadoTotal
       - ValorPagoConvenio
       - ValorCoactiva
       - ValorPagoBruto
       - ValorReverso
       - ValorPagadoNeto

   COACTIVA:
       1. Desglose directo:
          COA / 1 = 10% HONORARIOS JUICIOS

       2. Convenios:
          FactTablaAmortizacion.AbonoCoactivaDeuda

   CONVENIOS:
       FactCobro.IdCobro = FactTablaAmortizacion.Cuic
       ValorPagoConvenio = FactTablaAmortizacion.TotalPagar

   IMPORTANTE:
       ValorPagoConvenio es informativo y no se suma otra vez
       a ValorPagadoTotal para evitar duplicidad.
   ============================================================ */

SET NOCOUNT ON;

DECLARE @AnioPago INT = 2026;

DECLARE @FechaInicio DATE =
    DATEFROMPARTS(@AnioPago, 1, 1);

DECLARE @FechaFin DATE =
    DATEFROMPARTS(@AnioPago + 1, 1, 1);


/* ============================================================
   ELIMINAR TABLAS TEMPORALES
   ============================================================ */

DROP TABLE IF EXISTS #PagosConvenio;
DROP TABLE IF EXISTS #ClavesConvenio;
DROP TABLE IF EXISTS #Obs15;
DROP TABLE IF EXISTS #ClavesObs15;
DROP TABLE IF EXISTS #Base;


/* ============================================================
   1. BASE FILTRADA DE PAGOS Y REVERSOS
   ============================================================ */

SELECT
    CIC =
        CAST(fc.IdCobro AS VARCHAR(50)),

    CICNumerico =
        TRY_CONVERT(BIGINT, fc.IdCobro),

    IdFactCobro =
        v.IdFactCobro,

    IdLiquidacion =
        fc.IdLiquidacion,

    IdContribuyentePago =
        v.IdDimContribuyente,

    Ruc =
        LTRIM(
            RTRIM(
                CAST(dc.CedulaRuc AS VARCHAR(13))
            )
        ),

    NombreContribuyente =
        CAST(
            dc.NombreContribuyente AS VARCHAR(300)
        ),

    AnioPago =
        YEAR(v.FechaCobro),

    FechaCobro =
        v.FechaCobro,

    Estado =
        CAST(v.Estado AS VARCHAR(50)),

    ValorAbs =
        CAST(
            ABS(ISNULL(v.Valor, 0))
            AS DECIMAL(19,4)
        ),

    Impuesto =
        tx.ImpuestoClasificado,

    CategoriaComponente =
        categoria.CategoriaComponente,

    CodigoDesglose =
        normalizado.CodigoDesglose,

    SubCodigoDesglose =
        normalizado.SubCodigoDesglose,

    EsGuayaquil =
        CASE
            WHEN normalizado.TipoDesglose LIKE '01%'
                THEN 1

            WHEN normalizado.TextoSubTransaccion
                 LIKE '%GUAYAQUIL%'
                THEN 1

            WHEN normalizado.TextoDetalle
                 LIKE '%GUAYAQUIL%'
                THEN 1

            ELSE 0
        END,

    ConceptoRecibo =
        CAST(
            fc.ConceptoRecibo AS VARCHAR(1000)
        ),

    TransaccionPrincipal =
        CAST(
            dt.Transaccion AS VARCHAR(300)
        ),

    SubTransaccionPrincipal =
        CAST(
            dt.SubTransaccion AS VARCHAR(300)
        ),

    DetallePrincipal =
        CAST(
            dt.Detalle AS VARCHAR(300)
        ),

    FechaReverso =
        fc.FechaReverso,

    MotivoReverso =
        CAST(
            fc.MotivoReverso AS VARCHAR(500)
        ),

    CanalPago =
        CAST(
            cp.CanalDePago AS VARCHAR(100)
        ),

    Banco =
        CAST(
            b.Banco AS VARCHAR(200)
        )

INTO #Base

FROM [RECAUDACION_DM].[DesgloseCobros].[vCobros_ConDesglose] AS v
WITH (NOLOCK)

INNER JOIN [RECAUDACION_DM].[DesgloseCobros].[FactCobro] AS fc
WITH (NOLOCK)
    ON fc.IdFactCobro = v.IdFactCobro

INNER JOIN [RECAUDACION_DM].[DesgloseCobros].[DimContribuyente] AS dc
WITH (NOLOCK)
    ON dc.IdDimContribuyente = v.IdDimContribuyente

INNER JOIN [RECAUDACION_DM].[DesgloseCobros].[DimTransaccion] AS dt
WITH (NOLOCK)
    ON dt.IdDimTransaccion = v.IdDimTransaccion

INNER JOIN [RECAUDACION_DM].[DesgloseCobros].[DimTransaccionDesglose] AS dtd
WITH (NOLOCK)
    ON dtd.IdDimTransaccionDesglose =
       v.IdDimTransaccionDesglose

LEFT JOIN [RECAUDACION_DM].[DesgloseCobros].[DimCanalDePago] AS cp
WITH (NOLOCK)
    ON cp.IdDimCanalDePago = v.IdDimCanalDePago

LEFT JOIN [RECAUDACION_DM].[DesgloseCobros].[DimBanco] AS b
WITH (NOLOCK)
    ON b.IdDimBanco = v.IdDimBanco


/* ============================================================
   NORMALIZACIÓN
   ============================================================ */

CROSS APPLY (
    SELECT
        CodigoPrincipal =
            UPPER(
                LTRIM(
                    RTRIM(
                        CAST(
                            dt.CodTransaccion AS VARCHAR(50)
                        )
                    )
                )
            ),

        SubCodigoPrincipal =
            TRY_CONVERT(
                INT,
                dt.CodSubTransaccion
            ),

        CodigoDesglose =
            UPPER(
                LTRIM(
                    RTRIM(
                        CAST(
                            dtd.CodTransaccion AS VARCHAR(50)
                        )
                    )
                )
            ),

        SubCodigoDesglose =
            TRY_CONVERT(
                INT,
                dtd.CodSubTransaccion
            ),

        TipoDesglose =
            UPPER(
                ISNULL(
                    CAST(dtd.Tipo AS VARCHAR(300)),
                    ''
                )
            ),

        TextoSubTransaccion =
            UPPER(
                ISNULL(
                    CAST(
                        dtd.SubTransaccion AS VARCHAR(1000)
                    ),
                    ''
                )
            ),

        TextoDetalle =
            UPPER(
                ISNULL(
                    CAST(
                        dtd.Detalle AS VARCHAR(1000)
                    ),
                    ''
                )
            )
) AS normalizado


/* ============================================================
   CLASIFICACIÓN DEL IMPUESTO
   ============================================================ */

CROSS APPLY (
    SELECT
        ImpuestoClasificado =
            CASE
                /* PATENTE MUNICIPAL */

                WHEN normalizado.CodigoPrincipal = 'PAT'
                    THEN 'PATENTE MUNICIPAL'

                WHEN normalizado.CodigoPrincipal = 'TIT'
                 AND normalizado.SubCodigoPrincipal = 33
                    THEN 'PATENTE MUNICIPAL'

                WHEN normalizado.CodigoPrincipal = 'CIP'
                 AND normalizado.SubCodigoPrincipal = 51
                    THEN 'PATENTE MUNICIPAL'

                WHEN normalizado.CodigoPrincipal = 'PDP'
                 AND normalizado.SubCodigoPrincipal = 32
                    THEN 'PATENTE MUNICIPAL'


                /* 1.5 POR MIL */

                WHEN normalizado.CodigoPrincipal = 'MIL'
                    THEN '1.5 POR MIL'

                WHEN normalizado.CodigoPrincipal = 'TIT'
                 AND normalizado.SubCodigoPrincipal = 32
                    THEN '1.5 POR MIL'

                WHEN normalizado.CodigoPrincipal = 'CIP'
                 AND normalizado.SubCodigoPrincipal = 43
                    THEN '1.5 POR MIL'

                WHEN normalizado.CodigoPrincipal = 'PDP'
                 AND normalizado.SubCodigoPrincipal = 5
                    THEN '1.5 POR MIL'

                ELSE NULL
            END
) AS tx


/* ============================================================
   COMPONENTE PRINCIPAL DEL IMPUESTO
   ============================================================ */

CROSS APPLY (
    SELECT
        EsComponenteImpuesto =
            CASE
                /* PATENTE MUNICIPAL */

                WHEN tx.ImpuestoClasificado =
                     'PATENTE MUNICIPAL'
                 AND normalizado.CodigoDesglose = 'PAT'
                    THEN 1

                WHEN tx.ImpuestoClasificado =
                     'PATENTE MUNICIPAL'
                 AND normalizado.CodigoDesglose = 'TIT'
                 AND normalizado.SubCodigoDesglose = 33
                    THEN 1

                WHEN tx.ImpuestoClasificado =
                     'PATENTE MUNICIPAL'
                 AND normalizado.CodigoDesglose = 'CIP'
                 AND normalizado.SubCodigoDesglose = 51
                    THEN 1

                WHEN tx.ImpuestoClasificado =
                     'PATENTE MUNICIPAL'
                 AND normalizado.CodigoDesglose = 'PDP'
                 AND normalizado.SubCodigoDesglose = 32
                    THEN 1


                /* 1.5 POR MIL */

                WHEN tx.ImpuestoClasificado =
                     '1.5 POR MIL'
                 AND normalizado.CodigoDesglose = 'MIL'
                    THEN 1

                WHEN tx.ImpuestoClasificado =
                     '1.5 POR MIL'
                 AND normalizado.CodigoDesglose = 'TIT'
                 AND normalizado.SubCodigoDesglose = 32
                    THEN 1

                WHEN tx.ImpuestoClasificado =
                     '1.5 POR MIL'
                 AND normalizado.CodigoDesglose = 'CIP'
                 AND normalizado.SubCodigoDesglose = 43
                    THEN 1

                WHEN tx.ImpuestoClasificado =
                     '1.5 POR MIL'
                 AND normalizado.CodigoDesglose = 'PDP'
                 AND normalizado.SubCodigoDesglose = 5
                    THEN 1

                ELSE 0
            END
) AS componente


/* ============================================================
   CLASIFICACIÓN EXCLUYENTE DEL COMPONENTE

   EL ORDEN ES IMPORTANTE:
       1. COACTIVA
       2. INTERÉS
       3. RECARGO
       4. MULTA
       5. IMPUESTO PRINCIPAL
       6. OTRO
   ============================================================ */

CROSS APPLY (
    SELECT
        CategoriaComponente =
            CASE
                /* ============================================
                   COACTIVA / HONORARIOS DE JUICIOS

                   CÓDIGO VALIDADO:
                       COA / 1
                       10% HONORARIOS JUICIOS
                   ============================================ */

                WHEN normalizado.CodigoDesglose = 'COA'
                 AND normalizado.SubCodigoDesglose = 1
                    THEN 'COACTIVA'

                WHEN normalizado.CodigoDesglose = 'COA'
                    THEN 'COACTIVA'

                WHEN normalizado.TextoSubTransaccion
                     LIKE '%HONORARIOS JUICIOS%'
                    THEN 'COACTIVA'

                WHEN normalizado.TextoSubTransaccion
                     LIKE '%HONORARIO%JUICIO%'
                    THEN 'COACTIVA'

                WHEN normalizado.TextoSubTransaccion
                     LIKE '%COACTIV%'
                    THEN 'COACTIVA'

                WHEN normalizado.TextoDetalle
                     LIKE '%COACTIV%'
                    THEN 'COACTIVA'


                /* ============================================
                   INTERÉS
                   ============================================ */

                WHEN normalizado.CodigoDesglose = 'INT'
                    THEN 'INTERES'

                WHEN normalizado.TextoSubTransaccion
                     LIKE '%INTERES%'
                    THEN 'INTERES'

                WHEN normalizado.TextoDetalle
                     LIKE '%INTERES%'
                    THEN 'INTERES'

                WHEN normalizado.TextoSubTransaccion
                     LIKE '%MORA%'
                    THEN 'INTERES'


                /* ============================================
                   RECARGO
                   ============================================ */

                WHEN normalizado.CodigoDesglose = 'REC'
                    THEN 'RECARGO'

                WHEN normalizado.TextoSubTransaccion
                     LIKE '%RECARGO%'
                    THEN 'RECARGO'

                WHEN normalizado.TextoDetalle
                     LIKE '%RECARGO%'
                    THEN 'RECARGO'


                /* ============================================
                   MULTA
                   ============================================ */

                WHEN normalizado.CodigoDesglose IN (
                        'MUL',
                        'MLT'
                     )
                    THEN 'MULTA'

                WHEN normalizado.TextoSubTransaccion
                     LIKE '%MULTA%'
                    THEN 'MULTA'

                WHEN normalizado.TextoDetalle
                     LIKE '%MULTA%'
                    THEN 'MULTA'


                /* ============================================
                   IMPUESTO PRINCIPAL
                   ============================================ */

                WHEN componente.EsComponenteImpuesto = 1
                    THEN 'IMPUESTO PRINCIPAL'

                ELSE 'OTRO'
            END
) AS categoria


/* ============================================================
   FILTROS TEMPRANOS
   ============================================================ */

WHERE
    v.FechaCobro >= @FechaInicio
    AND v.FechaCobro < @FechaFin

    AND v.Estado IN (
        'Pago',
        'Reverso'
    )

    AND ISNULL(v.Valor, 0) <> 0

    AND (
           normalizado.CodigoPrincipal IN (
               'PAT',
               'MIL'
           )

        OR (
            normalizado.CodigoPrincipal = 'TIT'
            AND normalizado.SubCodigoPrincipal IN (32, 33)
        )

        OR (
            normalizado.CodigoPrincipal = 'CIP'
            AND normalizado.SubCodigoPrincipal IN (43, 51)
        )

        OR (
            normalizado.CodigoPrincipal = 'PDP'
            AND normalizado.SubCodigoPrincipal IN (5, 32)
        )
    )

    AND tx.ImpuestoClasificado IS NOT NULL

OPTION (RECOMPILE);


/* ============================================================
   ÍNDICES DE LA BASE TEMPORAL
   ============================================================ */

CREATE CLUSTERED INDEX IX_Base_Agrupacion
    ON #Base (
        IdFactCobro,
        Impuesto,
        CIC
    );

CREATE NONCLUSTERED INDEX IX_Base_CIC_Ruc
    ON #Base (
        CICNumerico,
        Ruc
    )
    INCLUDE (
        IdFactCobro,
        Impuesto,
        Estado,
        ValorAbs,
        CategoriaComponente,
        EsGuayaquil
    );


/* ============================================================
   2. CLAVES DE 1.5 POR MIL
   ============================================================ */

SELECT DISTINCT
    CIC =
        CICNumerico,

    Ruc

INTO #ClavesObs15

FROM #Base

WHERE
    Impuesto = '1.5 POR MIL'
    AND CICNumerico IS NOT NULL;


CREATE UNIQUE CLUSTERED INDEX IX_ClavesObs15
    ON #ClavesObs15 (
        CIC,
        Ruc
    );


/* ============================================================
   OBSERVACIONES REALES DE 1.5 POR MIL
   ============================================================ */

SELECT
    CIC =
        convertido.CIC,

    Ruc =
        contribuyente.Ruc,

    Observacion15 =
        MAX(
            NULLIF(
                LTRIM(
                    RTRIM(
                        CAST(
                            d15.Observacion AS VARCHAR(1000)
                        )
                    )
                ),
                ''
            )
        ),

    ValorComprobantePago15 =
        CAST(
            SUM(
                ISNULL(
                    d15.ValorComprobantePago,
                    0
                )
            )
            AS DECIMAL(18,2)
        ),

    FechaPago15PorMil =
        MAX(d15.FechaPago15PorMil)

INTO #Obs15

FROM [15PORMIL_DM].[dbo].[FactDeclaracion15PorMil] AS d15
WITH (NOLOCK)

INNER JOIN [15PORMIL_DM].[dbo].[DimContribuyente] AS c15
WITH (NOLOCK)
    ON c15.IdDimContribuyente =
       d15.IdDimContribuyente

CROSS APPLY (
    SELECT
        CIC =
            TRY_CONVERT(
                BIGINT,
                d15.ComprobantePago15PorMil
            )
) AS convertido

CROSS APPLY (
    SELECT
        Ruc =
            LTRIM(
                RTRIM(
                    CAST(c15.Ruc AS VARCHAR(13))
                )
            )
) AS contribuyente

INNER JOIN #ClavesObs15 AS claves
    ON claves.CIC = convertido.CIC
   AND claves.Ruc = contribuyente.Ruc

WHERE
    convertido.CIC IS NOT NULL

GROUP BY
    convertido.CIC,
    contribuyente.Ruc

OPTION (RECOMPILE);


CREATE UNIQUE CLUSTERED INDEX IX_Obs15
    ON #Obs15 (
        CIC,
        Ruc
    );


/* ============================================================
   3. CLAVES PARA CONVENIOS
   ============================================================ */

SELECT DISTINCT
    CIC =
        TRY_CONVERT(INT, CICNumerico)

INTO #ClavesConvenio

FROM #Base

WHERE
    TRY_CONVERT(INT, CICNumerico) IS NOT NULL;


CREATE UNIQUE CLUSTERED INDEX IX_ClavesConvenio
    ON #ClavesConvenio (CIC);


/* ============================================================
   PAGOS DE CONVENIO

   RELACIÓN:
       FactCobro.IdCobro = FactTablaAmortizacion.Cuic

   VALORES:
       ValorPagoConvenio = TotalPagar
       ValorCoactiva     = AbonoCoactivaDeuda
   ============================================================ */

SELECT
    CIC =
        TRY_CONVERT(BIGINT, ta.Cuic),

    FechaPagoConvenio =
        MAX(ta.FechaPago),

    ValorPagoConvenio =
        CAST(
            SUM(
                ABS(
                    ISNULL(ta.TotalPagar, 0)
                )
            )
            AS DECIMAL(18,2)
        ),

    ValorCoactivaConvenio =
        CAST(
            SUM(
                ABS(
                    ISNULL(ta.AbonoCoactivaDeuda, 0)
                )
            )
            AS DECIMAL(18,2)
        )

INTO #PagosConvenio

FROM [RECAUDACION_DM].[ConveniosPago].[FactTablaAmortizacion] AS ta
WITH (NOLOCK)

INNER JOIN #ClavesConvenio AS claves
    ON claves.CIC = ta.Cuic

WHERE
    ta.FechaPago >= @FechaInicio
    AND ta.FechaPago < @FechaFin

    AND UPPER(
            ISNULL(
                ta.Estado,
                ''
            )
        ) LIKE '%PAGADO%'

    AND UPPER(
            ISNULL(
                ta.Estado,
                ''
            )
        ) NOT LIKE '%NO PAGADO%'

GROUP BY
    ta.Cuic

OPTION (RECOMPILE);


CREATE UNIQUE CLUSTERED INDEX IX_PagosConvenio
    ON #PagosConvenio (CIC);


/* ============================================================
   4. AGRUPACIÓN FINAL
   ============================================================ */

;WITH Agregado AS (
    SELECT
        base.CIC,

        base.IdFactCobro,

        base.IdLiquidacion,

        base.IdContribuyentePago,

        base.Ruc,

        NombreContribuyente =
            MAX(base.NombreContribuyente),

        base.AnioPago,

        base.Impuesto,

        Observacion =
            MAX(
                COALESCE(
                    obs.Observacion15,

                    NULLIF(
                        LTRIM(
                            RTRIM(base.ConceptoRecibo)
                        ),
                        ''
                    ),

                    NULLIF(
                        LTRIM(
                            RTRIM(
                                CONCAT(
                                    base.TransaccionPrincipal,
                                    ' | ',
                                    base.SubTransaccionPrincipal,
                                    ' | ',
                                    base.DetallePrincipal
                                )
                            )
                        ),
                        ' |  | '
                    )
                )
            ),

        PrimeraFechaMovimiento =
            MIN(base.FechaCobro),

        UltimaFechaMovimiento =
            MAX(base.FechaCobro),

        TienePago =
            MAX(
                CASE
                    WHEN base.Estado = 'Pago'
                        THEN 1
                    ELSE 0
                END
            ),

        TieneReverso =
            MAX(
                CASE
                    WHEN base.Estado = 'Reverso'
                        THEN 1
                    ELSE 0
                END
            ),

        EstadoOriginal =
            MAX(base.Estado),


        /* ====================================================
           IMPUESTO PRINCIPAL
           ==================================================== */

        ValorImpuestoPrincipal =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                         AND base.CategoriaComponente =
                             'IMPUESTO PRINCIPAL'
                            THEN base.ValorAbs

                        WHEN base.Estado = 'Reverso'
                         AND base.CategoriaComponente =
                             'IMPUESTO PRINCIPAL'
                            THEN -base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           INTERÉS
           ==================================================== */

        ValorInteres =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                         AND base.CategoriaComponente = 'INTERES'
                            THEN base.ValorAbs

                        WHEN base.Estado = 'Reverso'
                         AND base.CategoriaComponente = 'INTERES'
                            THEN -base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           MULTA
           ==================================================== */

        ValorMulta =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                         AND base.CategoriaComponente = 'MULTA'
                            THEN base.ValorAbs

                        WHEN base.Estado = 'Reverso'
                         AND base.CategoriaComponente = 'MULTA'
                            THEN -base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           RECARGO
           ==================================================== */

        ValorRecargo =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                         AND base.CategoriaComponente = 'RECARGO'
                            THEN base.ValorAbs

                        WHEN base.Estado = 'Reverso'
                         AND base.CategoriaComponente = 'RECARGO'
                            THEN -base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           COACTIVA DEL DESGLOSE DIRECTO
           ==================================================== */

        TieneCoactivaDesglose =
            MAX(
                CASE
                    WHEN base.CategoriaComponente = 'COACTIVA'
                        THEN 1
                    ELSE 0
                END
            ),

        ValorCoactivaDesglose =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                         AND base.CategoriaComponente = 'COACTIVA'
                            THEN base.ValorAbs

                        WHEN base.Estado = 'Reverso'
                         AND base.CategoriaComponente = 'COACTIVA'
                            THEN -base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           TOTAL GENERAL DEL COMPROBANTE

           INCLUYE TODOS LOS COMPONENTES:
               - Impuesto
               - Interés
               - Multa
               - Recargo
               - Coactiva
               - Otros valores del desglose

           Pago    = positivo
           Reverso = negativo
           ==================================================== */

        ValorPagadoTotal =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                            THEN base.ValorAbs

                        WHEN base.Estado = 'Reverso'
                            THEN -base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           DATOS DEL CONVENIO
           ==================================================== */

        ValorCoactivaConvenio =
            MAX(
                ISNULL(
                    convenio.ValorCoactivaConvenio,
                    0
                )
            ),

        ValorPagoConvenioOrigen =
            MAX(
                ISNULL(
                    convenio.ValorPagoConvenio,
                    0
                )
            ),

        FechaPagoConvenio =
            MAX(convenio.FechaPagoConvenio),


        /* ====================================================
           PAGO BRUTO CORRESPONDIENTE A GUAYAQUIL
           ==================================================== */

        ValorPagoBruto =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                         AND base.EsGuayaquil = 1
                            THEN base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           TOTAL REVERSADO
           ==================================================== */

        ValorReverso =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Reverso'
                            THEN base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),


        /* ====================================================
           NETO CORRESPONDIENTE A GUAYAQUIL
           ==================================================== */

        ValorPagadoNeto =
            CAST(
                SUM(
                    CASE
                        WHEN base.Estado = 'Pago'
                         AND base.EsGuayaquil = 1
                            THEN base.ValorAbs

                        WHEN base.Estado = 'Reverso'
                            THEN -base.ValorAbs

                        ELSE 0
                    END
                )
                AS DECIMAL(18,2)
            ),

        FechaReverso =
            MAX(base.FechaReverso),

        MotivoReverso =
            MAX(base.MotivoReverso),

        ValorComprobantePago15 =
            MAX(obs.ValorComprobantePago15),

        FechaPago15PorMil =
            MAX(obs.FechaPago15PorMil),

        CanalPago =
            MAX(base.CanalPago),

        Banco =
            MAX(base.Banco)

    FROM #Base AS base

    LEFT JOIN #Obs15 AS obs
        ON obs.CIC = base.CICNumerico
       AND obs.Ruc = base.Ruc

    LEFT JOIN #PagosConvenio AS convenio
        ON convenio.CIC = base.CICNumerico

    GROUP BY
        base.CIC,
        base.IdFactCobro,
        base.IdLiquidacion,
        base.IdContribuyentePago,
        base.Ruc,
        base.AnioPago,
        base.Impuesto
)


/* ============================================================
   5. RESULTADO FINAL PARA POWER BI
   ============================================================ */

SELECT
    CIC,

    IdFactCobro,

    IdLiquidacion,

    IdContribuyentePago,

    Ruc,

    NombreContribuyente,

    AnioPago,

    Impuesto,

    Observacion,

    PrimeraFechaMovimiento,

    UltimaFechaMovimiento,

    EstadoCobro =
        CASE
            WHEN TienePago = 1
             AND TieneReverso = 1
                THEN 'Pago con reverso'

            WHEN TienePago = 1
                THEN 'Pago'

            WHEN TieneReverso = 1
                THEN 'Reverso'

            ELSE EstadoOriginal
        END,

    RecibosPago =
        TienePago,

    RecibosReverso =
        TieneReverso,

    ValorImpuestoPrincipal,

    ValorInteres,

    ValorMulta,

    ValorRecargo,

    ValorPagadoTotal,


    /* ========================================================
       PAGO TOTAL DEL CONVENIO

       Si existe pago y reverso en el mismo grupo:
           resultado neto = 0
       ======================================================== */

    ValorPagoConvenio =
        CAST(
            CASE
                WHEN TienePago = 1
                 AND TieneReverso = 0
                    THEN ABS(
                        ISNULL(
                            ValorPagoConvenioOrigen,
                            0
                        )
                    )

                WHEN TienePago = 0
                 AND TieneReverso = 1
                    THEN -ABS(
                        ISNULL(
                            ValorPagoConvenioOrigen,
                            0
                        )
                    )

                WHEN TienePago = 1
                 AND TieneReverso = 1
                    THEN 0

                ELSE 0
            END
            AS DECIMAL(18,2)
        ),


    /* ========================================================
       VALOR DE COACTIVA

       PRIORIDAD:
           1. Desglose directo COA
           2. Amortización del convenio

       Si existe COA en el desglose, incluso si su neto queda
       en cero por reverso, no se reemplaza con el convenio.
       ======================================================== */

    ValorCoactiva =
        CAST(
            CASE
                WHEN TieneCoactivaDesglose = 1
                    THEN ISNULL(
                        ValorCoactivaDesglose,
                        0
                    )

                WHEN TienePago = 1
                 AND TieneReverso = 0
                    THEN ABS(
                        ISNULL(
                            ValorCoactivaConvenio,
                            0
                        )
                    )

                WHEN TienePago = 0
                 AND TieneReverso = 1
                    THEN -ABS(
                        ISNULL(
                            ValorCoactivaConvenio,
                            0
                        )
                    )

                WHEN TienePago = 1
                 AND TieneReverso = 1
                    THEN 0

                ELSE 0
            END
            AS DECIMAL(18,2)
        ),

    FechaPagoConvenio,

    ValorPagoBruto,

    ValorReverso,

    ValorPagadoNeto,

    FechaReverso,

    MotivoReverso,

    ValorComprobantePago15,

    FechaPago15PorMil,

    CanalPago,

    Banco

FROM Agregado

OPTION (RECOMPILE);


/* ============================================================
   LIMPIEZA
   ============================================================ */

DROP TABLE IF EXISTS #PagosConvenio;
DROP TABLE IF EXISTS #ClavesConvenio;
DROP TABLE IF EXISTS #Obs15;
DROP TABLE IF EXISTS #ClavesObs15;
DROP TABLE IF EXISTS #Base;
