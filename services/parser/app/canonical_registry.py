from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.schemas import ParsedRecord


ASSET_RECORD_TYPES = {
    "CUENTA",
    "CUENTA_BANCARIA",
    "VALOR",
    "IIC",
    "SEGURO",
    "INMUEBLE",
    "BIEN_MUEBLE",
    "POSICION",
}

EVENT_RECORD_TYPES = {
    "DIVIDENDO",
    "INTERES",
    "RENTA",
    "RETENCION",
    "COMPRA",
    "VENTA",
}

CAPITAL_OPERATION_CATALOG: Dict[str, Dict[str, str]] = {
    "DIVIDENDO_ACCION": {"irpf_group": "RCM", "irpf_subgroup": "DIVIDENDOS"},
    "DIVIDENDO_FONDO": {"irpf_group": "RCM", "irpf_subgroup": "DIVIDENDOS"},
    "INTERES_CUENTA": {"irpf_group": "RCM", "irpf_subgroup": "INTERESES"},
    "INTERES_BONO": {"irpf_group": "RCM", "irpf_subgroup": "INTERESES"},
    "CUPON_BONO": {"irpf_group": "RCM", "irpf_subgroup": "INTERESES"},
    "REND_SEGURO_VIDA": {"irpf_group": "RCM", "irpf_subgroup": "SEGUROS"},
    "RENTA_VITALICIA": {"irpf_group": "RCM", "irpf_subgroup": "RENTAS"},
    "COMPRA_VALOR": {"irpf_group": "GYP", "irpf_subgroup": "ACCIONES"},
    "VENTA_VALOR": {"irpf_group": "GYP", "irpf_subgroup": "ACCIONES"},
    "COMPRA_FONDO": {"irpf_group": "GYP", "irpf_subgroup": "FONDOS"},
    "VENTA_FONDO": {"irpf_group": "GYP", "irpf_subgroup": "FONDOS"},
    "ALQUILER_INMUEBLE": {"irpf_group": "RCM", "irpf_subgroup": "INMUEBLES"},
    "COMPRA_INMUEBLE": {"irpf_group": "GYP", "irpf_subgroup": "INMUEBLES"},
    "VENTA_INMUEBLE": {"irpf_group": "GYP", "irpf_subgroup": "INMUEBLES"},
    "COMPRA_BIEN_MUEBLE": {"irpf_group": "GYP", "irpf_subgroup": "BIENES_MUEBLES"},
    "VENTA_BIEN_MUEBLE": {"irpf_group": "GYP", "irpf_subgroup": "BIENES_MUEBLES"},
    "RETENCION_MANUAL": {"irpf_group": "RCM", "irpf_subgroup": "RETENCIONES"},
    "OTRO_MOVIMIENTO": {"irpf_group": "OTRO", "irpf_subgroup": "OTRO"},
}


def _read_str(payload: Dict[str, Any], key: str) -> Optional[str]:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _read_num(payload: Dict[str, Any], key: str) -> Optional[float]:
    value = payload.get(key)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _normalize_date(value: Optional[str]) -> str:
    if value and len(value) == 10 and value[4] == "-" and value[7] == "-":
        return value
    return "1970-01-01"


def _normalize_country_code(value: Optional[str]) -> str:
    return (value or "ES").strip().upper() or "ES"


def _normalize_upper(value: Optional[str]) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip().upper()
    return None


def _normalize_location(value: Optional[str], country_code: str) -> str:
    if value in {"ES", "EX"}:
        return value
    return "ES" if country_code == "ES" else "EX"


def _asset_link_key(asset: Dict[str, Any]) -> str:
    identifier = (
        asset.get("security", {}).get("security_identifier")
        or asset.get("collective_investment", {}).get("security_identifier")
        or asset.get("account", {}).get("account_code")
        or asset.get("real_estate", {}).get("cadastral_reference")
        or asset.get("movable", {}).get("registry_reference")
        or asset.get("asset_description")
        or asset.get("entity_name")
        or "UNKNOWN"
    )


