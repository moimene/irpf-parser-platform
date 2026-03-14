from app.schemas.m720_boe_v2 import CoverageWarning


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
