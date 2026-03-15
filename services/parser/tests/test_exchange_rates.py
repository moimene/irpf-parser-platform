"""Tests for BCE exchange rate service."""
import pytest


def test_eur_always_returns_1():
    """EUR→EUR is always 1.0 regardless of year."""
    from app.services.exchange_rates import bce_rates
    assert bce_rates.get_rate(2024, "EUR") == 1.0
    assert bce_rates.get_rate(2020, "EUR") == 1.0


def test_usd_rate_2024():
    """USD/EUR at 31 DIC 2024 = 1.0389 (from CSV)."""
    from app.services.exchange_rates import bce_rates
    rate = bce_rates.get_rate(2024, "USD")
    assert rate is not None
    assert abs(rate - 1.0389) < 0.0001


def test_chf_rate_2024():
    """CHF/EUR at 31 DIC 2024 = 0.9412 (from CSV)."""
    from app.services.exchange_rates import bce_rates
    rate = bce_rates.get_rate(2024, "CHF")
    assert rate is not None
    assert abs(rate - 0.9412) < 0.0001


def test_gbp_rate_2024():
    """GBP/EUR at 31 DIC 2024 = 0.82918 (from CSV)."""
    from app.services.exchange_rates import bce_rates
    rate = bce_rates.get_rate(2024, "GBP")
    assert rate is not None
    assert abs(rate - 0.82918) < 0.00001


def test_unavailable_currency_returns_none():
    """RUB post-2022 shows '_' in CSV → None."""
    from app.services.exchange_rates import bce_rates
    rate = bce_rates.get_rate(2024, "RUB")
    assert rate is None


def test_unknown_currency_returns_none():
    """Currency not in BCE CSV → None."""
    from app.services.exchange_rates import bce_rates
    assert bce_rates.get_rate(2024, "XYZ") is None


def test_weekend_fallback():
    """31 DIC 2023 was Sunday. Should fall back to 29 DIC 2023 (Friday)."""
    from app.services.exchange_rates import bce_rates
    rate = bce_rates.get_rate(2023, "USD")
    # Should find a rate (from 29 DIC 2023), not None
    assert rate is not None
    assert rate > 0


def test_case_insensitive_currency():
    """Currency codes should be case-insensitive."""
    from app.services.exchange_rates import bce_rates
    assert bce_rates.get_rate(2024, "usd") == bce_rates.get_rate(2024, "USD")


def test_convert_to_eur_usd():
    """Convert 1000 USD to EUR at 31 DIC 2024."""
    from app.services.exchange_rates import bce_rates
    amount_eur, tc = bce_rates.convert_to_eur(1000.0, 2024, "USD")
    assert tc is not None
    assert abs(tc - 1.0389) < 0.0001
    # 1000 USD / 1.0389 = ~962.75 EUR
    assert amount_eur is not None
    assert abs(amount_eur - 1000.0 / 1.0389) < 0.01


def test_convert_to_eur_eur():
    """EUR→EUR conversion: amount unchanged, tc=1.0."""
    from app.services.exchange_rates import bce_rates
    amount_eur, tc = bce_rates.convert_to_eur(5000.0, 2024, "EUR")
    assert amount_eur == 5000.0
    assert tc == 1.0


def test_convert_to_eur_unavailable():
    """Unavailable currency → (None, None)."""
    from app.services.exchange_rates import bce_rates
    amount_eur, tc = bce_rates.convert_to_eur(1000.0, 2024, "RUB")
    assert amount_eur is None
    assert tc is None


def test_year_2025():
    """31 DIC 2025 rates exist in CSV."""
    from app.services.exchange_rates import bce_rates
    rate = bce_rates.get_rate(2025, "USD")
    assert rate is not None
    assert abs(rate - 1.1750) < 0.0001


def test_year_2020():
    """31 DIC 2020 rates exist in CSV."""
    from app.services.exchange_rates import bce_rates
    rate = bce_rates.get_rate(2020, "USD")
    assert rate is not None
    assert abs(rate - 1.2271) < 0.0001