def _normalize_movable_kind(value: Optional[str]) -> str:
    normalized = (_normalize_upper(value) or "").replace(" ", "_").replace("-", "_")
    if normalized in {"A", "ART", "ARTWORK", "OBJETOS_DE_ARTE"}:
        return "ART"
    if normalized in {"J", "JEWELRY", "JOYAS"}:
        return "JEWELRY"
    if normalized in {"V", "VEHICLE", "VEHICULO", "VEHICULOS"}:
        return "VEHICLE"
    if normalized in {"E", "BOAT", "EMBARCACION", "EMBARCACIONES_Y_AERONAVES"}:
        return "BOAT"
    if normalized in {"AIRCRAFT", "AERONAVE"}:
        return "AIRCRAFT"
    if normalized in {"COLLECTION", "COLECCION"}:
        return "COLLECTION"
    if normalized in {"C", "ADMINISTRATIVE_CONCESSION", "CONCESION_ADMINISTRATIVA"}:
        return "ADMINISTRATIVE_CONCESSION"
    if normalized in {"N", "CONTRACT_OPTION", "OPCION_CONTRACTUAL"}:
        return "CONTRACT_OPTION"
    if normalized in {
        "D",
        "INTELLECTUAL_PROPERTY",
        "DERECHO_PROPIEDAD_INTELECTUAL",
        "DERECHO_PROPIEDAD_INDUSTRIAL",
    }:
        return "INTELLECTUAL_PROPERTY"
    if normalized in {"R", "REGISTERED_MOVABLE", "MUEBLE_MATRICULADO"}:
        return "REGISTERED_MOVABLE"
    if normalized in {"M", "LOCATED_MOVABLE", "MUEBLE_SITUADO"}:
        return "LOCATED_MOVABLE"
    if normalized == "GENERAL":
        return "GENERAL"
    return "OTHER"


def _infer_asset_key_for_event(record_type: str, asset: Optional[Dict[str, Any]], fields: Dict[str, Any]) -> Optional[str]:
    explicit_asset_key = _read_str(fields, "asset_key")
    if explicit_asset_key:
        return explicit_asset_key

    if asset:
        return str(asset.get("asset_key") or "")

    if record_type == "INTERES" and (_read_str(fields, "account_code") or _read_str(fields, "bic")):
        return "C"

    if record_type == "RENTA":
        if _read_str(fields, "insurance_kind"):
            return "S"
        if (
            _read_str(fields, "real_estate_type_key")
            or _read_str(fields, "clave_tipo_inmueble")
            or _read_str(fields, "cadastral_reference")
        ):
            return "B"
        if (
            _read_str(fields, "movable_kind")
            or _read_str(fields, "clave_tipo_bien_mueble")
            or _read_str(fields, "clave_tipo_inmueble_mueble")
        ):
            return "M"

    if _read_str(fields, "isin") or _read_str(fields, "security_identifier"):
        return "V"

    return None


def _default_capital_operation_key(event_type: str, asset_key: Optional[str], fields: Dict[str, Any]) -> str:
    explicit_key = _read_str(fields, "capital_operation_key")
    if explicit_key:
        return explicit_key

    if event_type == "ACQUISITION":
        if asset_key == "I":
            return "COMPRA_FONDO"
        if asset_key == "B":
            return "COMPRA_INMUEBLE"
        if asset_key == "M":
            return "COMPRA_BIEN_MUEBLE"
        return "COMPRA_VALOR"

    if event_type == "DISPOSAL":
        if asset_key == "I":
            return "VENTA_FONDO"
        if asset_key == "B":
            return "VENTA_INMUEBLE"
        if asset_key == "M":
            return "VENTA_BIEN_MUEBLE"
        return "VENTA_VALOR"

    if event_type == "DIVIDEND":
        return "DIVIDENDO_FONDO" if asset_key == "I" else "DIVIDENDO_ACCION"

    if event_type == "INTEREST":
        if fields.get("is_coupon") or _read_str(fields, "coupon_type"):
            return "CUPON_BONO"
        return "INTERES_BONO" if asset_key == "V" else "INTERES_CUENTA"

    if event_type == "RENT":
        if asset_key == "S":
            insurance_kind = _normalize_upper(_read_str(fields, "insurance_kind"))
            return "REND_SEGURO_VIDA" if insurance_kind and "LIFE" in insurance_kind else "RENTA_VITALICIA"
        return "ALQUILER_INMUEBLE" if asset_key == "B" else "OTRO_MOVIMIENTO"

    if event_type == "WITHHOLDING":
        return "RETENCION_MANUAL"

    return "OTRO_MOVIMIENTO"


