"""Tests for V2 engine improvements: Luhn filter, zero-balance, exchange rates."""
import pytest

from app.schemas.m720_boe_v2 import (
    M720Cuenta,
    M720DocumentExtraction,
    M720IIC,
    M720Valor,
    M720Seguro,
    M720Inmueble,
    DireccionEntidad,
)


class TestApplyExchangeRates:
    """Tests for apply_exchange_rates() post-processor."""

    def test_usd_cuenta_converted(self):
        """USD account balance converted to EUR."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            cuentas=[
                M720Cuenta(
                    pais_entidad_o_inmueble="CH",
                    moneda_original="USD",
                    saldo_31_diciembre=10000.0,
                    saldo_medio_4T=9500.0,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        cuenta = result.cuentas[0]
        assert cuenta.tipo_cambio_aplicado is not None
        assert abs(cuenta.tipo_cambio_aplicado - 1.0389) < 0.0001
        assert cuenta.ejercicio_tc == 2024
        assert cuenta.saldo_31_diciembre_euros is not None
        assert abs(cuenta.saldo_31_diciembre_euros - 10000.0 / 1.0389) < 0.01
        assert cuenta.saldo_medio_4T_euros is not None
        assert abs(cuenta.saldo_medio_4T_euros - 9500.0 / 1.0389) < 0.01

    def test_eur_cuenta_passthrough(self):
        """EUR account: EUR fields = original, tc=1.0."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            cuentas=[
                M720Cuenta(
                    pais_entidad_o_inmueble="DE",
                    moneda_original="EUR",
                    saldo_31_diciembre=5000.0,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        cuenta = result.cuentas[0]
        assert cuenta.tipo_cambio_aplicado == 1.0
        assert cuenta.saldo_31_diciembre_euros == 5000.0

    def test_valor_with_acquisition(self):
        """Valor with both market value and acquisition cost."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            valores=[
                M720Valor(
                    pais_entidad_o_inmueble="US",
                    moneda_original="USD",
                    saldo_31_diciembre=50000.0,
                    valor_adquisicion=40000.0,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        valor = result.valores[0]
        assert valor.saldo_31_diciembre_euros is not None
        assert valor.valor_adquisicion_euros is not None
        assert abs(valor.saldo_31_diciembre_euros - 50000.0 / 1.0389) < 0.01
        assert abs(valor.valor_adquisicion_euros - 40000.0 / 1.0389) < 0.01

    def test_iic_converted(self):
        """IIC with CHF value converted."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            iics=[
                M720IIC(
                    pais_entidad_o_inmueble="LU",
                    moneda_original="CHF",
                    valor_liquidativo_31_diciembre=100000.0,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        iic = result.iics[0]
        assert iic.valor_liquidativo_31_diciembre_euros is not None
        assert iic.tipo_cambio_aplicado is not None

    def test_seguro_converted(self):
        """Seguro with GBP value converted."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            seguros=[
                M720Seguro(
                    pais_entidad_o_inmueble="GB",
                    moneda_original="GBP",
                    valor_rescate_capitalizacion_31_diciembre=200000.0,
                    prima_pagada=150000.0,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        seguro = result.seguros[0]
        assert seguro.valor_rescate_capitalizacion_31_diciembre_euros is not None
        assert seguro.prima_pagada_euros is not None

    def test_inmueble_converted(self):
        """Inmueble with USD acquisition + transmission."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            inmuebles=[
                M720Inmueble(
                    pais_entidad_o_inmueble="US",
                    moneda_original="USD",
                    valor_adquisicion=300000.0,
                    valor_transmision=350000.0,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        inmueble = result.inmuebles[0]
        assert inmueble.valor_adquisicion_euros is not None
        assert inmueble.valor_transmision_euros is not None

    def test_unavailable_currency_leaves_none(self):
        """RUB (unavailable post-2022) → EUR fields stay None."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            cuentas=[
                M720Cuenta(
                    pais_entidad_o_inmueble="RU",
                    moneda_original="RUB",
                    saldo_31_diciembre=1000000.0,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        cuenta = result.cuentas[0]
        assert cuenta.saldo_31_diciembre_euros is None
        assert cuenta.tipo_cambio_aplicado is None

    def test_null_amounts_stay_null(self):
        """Fields that are None in original stay None in EUR."""
        from app.engines.openai_universal import apply_exchange_rates

        extraction = M720DocumentExtraction(
            valores=[
                M720Valor(
                    pais_entidad_o_inmueble="US",
                    moneda_original="USD",
                    saldo_31_diciembre=50000.0,
                    valor_adquisicion=None,
                )
            ]
        )
        result = apply_exchange_rates(extraction, 2024)
        valor = result.valores[0]
        assert valor.saldo_31_diciembre_euros is not None
        assert valor.valor_adquisicion_euros is None


class TestFindIsinsLuhnFilter:
    """Tests for _find_isins_in_text with Luhn validation."""

    def test_valid_isin_accepted(self):
        """Known valid ISINs pass Luhn."""
        from app.engines.openai_universal import OpenAIUniversalEngine
        # IE00B3RBWM25 = iShares MSCI ACWI ETF (valid ISIN)
        text = "Position: IE00B3RBWM25 iShares MSCI ACWI"
        isins = OpenAIUniversalEngine._find_isins_in_text(text)
        assert "IE00B3RBWM25" in isins

    def test_ch_iban_rejected(self):
        """Swiss IBAN fragments rejected by Luhn."""
        from app.engines.openai_universal import OpenAIUniversalEngine
        # CH0508667005604841315 — IBAN, first 12 chars match ISIN regex
        text = "Account: CH0508667005604841315 EFG Bank"
        isins = OpenAIUniversalEngine._find_isins_in_text(text)
        # Should NOT contain the first 12 chars of the IBAN
        assert len(isins) == 0

    def test_mixed_isin_and_iban(self):
        """Text with both valid ISINs and IBANs — only ISINs returned."""
        from app.engines.openai_universal import OpenAIUniversalEngine
        text = (
            "ISIN: IE00B3RBWM25 iShares\n"
            "Account: CH0508667005604841315\n"
            "ISIN: LU0290358497 Xtrackers\n"
        )
        isins = OpenAIUniversalEngine._find_isins_in_text(text)
        assert "IE00B3RBWM25" in isins
        assert "LU0290358497" in isins
        assert len(isins) == 2

    def test_empty_text(self):
        """Empty text returns empty set."""
        from app.engines.openai_universal import OpenAIUniversalEngine
        assert OpenAIUniversalEngine._find_isins_in_text("") == set()


class TestZeroBalancePassthrough:
    """Zero-value assets must NOT be filtered by Aduana."""

    def test_zero_valor_passes_through(self):
        """Valor with saldo=0 and units=0 must survive merge."""
        from app.engines.openai_universal import merge_extractions

        extraction = M720DocumentExtraction(
            valores=[
                M720Valor(
                    pais_entidad_o_inmueble="US",
                    moneda_original="USD",
                    identificacion_valores="US0378331005",  # Apple ISIN
                    denominacion_entidad_emisora="Apple Inc",
                    saldo_31_diciembre=0.0,
                    numero_valores=0.0,
                )
            ]
        )
        result = merge_extractions([extraction])
        assert len(result.valores) == 1
        assert result.valores[0].saldo_31_diciembre == 0.0

    def test_zero_iic_passes_through(self):
        """IIC with valor=0 and units=0 must survive merge."""
        from app.engines.openai_universal import merge_extractions

        extraction = M720DocumentExtraction(
            iics=[
                M720IIC(
                    pais_entidad_o_inmueble="LU",
                    moneda_original="EUR",
                    identificacion_valores="LU0290358497",
                    denominacion_entidad_gestora="Xtrackers SICAV",
                    valor_liquidativo_31_diciembre=0.0,
                    numero_valores=0.0,
                )
            ]
        )
        result = merge_extractions([extraction])
        assert len(result.iics) == 1
        assert result.iics[0].valor_liquidativo_31_diciembre == 0.0

    def test_zero_valor_no_isin_passes_through(self):
        """Even without ISIN, zero-value asset passes through."""
        from app.engines.openai_universal import merge_extractions

        extraction = M720DocumentExtraction(
            valores=[
                M720Valor(
                    pais_entidad_o_inmueble="CH",
                    moneda_original="CHF",
                    denominacion_entidad_emisora="Some Expired Warrant",
                    saldo_31_diciembre=0.0,
                    numero_valores=0.0,
                )
            ]
        )
        result = merge_extractions([extraction])
        assert len(result.valores) == 1
