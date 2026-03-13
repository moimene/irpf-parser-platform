"""
Modelo 720 — Esquemas Pydantic V2 (BOE en Código)

Modelos de datos que fuerzan a OpenAI (gpt-4o) a devolver la información
estructurada exactamente como la exige la AEAT para el Modelo 720.

Referencia normativa:
  - Orden HAP/72/2013 (estructura del fichero TXT)
  - Instrucciones de cumplimentación del Modelo 720

Cada campo lleva `Field(description=...)` extenso para que OpenAI
entienda qué extraer del documento bancario vía Structured Outputs.

NOTA: Este módulo es parte del FORK LÓGICO V2. No modifica ni depende
de los schemas V1 existentes en `app/schemas.py`.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────
# Coverage Warnings — Trazabilidad para revisión humana
# ─────────────────────────────────────────────────────────────────────


class CoverageWarning(BaseModel):
    """
    Advertencia individual de cobertura de extracción.

    El sistema genera estos warnings cuando detecta datos en el OCR
    que no pudieron ser extraídos o presentan incertidumbre.
    Diseñados para que un humano pueda localizar y verificar rápidamente.
    """

    tipo: Literal[
        "isin_no_extraido",       # ISIN visible en OCR pero no extraído
        "isin_no_rescatado",      # ISIN que el rescue pass tampoco pudo extraer
        "isin_no_en_ocr",         # ISIN esperado pero no presente en el markdown (fallo OCR)
        "bloque_fallido",         # Un bloque completo falló en la extracción
        "rescue_fallido",         # El rescue pass falló (error de API)
    ] = Field(description="Tipo de advertencia de cobertura.")

    severidad: Literal["alta", "media", "baja"] = Field(
        default="media",
        description=(
            "Severidad del warning. 'alta' = posible activo declarable omitido, "
            "'media' = dato incierto que conviene revisar, "
            "'baja' = informativo."
        ),
    )

    isin: Optional[str] = Field(
        default=None,
        description="ISIN afectado, si aplica.",
    )

    contexto_ocr: Optional[str] = Field(
        default=None,
        description=(
            "Fragmento de texto OCR alrededor del dato problemático "
            "(±200 chars) para que el humano pueda localizarlo rápidamente."
        ),
    )

    bloque: Optional[int] = Field(
        default=None,
        description="Número de bloque (1-based) donde ocurrió el problema.",
    )

    mensaje: str = Field(
        description="Descripción legible del problema para el revisor humano.",
    )


class ExtractionCoverage(BaseModel):
    """
    Resumen de cobertura de la extracción V2.

    Permite al humano evaluar la fiabilidad de la extracción y saber
    exactamente qué revisar manualmente.
    """

    isins_en_ocr: int = Field(
        default=0,
        description="Total de ISINs únicos encontrados por regex en el markdown OCR.",
    )

    isins_extraidos: int = Field(
        default=0,
        description="Total de ISINs únicos presentes en la extracción final.",
    )

    isins_rescatados: int = Field(
        default=0,
        description="ISINs recuperados por el verification pass (no estaban en la primera pasada).",
    )

    isins_no_recuperados: List[str] = Field(
        default_factory=list,
        description=(
            "ISINs encontrados en el OCR pero que NO aparecen en la extracción final. "
            "Estos DEBEN ser verificados manualmente por el humano."
        ),
    )

    bloques_total: int = Field(default=0, description="Número total de bloques procesados.")
    bloques_exitosos: int = Field(default=0, description="Bloques que devolvieron resultados.")
    bloques_fallidos: int = Field(default=0, description="Bloques que fallaron (error/timeout).")
    rescue_passes: int = Field(default=0, description="Número de rescue passes lanzados.")

    cobertura_isin_pct: float = Field(
        default=100.0,
        description=(
            "Porcentaje de cobertura ISIN: (extraídos / en_ocr) × 100. "
            "100% = todos los ISINs del OCR fueron extraídos. "
            "<100% = hay ISINs en el documento que no se extrajeron."
        ),
    )

    warnings: List[CoverageWarning] = Field(
        default_factory=list,
        description="Lista detallada de advertencias para revisión humana.",
    )


# ─────────────────────────────────────────────────────────────────────
# Tipos auxiliares reutilizables
# ─────────────────────────────────────────────────────────────────────

CondicionDeclarante = Literal[
    "Titular",
    "Representante",
    "Autorizado",
    "Beneficiario",
    "Usufructuario",
    "Tomador",
    "Con poder de disposición",
    "Otras formas de titularidad real",
]

OrigenBienDerecho = Literal[
    "A",  # Se declara por primera vez (alta)
    "M",  # Ya ha sido declarado en ejercicios anteriores (modificación >20.000 EUR)
    "C",  # Se extingue la titularidad (cancelación)
]


class DireccionEntidad(BaseModel):
    """Dirección postal de la entidad bancaria, gestora, aseguradora o registro."""

    calle: Optional[str] = Field(
        default=None,
        description=(
            "Nombre de la vía, número y piso de la entidad. "
            "Extraer tal cual aparezca en el documento bancario."
        ),
    )
    poblacion: Optional[str] = Field(
        default=None,
        description="Ciudad o localidad donde se ubica la entidad.",
    )
    provincia: Optional[str] = Field(
        default=None,
        description="Provincia o estado/cantón (para entidades extranjeras).",
    )
    codigo_postal: Optional[str] = Field(
        default=None,
        description="Código postal de la dirección de la entidad.",
    )
    pais: Optional[str] = Field(
        default=None,
        description=(
            "Código ISO 3166-1 alfa-2 del país de la dirección "
            "(ej: 'CH' para Suiza, 'LU' para Luxemburgo, 'IE' para Irlanda)."
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# Clase base común a los 5 tipos de bien
# ─────────────────────────────────────────────────────────────────────

class BaseM720Asset(BaseModel):
    """
    Campos comunes a TODOS los tipos de bien/derecho del Modelo 720.
    Cada subclase añade los campos específicos de su clave (C, V, I, S, B).
    """

    nif_representante: Optional[str] = Field(
        default=None,
        description=(
            "NIF/NIE del representante legal si el declarante actúa "
            "a través de representante. Dejar null si es titular directo."
        ),
    )

    condicion_declarante: CondicionDeclarante = Field(
        default="Titular",
        description=(
            "Condición del declarante respecto al bien. En la mayoría de "
            "extractos bancarios el cliente es 'Titular'. Solo cambiar si "
            "el documento indica expresamente otra relación (representante, "
            "autorizado, beneficiario, usufructuario, tomador, etc.)."
        ),
    )

    titularidad_otras: Optional[str] = Field(
        default=None,
        description=(
            "Texto libre obligatorio SOLO cuando condicion_declarante = "
            "'Otras formas de titularidad real'. Describir la forma de "
            "titularidad. Dejar null en cualquier otro caso."
        ),
    )

    pais_entidad_o_inmueble: str = Field(
        description=(
            "Código ISO 3166-1 alfa-2 del país donde se encuentra la "
            "entidad financiera, gestora, aseguradora o inmueble. "
            "Ejemplos: 'CH' (Suiza), 'LU' (Luxemburgo), 'IE' (Irlanda), "
            "'DE' (Alemania), 'GB' (Reino Unido). "
            "IMPORTANTE: Inferir del ISIN (primeros 2 caracteres), de la "
            "dirección de la entidad, o del código BIC/SWIFT."
        ),
    )

    origen_bien_derecho: OrigenBienDerecho = Field(
        default="A",
        description=(
            "Origen del bien para la declaración M720. "
            "'A' = se declara por primera vez (alta). "
            "'M' = ya declarado en ejercicios anteriores (modificación, "
            "incremento superior a 20.000 EUR). "
            "'C' = se extingue la titularidad (cancelación). "
            "Por defecto 'A' salvo que el documento indique lo contrario."
        ),
    )

    porcentaje_participacion: float = Field(
        default=100.0,
        description=(
            "Porcentaje de participación del declarante sobre el bien "
            "(0.00 a 100.00). Por defecto 100% (titularidad plena). "
            "Solo reducir si el documento indica cotitularidad."
        ),
    )

    moneda_original: str = Field(
        description=(
            "Código ISO 4217 de la moneda en que el documento expresa "
            "los importes (ej: 'USD', 'EUR', 'CHF', 'GBP', 'JPY'). "
            "VITAL para aplicar el tipo de cambio del BCE al 31 de diciembre. "
            "Extraer de la cabecera del extracto o de la columna de importes."
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# Clave C — Cuentas en entidades financieras
# ─────────────────────────────────────────────────────────────────────

class M720Cuenta(BaseM720Asset):
    """
    Clave C del Modelo 720: Cuentas corrientes, de ahorro, imposiciones
    a plazo y cuentas de valores abiertas en entidades financieras
    situadas en el extranjero.

    Subclaves:
      A — Cuenta corriente
      B — Cuenta de ahorro
      C — Imposición a plazo fijo
      D — Cuenta de crédito
      E — Otras cuentas
    """

    subclave: Literal["A", "B", "C", "D", "E"] = Field(
        default="A",
        description=(
            "Tipo de cuenta bancaria. "
            "A = cuenta corriente (más común en extractos), "
            "B = cuenta de ahorro, "
            "C = imposición a plazo fijo/depósito, "
            "D = cuenta de crédito, "
            "E = otras cuentas. "
            "Por defecto 'A' si no se puede determinar el tipo exacto."
        ),
    )

    clave_identificacion_cuenta: Literal["I", "O"] = Field(
        default="I",
        description=(
            "Tipo de identificación de la cuenta. "
            "'I' = IBAN (formato estándar internacional, lo más habitual). "
            "'O' = Otro código de cuenta (cuando no existe IBAN, ej: cuentas USA)."
        ),
    )

    codigo_bic: Optional[str] = Field(
        default=None,
        description=(
            "Código BIC/SWIFT de la entidad bancaria (8 u 11 caracteres). "
            "Buscar en cabecera del extracto o junto al IBAN."
        ),
    )

    codigo_cuenta: Optional[str] = Field(
        default=None,
        description=(
            "Número IBAN completo (si clave_identificacion_cuenta = 'I') "
            "o número de cuenta propio del banco (si = 'O'). "
            "Formato IBAN: 2 letras país + 2 dígitos control + hasta 30 "
            "alfanuméricos (con o sin espacios). "
            "Extraer exactamente como aparece, sin modificar."
        ),
    )

    denominacion_entidad: Optional[str] = Field(
        default=None,
        description=(
            "Nombre completo de la entidad bancaria tal como aparece "
            "en la cabecera o membrete del documento."
        ),
    )

    nif_entidad: Optional[str] = Field(
        default=None,
        description=(
            "NIF o número de identificación fiscal de la entidad "
            "en su país de origen. Puede no estar en el documento; "
            "dejar null si no aparece."
        ),
    )

    domicilio_entidad: Optional[DireccionEntidad] = Field(
        default=None,
        description=(
            "Dirección postal de la entidad bancaria. "
            "Extraer calle, ciudad, código postal y país si aparecen."
        ),
    )

    fecha_apertura: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de apertura de la cuenta en formato DD/MM/YYYY. "
            "Solo incluir si aparece explícitamente en el documento. "
            "Dejar null si no se menciona."
        ),
    )

    fecha_extincion: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de cierre/extinción de la cuenta en formato DD/MM/YYYY. "
            "Solo si la cuenta se canceló durante el ejercicio fiscal. "
            "Dejar null si la cuenta sigue activa."
        ),
    )

    saldo_31_diciembre: Optional[float] = Field(
        default=None,
        description=(
            "Saldo de la cuenta a 31 de diciembre del ejercicio fiscal, "
            "en la MONEDA ORIGINAL del extracto (no convertir a EUR). "
            "Incluir decimales. Puede ser negativo (descubierto). "
            "Este es el dato más importante de la cuenta para M720."
        ),
    )

    saldo_medio_4T: Optional[float] = Field(
        default=None,
        description=(
            "Saldo medio del último trimestre (octubre-diciembre) en "
            "la moneda original. Si el documento no lo indica, dejar null. "
            "Algunos extractos lo calculan como media de saldos diarios."
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# Clave V — Valores o derechos (acciones, ETFs, bonos, derivados)
# ─────────────────────────────────────────────────────────────────────

class M720Valor(BaseM720Asset):
    """
    Clave V del Modelo 720: Valores o derechos representativos de la
    participación en cualquier tipo de entidad jurídica, valores situados
    en el extranjero, y seguros de vida o invalidez.

    Incluye: acciones, ETFs, bonos, obligaciones, warrants, derivados,
    notas estructuradas, certificados de depósito.

    Subclaves:
      A — Valores o derechos representativos de participación en entidades
          jurídicas (acciones, participaciones)
      B — Valores situados en el extranjero representativos de cesión a
          terceros de capitales propios (bonos, obligaciones)
      C — Valores aportados para la gestión o administración por cualquier
          instrumento jurídico (warrants, derivados, notas estructuradas)
    """

    subclave: Literal["A", "B", "C"] = Field(
        default="A",
        description=(
            "Tipo de valor. "
            "A = participaciones en entidades (acciones, ETFs de renta variable). "
            "B = cesión de capitales (bonos, obligaciones, ETFs de renta fija). "
            "C = otros valores (warrants, derivados, notas estructuradas, "
            "certificados). "
            "REGLA: ETFs de equity → A, ETFs de bonds → B, warrants/notas → C."
        ),
    )

    clave_identificacion: Literal["1", "2"] = Field(
        default="1",
        description=(
            "Tipo de código que identifica al valor. "
            "'1' = ISIN (código de 12 caracteres, lo más habitual). "
            "'2' = Otro código (CUSIP, SEDOL, código interno del banco)."
        ),
    )

    identificacion_valores: Optional[str] = Field(
        default=None,
        description=(
            "Código ISIN del valor (12 caracteres: 2 letras país + 9 alfanum + 1 check). "
            "Si no tiene ISIN, el código interno del banco. "
            "Buscar en columnas 'ISIN', 'Valor', 'Ref', 'Security ID' del extracto."
        ),
    )

    denominacion_entidad_emisora: Optional[str] = Field(
        default=None,
        description=(
            "Nombre completo del emisor del valor o de la entidad gestora "
            "tal como aparece en el extracto. "
            "Para ETFs usar el nombre del fondo/emisor, NO el del broker custodio."
        ),
    )

    nif_entidad: Optional[str] = Field(
        default=None,
        description=(
            "NIF o identificación fiscal de la entidad emisora. "
            "Frecuentemente no disponible en extractos; dejar null."
        ),
    )

    domicilio_entidad: Optional[DireccionEntidad] = Field(
        default=None,
        description="Dirección de la entidad emisora, si aparece en el documento.",
    )

    fecha_adquisicion: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de compra/adquisición del valor en formato DD/MM/YYYY. "
            "Si hay múltiples lotes con fechas diferentes, usar la fecha "
            "de la primera compra. Dejar null si no aparece."
        ),
    )

    fecha_transmision: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de venta/transmisión si se vendió durante el ejercicio, "
            "en formato DD/MM/YYYY. Dejar null si sigue en cartera."
        ),
    )

    saldo_31_diciembre: Optional[float] = Field(
        default=None,
        description=(
            "Valor de mercado de la posición a 31 de diciembre, "
            "en la MONEDA ORIGINAL del extracto. "
            "Para ETFs/acciones: precio × nº de participaciones. "
            "Este es el dato más importante para M720."
        ),
    )

    clave_representacion: Literal["A", "B"] = Field(
        default="A",
        description=(
            "Forma de representación del valor. "
            "'A' = anotaciones en cuenta (lo más habitual hoy en día). "
            "'B' = títulos físicos (raro, solo en emisiones antiguas)."
        ),
    )

    numero_valores: Optional[float] = Field(
        default=None,
        description=(
            "Número de participaciones, acciones o títulos a 31 de diciembre. "
            "Puede tener decimales (ej: 142.5000 participaciones de un ETF). "
            "Buscar en columnas 'Qty', 'Units', 'Participaciones', 'Shares'."
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# Clave I — Acciones/participaciones en IICs (fondos de inversión)
# ─────────────────────────────────────────────────────────────────────

class M720IIC(BaseM720Asset):
    """
    Clave I del Modelo 720: Acciones y participaciones en el capital social
    o fondo patrimonial de Instituciones de Inversión Colectiva (IICs)
    situadas en el extranjero.

    Incluye: fondos de inversión (UCITS, SICAV, ICAV), hedge funds,
    fondos de fondos, fondos de private equity situados en el extranjero.
    """

    identificacion_valores: Optional[str] = Field(
        default=None,
        description=(
            "Código ISIN del fondo (12 caracteres: 2 letras país + 9 alfanum + 1 check). "
            "Extraer de columnas 'ISIN', 'Fund Code', 'Ref', 'Security ID'. "
            "Si no tiene ISIN (fondos privados), usar el código interno."
        ),
    )

    denominacion_entidad_gestora: Optional[str] = Field(
        default=None,
        description=(
            "Nombre de la sociedad gestora del fondo (NO del banco custodio). "
            "Extraer del nombre completo del fondo tal como aparece en "
            "el extracto. Incluir sufijos legales (PLC, SICAV, ICAV, etc.)."
        ),
    )

    nif_entidad: Optional[str] = Field(
        default=None,
        description=(
            "NIF o identificación fiscal de la gestora del fondo. "
            "Raramente disponible en extractos; dejar null."
        ),
    )

    domicilio_entidad: Optional[DireccionEntidad] = Field(
        default=None,
        description="Dirección de la entidad gestora, si aparece en el documento.",
    )

    fecha_adquisicion: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de suscripción/compra del fondo en formato DD/MM/YYYY. "
            "Si hay múltiples lotes, usar la fecha de la primera suscripción. "
            "Dejar null si no aparece en el extracto."
        ),
    )

    fecha_transmision: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de reembolso/venta si se desinvirtió durante el ejercicio, "
            "formato DD/MM/YYYY. Dejar null si sigue en cartera."
        ),
    )

    valor_liquidativo_31_diciembre: Optional[float] = Field(
        default=None,
        description=(
            "Valor total de la posición a 31 de diciembre, "
            "en la MONEDA ORIGINAL del extracto. "
            "Es decir: NAV × número de participaciones. "
            "NO es el NAV unitario, sino el VALOR TOTAL de la inversión. "
            "Columnas típicas: 'Market Value', 'Valor', 'Amount'."
        ),
    )

    numero_valores: Optional[float] = Field(
        default=None,
        description=(
            "Número de participaciones del fondo a 31 de diciembre. "
            "Puede tener muchos decimales (ej: 1234.567890). "
            "Columnas: 'Units', 'Shares', 'Participaciones', 'Qty'."
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# Clave S — Seguros de vida e invalidez
# ─────────────────────────────────────────────────────────────────────

class M720Seguro(BaseM720Asset):
    """
    Clave S del Modelo 720: Seguros de vida o invalidez contratados
    con entidades establecidas en el extranjero de los que sean tomadores
    a 31 de diciembre.

    Subclaves:
      1 — Seguros de vida o invalidez de los que sea tomador
      2 — Rentas temporales o vitalicias de entidades aseguradoras
          situadas en el extranjero
    """

    subclave: Literal["1", "2"] = Field(
        default="1",
        description=(
            "Tipo de seguro. "
            "'1' = seguro de vida o invalidez (unit-linked, seguro mixto). "
            "'2' = renta temporal o vitalicia de aseguradora extranjera."
        ),
    )

    denominacion_entidad_aseguradora: Optional[str] = Field(
        default=None,
        description=(
            "Nombre completo de la compañía aseguradora tal como aparece "
            "en la cabecera de la póliza o extracto."
        ),
    )

    nif_entidad: Optional[str] = Field(
        default=None,
        description=(
            "NIF o número de identificación fiscal de la aseguradora. "
            "Dejar null si no aparece en el documento."
        ),
    )

    domicilio_entidad: Optional[DireccionEntidad] = Field(
        default=None,
        description="Dirección de la entidad aseguradora.",
    )

    fecha_contratacion: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de contratación de la póliza en formato DD/MM/YYYY. "
            "Extraer de la carátula o condiciones particulares."
        ),
    )

    fecha_extincion: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de extinción de la póliza en formato DD/MM/YYYY. "
            "Solo si la póliza se extinguió durante el ejercicio. "
            "Dejar null si sigue vigente."
        ),
    )

    valor_rescate_capitalizacion_31_diciembre: Optional[float] = Field(
        default=None,
        description=(
            "Valor de rescate o capitalización a 31 de diciembre, "
            "en la MONEDA ORIGINAL de la póliza. "
            "Para unit-linked: valor de las participaciones subyacentes. "
            "Para seguros mixtos: provisión matemática. "
            "Columnas: 'Surrender Value', 'Cash Value', 'Valor rescate'."
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# Clave B/M/R — Bienes inmuebles
# ─────────────────────────────────────────────────────────────────────

class M720Inmueble(BaseM720Asset):
    """
    Clave B del Modelo 720: Bienes inmuebles y derechos sobre bienes
    inmuebles situados en el extranjero.

    Clave de bien:
      B — Bienes inmuebles (propiedad plena)
      M — Derechos sobre bienes inmuebles (usufructo, nuda propiedad,
          multipropiedad, aprovechamiento por turno)
      R — Bienes inmuebles obtenidos por herencia no aceptada

    Subclaves (tipo de inmueble):
      1 — Vivienda
      2 — Local comercial
      3 — Finca rústica
      4 — Garaje
      5 — Otros bienes inmuebles
    """

    clave_bien: Literal["B", "M", "R"] = Field(
        default="B",
        description=(
            "Tipo de derecho sobre el inmueble. "
            "'B' = propiedad plena (compra directa). "
            "'M' = derechos sobre inmuebles (usufructo, nuda propiedad, "
            "multipropiedad, aprovechamiento por turno). "
            "'R' = inmueble obtenido por herencia pendiente de aceptar."
        ),
    )

    subclave: Literal["1", "2", "3", "4", "5"] = Field(
        default="1",
        description=(
            "Tipo de inmueble. "
            "'1' = vivienda (apartamento, casa, piso). "
            "'2' = local comercial (oficina, tienda). "
            "'3' = finca rústica (terreno agrícola). "
            "'4' = garaje (plaza de aparcamiento). "
            "'5' = otros bienes inmuebles."
        ),
    )

    denominacion_registro: Optional[str] = Field(
        default=None,
        description=(
            "Nombre del registro de la propiedad o catastro extranjero "
            "donde está inscrito el inmueble."
        ),
    )

    domicilio_inmueble: Optional[DireccionEntidad] = Field(
        default=None,
        description=(
            "Dirección completa del inmueble en el extranjero. "
            "Incluir calle, número, ciudad, código postal y país."
        ),
    )

    fecha_adquisicion: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de adquisición del inmueble en formato DD/MM/YYYY. "
            "Extraer de la escritura de compraventa."
        ),
    )

    fecha_transmision: Optional[str] = Field(
        default=None,
        description=(
            "Fecha de venta/transmisión si se vendió durante el ejercicio, "
            "formato DD/MM/YYYY. Dejar null si sigue en propiedad."
        ),
    )

    valor_adquisicion: Optional[float] = Field(
        default=None,
        description=(
            "Precio de compra del inmueble en la MONEDA ORIGINAL "
            "de la escritura. Incluir impuestos y gastos de la compra "
            "si forman parte del precio de adquisición."
        ),
    )

    valor_transmision: Optional[float] = Field(
        default=None,
        description=(
            "Precio de venta en la MONEDA ORIGINAL si se transmitió "
            "durante el ejercicio. Dejar null si no se vendió."
        ),
    )

    clave_tipo_inmueble: Literal["U", "R"] = Field(
        default="U",
        description=(
            "Clasificación urbanística del inmueble. "
            "'U' = urbano (viviendas, locales, garajes en zona urbana). "
            "'R' = rústico (fincas, terrenos agrícolas)."
        ),
    )


# ─────────────────────────────────────────────────────────────────────
# Esquema raíz — Contenedor de toda la extracción
# ─────────────────────────────────────────────────────────────────────

class M720DocumentExtraction(BaseModel):
    """
    Resultado completo de la extracción de un documento bancario para
    el Modelo 720. Contiene las 5 listas correspondientes a las 5 claves
    del BOE.

    Este modelo se usa como `response_format` en la llamada a OpenAI
    `client.beta.chat.completions.parse(response_format=M720DocumentExtraction)`.

    OpenAI debe clasificar CADA activo encontrado en el documento en su
    lista correspondiente:
      - cuentas (C): cuentas corrientes, de ahorro, a plazo
      - valores (V): acciones, ETFs, bonos, warrants, derivados
      - iics (I): fondos de inversión (UCITS, SICAV, ICAV, hedge funds)
      - seguros (S): pólizas de vida, unit-linked
      - inmuebles (B): propiedades inmobiliarias en el extranjero

    REGLA CLAVE para diferenciar V de I:
      - Si el ISIN comienza con 'IE' o 'LU' y el nombre contiene
        'Fund', 'SICAV', 'UCITS', 'ICAV', 'PLC' → es un fondo → I
      - Si es un ETF que cotiza en bolsa → depende: ETF de equity → V(A),
        ETF de bonos → V(B)
      - Si es una acción individual o ADR → V(A)
      - Si es un bono corporativo o gubernamental → V(B)
      - Si es un warrant, nota estructurada, derivado → V(C)
    """

    cuentas: List[M720Cuenta] = Field(
        default_factory=list,
        description=(
            "Lista de cuentas bancarias (Clave C). "
            "Incluir TODAS las cuentas que aparezcan en el extracto "
            "con su saldo a 31 de diciembre. Cada cuenta (corriente, ahorro, "
            "a plazo) en la misma o distinta divisa es una entrada separada."
        ),
    )

    valores: List[M720Valor] = Field(
        default_factory=list,
        description=(
            "Lista de valores y derechos (Clave V). "
            "Incluir acciones, ETFs, bonos, warrants, derivados, notas "
            "estructuradas. Para ETFs: renta variable → subclave A, "
            "renta fija → subclave B."
        ),
    )

    iics: List[M720IIC] = Field(
        default_factory=list,
        description=(
            "Lista de fondos de inversión IIC (Clave I). "
            "Incluir fondos UCITS, SICAV, ICAV, hedge funds, fondos de "
            "private equity. Si el nombre incluye 'Fund', 'SICAV', 'UCITS', "
            "'PLC' y no cotiza en bolsa, clasificar aquí (no en V)."
        ),
    )

    seguros: List[M720Seguro] = Field(
        default_factory=list,
        description=(
            "Lista de seguros de vida/invalidez (Clave S). "
            "Incluir pólizas unit-linked, seguros mixtos, rentas vitalicias "
            "contratadas con aseguradoras extranjeras."
        ),
    )

    inmuebles: List[M720Inmueble] = Field(
        default_factory=list,
        description=(
            "Lista de bienes inmuebles (Clave B). "
            "Incluir viviendas, locales, fincas, garajes situados en el "
            "extranjero. Cada inmueble es una entrada separada."
        ),
    )