def _derive_operation_amounts(event_type: str, fields: Dict[str, Any]) -> Dict[str, Optional[float]]:
    amount = _read_num(fields, "gross_amount_eur") or _read_num(fields, "amount")
    retention = _read_num(fields, "withholding_amount_eur") or _read_num(fields, "retention")
    expenses = (
        _read_num(fields, "expense_amount_eur")
        or _read_num(fields, "fees")
        or _read_num(fields, "gastos")
    )
    quantity = _read_num(fields, "quantity")
    proceeds = _read_num(fields, "proceeds_amount_eur") or (amount if event_type == "DISPOSAL" else None)
    unit_price = (
        _read_num(fields, "unit_price_eur")
        or _read_num(fields, "price_unit_eur")
        or _read_num(fields, "precio_unitario_eur")
    )
    if unit_price is None and event_type in {"ACQUISITION", "DISPOSAL"} and quantity and quantity > 0 and amount is not None:
        unit_price = amount / quantity

    gross_amount = None if event_type == "WITHHOLDING" else amount

    return {
        "gross_amount_eur": gross_amount,
        "net_amount_eur": gross_amount - (retention or 0.0) - (expenses or 0.0) if gross_amount is not None else None,
        "withholding_amount_eur": amount if event_type == "WITHHOLDING" else retention,
        "proceeds_amount_eur": proceeds,
        "cost_basis_amount_eur": _read_num(fields, "cost_basis_amount_eur"),
        "realized_result_eur": _read_num(fields, "realized_result_eur")
        or _read_num(fields, "realized_gain"),
        "expense_amount_eur": expenses,
        "gross_amount_original": _read_num(fields, "gross_amount_original")
        or _read_num(fields, "amount_original"),
        "fx_rate": _read_num(fields, "fx_rate") or _read_num(fields, "tipo_cambio"),
        "unit_price_eur": unit_price,
    }
    return "|".join(
        [
            str(asset.get("asset_class", "UNKNOWN")),
            str(asset.get("asset_key", "X")),
            str(asset.get("asset_subkey", "0")),
            str(asset.get("country_code", "ES")),
            str(identifier).strip().upper(),
        ]
    )


