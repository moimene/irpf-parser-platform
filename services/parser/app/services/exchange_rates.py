"""
BCE Exchange Rate Service — Tipos de cambio del Banco Central Europeo.

Carga el CSV histórico del Banco de España/BCE con tipos de cambio diarios
de 33 divisas contra EUR. Usado para convertir importes en moneda original
a EUR usando el tipo de cambio oficial al 31 de diciembre del ejercicio fiscal.

El CSV es normativo e histórico — nunca cambia en tiempo real.
Se actualiza manualmente una vez al año cuando el BCE publica los datos del nuevo ejercicio.
"""
from __future__ import annotations

import csv
import logging
import re
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# Path al CSV embebido
_DEFAULT_CSV_PATH = Path(__file__).parent.parent / "data" / "tc_1_1.csv"


class BCEExchangeRateService:
    """Servicio de tipos de cambio BCE para conversión a EUR."""

    def __init__(self, csv_path: Path | str = _DEFAULT_CSV_PATH) -> None:
        self._rates: Dict[str, Dict[str, float]] = {}
        self._currencies: list[str] = []
        self._load_csv(Path(csv_path))

    def _load_csv(self, csv_path: Path) -> None:
        """Parsea el CSV del Banco de España.

        Structure:
          Row 1: CÓDIGO DE LA SERIE (series codes)
          Row 2: NÚMERO SECUENCIAL
          Row 3: ALIAS DE LA SERIE
          Row 4: DESCRIPCIÓN DE LA SERIE — contains (XXX/EUR) currency codes
          Row 5: DESCRIPCIÓN DE LAS UNIDADES
          Row 6: FRECUENCIA
          Row 7+: Data rows — "DD MMM YYYY", rate1, rate2, ...
        """
        if not csv_path.exists():
            logger.error("BCE CSV not found: %s", csv_path)
            return

        with open(csv_path, "r", encoding="latin-1") as f:
            reader = csv.reader(f)
            rows = list(reader)

        if len(rows) < 7:
            logger.error("BCE CSV too short: %d rows", len(rows))
            return

        # Extract currency codes from row 4 (description row, 0-indexed index 3)
        desc_row = rows[3]  # DESCRIPCIÓN DE LA SERIE
        self._currencies = []
        currency_re = re.compile(r"\(([A-Z]{3})/EUR\)")
        for i, cell in enumerate(desc_row):
            if i == 0:
                continue  # Skip label column
            match = currency_re.search(cell)
            if match:
                self._currencies.append(match.group(1))
            else:
                self._currencies.append(f"COL{i}")  # Fallback

        # Parse data rows (index 6+)
        for row in rows[6:]:
            if not row or not row[0].strip():
                continue
            date_str = row[0].strip().strip('"')
            rates: Dict[str, float] = {}
            for col_idx, currency in enumerate(self._currencies):
                cell_idx = col_idx + 1  # Skip date column
                if cell_idx >= len(row):
                    continue
                val = row[cell_idx].strip().strip('"')
                if val == "_" or not val:
                    continue  # Unavailable
                try:
                    rates[currency] = float(val.replace(",", "."))
                except ValueError:
                    continue
            if rates:
                self._rates[date_str] = rates

        logger.info(
            "BCE CSV loaded: %d dates, %d currencies (%s)",
            len(self._rates),
            len(self._currencies),
            ", ".join(self._currencies[:5]) + "...",
        )

    def get_rate(self, ejercicio: int, moneda: str) -> Optional[float]:
        """Returns TC at 31/dic of given year for given currency.

        EUR → 1.0 always.
        "_" in CSV or missing → None.
        Weekend/holiday: searches backward from 31 to 26 DIC.
        """
        if moneda.upper() == "EUR":
            return 1.0

        currency = moneda.upper()

        # Try 31 DIC, then 30, 29, ... 26 (covers long weekends)
        for day in range(31, 25, -1):
            # CSV uses no leading zero: "31 DIC 2024", "29 DIC 2023"
            date_key = f"{day} DIC {ejercicio}"
            if date_key in self._rates:
                rate = self._rates[date_key].get(currency)
                if rate is not None:
                    return rate

            # Also try with leading zero just in case
            date_key_padded = f"{day:02d} DIC {ejercicio}"
            if date_key_padded in self._rates:
                rate = self._rates[date_key_padded].get(currency)
                if rate is not None:
                    return rate

        return None

    def convert_to_eur(
        self, amount: float, ejercicio: int, moneda: str
    ) -> Tuple[Optional[float], Optional[float]]:
        """Convert amount in foreign currency to EUR.

        Returns (amount_eur, tc_applied) or (None, None) if TC unavailable.
        For EUR: returns (amount, 1.0).

        BCE rates are "units of foreign currency per 1 EUR".
        So: EUR_amount = foreign_amount / tc
        """
        if moneda.upper() == "EUR":
            return amount, 1.0

        tc = self.get_rate(ejercicio, moneda)
        if tc is None:
            return None, None

        amount_eur = round(amount / tc, 2)
        return amount_eur, tc


# Singleton — loaded once at import
bce_rates = BCEExchangeRateService()
