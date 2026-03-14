from app.schemas.m720_boe_v2 import CoverageWarning
from app.engines.openai_universal import _run_quality_checks
from app.schemas.m720_boe_v2 import M720DocumentExtraction, M720Cuenta, M720Valor, M720IIC


def _make_cuenta(denominacion: str, calle: str = "", saldo: float = 1000.0) -> M720Cuenta:
    from app.schemas.m720_boe_v2 import DireccionEntidad
    return M720Cuenta(
        denominacion_entidad=denominacion,
        saldo_31_diciembre=saldo,
        moneda_original="EUR",
        pais_entidad_o_inmueble="CH",
        domicilio_entidad=DireccionEntidad(calle=calle) if calle else None,
    )


def _make_valor(denominacion: str, saldo: float = 1000.0, num_valores: float = 10.0) -> M720Valor:
    return M720Valor(
        denominacion_entidad_emisora=denominacion,
        saldo_31_diciembre=saldo,
        numero_valores=num_valores,
        moneda_original="EUR",
        pais_entidad_o_inmueble="US",
    )


def test_coverage_warning_quality_tipos():
    w = CoverageWarning(tipo="calidad_encoding", mensaje="Encoding artifact detected")
    assert w.tipo == "calidad_encoding"
    assert w.severidad == "media"


def test_coverage_warning_fusion_tipo():
    w = CoverageWarning(tipo="calidad_nombre_fusion", mensaje="OCR-fused word")
    assert w.tipo == "calidad_nombre_fusion"


def test_coverage_warning_extinguido_tipo():
    w = CoverageWarning(tipo="calidad_activo_extinguido", mensaje="Zero-balance asset")
    assert w.tipo == "calidad_activo_extinguido"


# Bug 3: Encoding artifact detection
def test_quality_check_detects_encoding_artifact():
    extraction = M720DocumentExtraction(
        cuentas=[_make_cuenta("JP Morgan", calle="6 route de TrÃ¨ves")]
    )
    warnings = _run_quality_checks(extraction)
    tipos = [w.tipo for w in warnings]
    assert "calidad_encoding" in tipos


def test_quality_check_no_false_positive_clean_text():
    extraction = M720DocumentExtraction(
        cuentas=[_make_cuenta("JP Morgan", calle="6 route de Trèves")]
    )
    warnings = _run_quality_checks(extraction)
    tipos = [w.tipo for w in warnings]
    assert "calidad_encoding" not in tipos


# Bug 4: OCR-fusion name detection
def test_quality_check_detects_ocr_fusion():
    extraction = M720DocumentExtraction(
        valores=[_make_valor("BANKOFAMERICA CORP")]
    )
    warnings = _run_quality_checks(extraction)
    tipos = [w.tipo for w in warnings]
    assert "calidad_nombre_fusion" in tipos


def test_quality_check_no_false_positive_normal_name():
    extraction = M720DocumentExtraction(
        valores=[_make_valor("BANK OF AMERICA CORP")]
    )
    warnings = _run_quality_checks(extraction)
    tipos = [w.tipo for w in warnings]
    assert "calidad_nombre_fusion" not in tipos


# Bug 5: Zero-balance extinguished asset detection
def test_quality_check_detects_zero_balance_asset():
    extraction = M720DocumentExtraction(
        valores=[_make_valor("SHELL PLC RTS", saldo=0.0, num_valores=0.0)]
    )
    warnings = _run_quality_checks(extraction)
    tipos = [w.tipo for w in warnings]
    assert "calidad_activo_extinguido" in tipos


def test_quality_check_no_false_positive_low_value():
    # Warrant con valor residual pero > 0 → no es extinguido
    extraction = M720DocumentExtraction(
        valores=[_make_valor("SOME WARRANT", saldo=0.01, num_valores=1.0)]
    )
    warnings = _run_quality_checks(extraction)
    tipos = [w.tipo for w in warnings]
    assert "calidad_activo_extinguido" not in tipos


from app.engines.openai_universal import _fix_encoding


def test_fix_encoding_corrects_mojibake():
    broken = "6 route de TrÃ¨ves"
    fixed = _fix_encoding(broken)
    assert "Trèves" in fixed
    assert "Ã" not in fixed


def test_fix_encoding_preserves_clean_text():
    clean = "6 route de Trèves"
    assert _fix_encoding(clean) == clean


def test_fix_encoding_handles_empty_string():
    assert _fix_encoding("") == ""