def _derive_asset_from_record(record: ParsedRecord) -> Optional[Dict[str, Any]]:
    if record.record_type not in ASSET_RECORD_TYPES:
        return None

    fields = record.fields
    country_code = _normalize_country_code(
        _read_str(fields, "country_code") or _read_str(fields, "codigo_pais")
    )
    location_key = _normalize_location(
        _read_str(fields, "location_key") or _read_str(fields, "clave_situacion"),
        country_code,
    )

    asset_class: Optional[str] = None
    if record.record_type in {"CUENTA", "CUENTA_BANCARIA"}:
        asset_class = "ACCOUNT"
    elif record.record_type == "VALOR":
        asset_class = "SECURITY"
    elif record.record_type == "IIC":
        asset_class = "COLLECTIVE_INVESTMENT"
    elif record.record_type == "SEGURO":
        asset_class = "INSURANCE"
    elif record.record_type == "INMUEBLE":
        asset_class = "REAL_ESTATE"
    elif record.record_type == "BIEN_MUEBLE":
        asset_class = "MOVABLE_ASSET"
    elif record.record_type == "POSICION":
        asset_class = "ACCOUNT" if _read_str(fields, "account_code") else "SECURITY"

    if not asset_class:
        return None

    asset_key_by_class = {
        "ACCOUNT": "C",
        "SECURITY": "V",
        "COLLECTIVE_INVESTMENT": "I",
        "INSURANCE": "S",
        "REAL_ESTATE": "B",
        "MOVABLE_ASSET": "M",
    }
    asset_subkey_by_class = {
        "ACCOUNT": "5",
        "SECURITY": "1",
        "COLLECTIVE_INVESTMENT": "0",
        "INSURANCE": "1",
        "REAL_ESTATE": "1",
        "MOVABLE_ASSET": "1",
    }

    asset: Dict[str, Any] = {
        "asset_class": asset_class,
        "condition_key": _read_str(fields, "condition_key") or "1",
        "asset_key": _read_str(fields, "asset_key") or asset_key_by_class[asset_class],
        "asset_subkey": _read_str(fields, "asset_subkey") or asset_subkey_by_class[asset_class],
        "country_code": country_code,
        "location_key": location_key,
        "tax_territory_code": _read_str(fields, "tax_territory_code") or "ES-COMUN",
        "incorporation_date": _normalize_date(
            _read_str(fields, "incorporation_date")
            or _read_str(fields, "operation_date")
            or _read_str(fields, "event_date")
        ),
        "origin_key": _read_str(fields, "origin_key") or "A",
        "valuation_1_eur": _read_num(fields, "valuation_1_eur")
        or _read_num(fields, "amount")
        or 0.0,
        "valuation_2_eur": _read_num(fields, "valuation_2_eur"),
        "ownership_percentage": _read_num(fields, "ownership_percentage") or 100.0,
        "currency": _read_str(fields, "currency"),
        "entity_name": _read_str(fields, "entity_name"),
        "asset_description": _read_str(fields, "asset_description")
        or _read_str(fields, "description"),
        "metadata": {"source_record_type": record.record_type},
    }

    if asset_class == "ACCOUNT":
        asset["account"] = {
            "account_identification_key": _read_str(fields, "account_identification_key")
            or _read_str(fields, "clave_identif_cuenta")
            or "O",
            "bic": _read_str(fields, "bic") or _read_str(fields, "codigo_bic"),
            "account_code": _read_str(fields, "account_code")
            or _read_str(fields, "codigo_cuenta"),
            "entity_tax_id": _read_str(fields, "entity_tax_id")
            or _read_str(fields, "nif_entidad_pais"),
        }
    elif asset_class == "SECURITY":
        asset["security"] = {
            "identification_key": _read_str(fields, "identification_key")
            or ("1" if _read_str(fields, "isin") else "2"),
            "security_identifier": _read_str(fields, "security_identifier")
            or _read_str(fields, "identificacion_valores")
            or _read_str(fields, "isin")
            or _read_str(fields, "description"),
            "entity_tax_id": _read_str(fields, "entity_tax_id")
            or _read_str(fields, "nif_entidad_pais"),
            "representation_key": _read_str(fields, "representation_key")
            or _read_str(fields, "clave_representacion")
            or "A",
            "units": _read_num(fields, "quantity") or _read_num(fields, "numero_valores"),
            "listed": True,
            "regulated": True,
        }
    elif asset_class == "COLLECTIVE_INVESTMENT":
        asset["collective_investment"] = {
            "identification_key": _read_str(fields, "identification_key")
            or ("1" if _read_str(fields, "isin") else "2"),
            "security_identifier": _read_str(fields, "security_identifier")
            or _read_str(fields, "identificacion_valores")
            or _read_str(fields, "isin")
            or _read_str(fields, "description"),
            "entity_tax_id": _read_str(fields, "entity_tax_id")
            or _read_str(fields, "nif_entidad_pais"),
            "representation_key": _read_str(fields, "representation_key")
            or _read_str(fields, "clave_representacion")
            or "A",
            "units": _read_num(fields, "quantity") or _read_num(fields, "numero_valores"),
            "listed": True,
            "regulated": True,
        }
    elif asset_class == "INSURANCE":
        asset["insurance"] = {
            "insurance_kind": _read_str(fields, "insurance_kind") or "LIFE",
            "entity_tax_id": _read_str(fields, "entity_tax_id")
            or _read_str(fields, "nif_entidad_pais"),
        }
    elif asset_class == "REAL_ESTATE":
        asset["real_estate"] = {
            "real_estate_type_key": _read_str(fields, "real_estate_type_key")
            or _read_str(fields, "clave_tipo_inmueble")
            or "U",
            "real_right_description": _read_str(fields, "real_right_description")
            or _read_str(fields, "tipo_derecho_real"),
            "cadastral_reference": _read_str(fields, "cadastral_reference")
            or _read_str(fields, "referencia_catastral"),
        }
    elif asset_class == "MOVABLE_ASSET":
        asset["movable"] = {
            "movable_kind": _normalize_movable_kind(
                _read_str(fields, "movable_kind")
                or _read_str(fields, "clave_tipo_bien_mueble")
                or _read_str(fields, "clave_tipo_inmueble_mueble")
            ),
            "registry_reference": _read_str(fields, "registry_reference")
            or _read_str(fields, "referencia_registro"),
            "valuation_method": _read_str(fields, "valuation_method")
            or _read_str(fields, "metodo_valoracion"),
        }

    asset["asset_link_key"] = _asset_link_key(asset)
    return asset


def _derive_asset_from_event_record(record: ParsedRecord) -> Optional[Dict[str, Any]]:
    if record.record_type not in EVENT_RECORD_TYPES:
        return None

    fields = record.fields
    if not (
        _read_str(fields, "isin")
        or _read_str(fields, "security_identifier")
        or _read_str(fields, "account_code")
        or _read_str(fields, "description")
        or _read_str(fields, "insurance_kind")
        or _read_str(fields, "real_estate_type_key")
        or _read_str(fields, "clave_tipo_inmueble")
        or _read_str(fields, "movable_kind")
        or _read_str(fields, "clave_tipo_bien_mueble")
    ):
        return None

    inferred_asset_key = _infer_asset_key_for_event(record.record_type, None, fields)
    synthetic_type = {
        "C": "CUENTA",
        "I": "IIC",
        "S": "SEGURO",
        "B": "INMUEBLE",
        "M": "BIEN_MUEBLE",
    }.get(inferred_asset_key, "VALOR")

    synthetic_record = ParsedRecord(
        record_type=synthetic_type,  # type: ignore[arg-type]
        fields=fields,
        confidence=record.confidence,
        source_spans=record.source_spans,
    )
    derived = _derive_asset_from_record(synthetic_record)
    if derived:
        derived.setdefault("metadata", {})
        derived["metadata"]["inferred_from_event"] = True
    return derived


def _event_type(record_type: str) -> Optional[str]:
    return {
        "COMPRA": "ACQUISITION",
        "VENTA": "DISPOSAL",
        "DIVIDENDO": "DIVIDEND",
        "INTERES": "INTEREST",
        "RENTA": "RENT",
        "RETENCION": "WITHHOLDING",
    }.get(record_type)


def _derive_event_from_record(record: ParsedRecord, asset: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    event_type = _event_type(record.record_type)
    if not event_type:
        return None

    fields = record.fields
    asset_key = _infer_asset_key_for_event(record.record_type, asset, fields)
    capital_operation_key = _default_capital_operation_key(event_type, asset_key, fields)
    catalog_entry = CAPITAL_OPERATION_CATALOG.get(capital_operation_key, CAPITAL_OPERATION_CATALOG["OTRO_MOVIMIENTO"])
    derived_amounts = _derive_operation_amounts(event_type, fields)
    currency = _normalize_upper(_read_str(fields, "currency"))
    original_currency = _normalize_upper(_read_str(fields, "original_currency"))
    if original_currency is None and derived_amounts["gross_amount_original"] is not None:
        original_currency = currency

    return {
        "asset_link_key": asset.get("asset_link_key") if asset else None,
        "event_type": event_type,
        "event_date": _normalize_date(
            _read_str(fields, "event_date")
            or _read_str(fields, "operation_date")
            or _read_str(fields, "incorporation_date")
        ),
        "capital_operation_key": capital_operation_key,
        "irpf_group": catalog_entry["irpf_group"],
        "irpf_subgroup": catalog_entry["irpf_subgroup"],
        "quantity": _read_num(fields, "quantity"),
        "gross_amount_eur": derived_amounts["gross_amount_eur"],
        "net_amount_eur": derived_amounts["net_amount_eur"],
        "withholding_amount_eur": derived_amounts["withholding_amount_eur"],
        "proceeds_amount_eur": derived_amounts["proceeds_amount_eur"],
        "cost_basis_amount_eur": derived_amounts["cost_basis_amount_eur"],
        "realized_result_eur": derived_amounts["realized_result_eur"],
        "currency": currency,
        "expense_amount_eur": derived_amounts["expense_amount_eur"],
        "original_currency": original_currency,
        "gross_amount_original": derived_amounts["gross_amount_original"],
        "fx_rate": derived_amounts["fx_rate"],
        "unit_price_eur": derived_amounts["unit_price_eur"],
        "is_closing_operation": bool(fields.get("is_closing_operation") or fields.get("es_operacion_cierre")),
        "is_stock_dividend": bool(fields.get("is_stock_dividend") or fields.get("es_dividendo_en_acciones")),
        "irpf_box_code": _read_str(fields, "irpf_box_code") or _read_str(fields, "codigo_irpf_casilla"),
        "notes": _read_str(fields, "description"),
    }


def derive_canonical_registry(records: List[ParsedRecord]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    assets_by_key: Dict[str, Dict[str, Any]] = {}
    events: List[Dict[str, Any]] = []
    seen_event_keys = set()

    for record in records:
        asset = _derive_asset_from_record(record) or _derive_asset_from_event_record(record)
        asset_link_key: Optional[str] = None
        if asset:
            asset_link_key = str(asset["asset_link_key"])
            assets_by_key.setdefault(asset_link_key, asset)

        event = _derive_event_from_record(record, asset)
        if event:
            event_key = "|".join(
                [
                    str(event.get("event_type") or ""),
                    str(event.get("capital_operation_key") or ""),
                    str(event.get("event_date") or ""),
                    str(event.get("asset_link_key") or ""),
                    str(event.get("quantity") or ""),
                    str(event.get("gross_amount_eur") or ""),
                    str(event.get("withholding_amount_eur") or ""),
                    str(event.get("unit_price_eur") or ""),
                ]
            )
            if event_key not in seen_event_keys:
                seen_event_keys.add(event_key)
                events.append(event)

    return list(assets_by_key.values()), events
