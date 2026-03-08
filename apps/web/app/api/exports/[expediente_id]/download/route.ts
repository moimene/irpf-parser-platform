/**
 * GET /api/exports/[expediente_id]/download?model=100|714|720&nif=XXXXXXXX
 *
 * Genera y descarga el fichero AEAT en formato de longitud fija (500 chars/registro).
 * Sprint 4 — Exportación AEAT real.
 */
import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import type { CanonicalAssetRecord, MovableAssetKind } from "@/lib/asset-registry";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { loadModel100Runtime } from "@/lib/model100-runtime";
import { toAeatRecord } from "@/lib/operations";
import { validateModel100 } from "@/lib/rules/validation";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { generateAeatAssetFile, generateAeatFile, type AeatAssetRecord, type AeatRecord } from "@/lib/aeat/format";

export const dynamic = "force-dynamic";

type OperationRow = {
  id: string;
  expediente_id?: string;
  isin: string | null;
  operation_type: string;
  operation_date: string;
  quantity: number | string | null;
  realized_gain: number | string | null;
  description?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  retention?: number | string | null;
  origin_trace?: unknown;
  manual_notes?: string | null;
  source?: "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";
  created_at?: string;
};

type AssetRegistryRow = {
  id: string;
  asset_class: CanonicalAssetRecord["asset_class"];
  clave_condicion: CanonicalAssetRecord["condition_key"];
  tipo_titularidad: string | null;
  clave_tipo_bien: CanonicalAssetRecord["asset_key"];
  subclave: string;
  codigo_pais: string;
  codigo_territorio: string | null;
  clave_situacion: CanonicalAssetRecord["location_key"];
  fecha_incorporacion: string;
  clave_origen: CanonicalAssetRecord["origin_key"];
  fecha_extincion: string | null;
  valoracion_1_eur: number | string | null;
  valoracion_2_eur: number | string | null;
  porcentaje_participacion: number | string | null;
  currency: string | null;
  denominacion_entidad: string | null;
  descripcion_activo: string | null;
  domicilio_via: string | null;
  domicilio_complemento: string | null;
  domicilio_poblacion: string | null;
  domicilio_region: string | null;
  domicilio_codigo_postal: string | null;
  domicilio_pais: string | null;
  metadata: Record<string, unknown> | null;
};

type AccountAssetRow = {
  asset_id: string;
  clave_identif_cuenta: "I" | "O";
  codigo_bic: string | null;
  codigo_cuenta: string;
  nif_entidad_pais: string | null;
};

type SecurityAssetRow = {
  asset_id: string;
  clave_identificacion: "1" | "2";
  identificacion_valores: string;
  nif_entidad_pais: string | null;
  clave_representacion: "A" | "B";
  numero_valores: number | string;
};

type InsuranceAssetRow = {
  asset_id: string;
  insurance_kind: "LIFE" | "DISABILITY" | "TEMPORARY_ANNUITY" | "LIFETIME_ANNUITY";
  nif_entidad_pais: string | null;
};

type RealEstateAssetRow = {
  asset_id: string;
  clave_tipo_inmueble: "U" | "R";
  referencia_catastral: string | null;
};

type MovableAssetRow = {
  asset_id: string;
  clave_tipo_bien_mueble: MovableAssetKind;
  referencia_registro: string | null;
  metodo_valoracion: string | null;
};

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isMissingRelation(errorMessage: string | undefined): boolean {
  return Boolean(errorMessage && /does not exist|relation .* does not exist/i.test(errorMessage));
}

async function loadCanonicalAssetsForExport(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  expedienteId: string
): Promise<AeatAssetRecord[] | null> {
  const baseResult = await supabase
    .from(dbTables.assetRegistry)
    .select(
      [
        "id",
        "asset_class",
        "clave_condicion",
        "tipo_titularidad",
        "clave_tipo_bien",
        "subclave",
        "codigo_pais",
        "codigo_territorio",
        "clave_situacion",
        "fecha_incorporacion",
        "clave_origen",
        "fecha_extincion",
        "valoracion_1_eur",
        "valoracion_2_eur",
        "porcentaje_participacion",
        "currency",
        "denominacion_entidad",
        "descripcion_activo",
        "domicilio_via",
        "domicilio_complemento",
        "domicilio_poblacion",
        "domicilio_region",
        "domicilio_codigo_postal",
        "domicilio_pais",
        "metadata"
      ].join(", ")
    )
    .eq("expediente_id", expedienteId)
    .order("fecha_incorporacion", { ascending: true });

  if (baseResult.error) {
    if (isMissingRelation(baseResult.error.message)) {
      return null;
    }

    throw new Error(`No se pudo cargar el registro canonico: ${baseResult.error.message}`);
  }

  const assetRows = (baseResult.data ?? []) as unknown as AssetRegistryRow[];
  if (assetRows.length === 0) {
    return [];
  }

  const assetIds = assetRows.map((row) => row.id);

  const [
    accountsResult,
    securitiesResult,
    collectiveInvestmentsResult,
    insurancesResult,
    realEstateResult,
    movableGoodsResult
  ] = await Promise.all([
    supabase.from(dbTables.assetAccounts).select("*").in("asset_id", assetIds),
    supabase.from(dbTables.assetSecurities).select("*").in("asset_id", assetIds),
    supabase.from(dbTables.assetCollectiveInvestments).select("*").in("asset_id", assetIds),
    supabase.from(dbTables.assetInsurances).select("*").in("asset_id", assetIds),
    supabase.from(dbTables.assetRealEstate).select("*").in("asset_id", assetIds),
    supabase.from(dbTables.assetMovableGoods).select("*").in("asset_id", assetIds)
  ]);

  const subtypeError = [
    accountsResult.error,
    securitiesResult.error,
    collectiveInvestmentsResult.error,
    insurancesResult.error,
    realEstateResult.error,
    movableGoodsResult.error
  ].find(Boolean);

  if (subtypeError) {
    throw new Error(`No se pudieron cargar los detalles de activos: ${subtypeError.message}`);
  }

  const accounts = new Map(
    ((accountsResult.data ?? []) as unknown as AccountAssetRow[]).map((row) => [row.asset_id, row])
  );
  const securities = new Map(
    ((securitiesResult.data ?? []) as unknown as SecurityAssetRow[]).map((row) => [row.asset_id, row])
  );
  const collectiveInvestments = new Map(
    ((collectiveInvestmentsResult.data ?? []) as unknown as SecurityAssetRow[]).map((row) => [row.asset_id, row])
  );
  const insurances = new Map(
    ((insurancesResult.data ?? []) as unknown as InsuranceAssetRow[]).map((row) => [row.asset_id, row])
  );
  const realEstate = new Map(
    ((realEstateResult.data ?? []) as unknown as RealEstateAssetRow[]).map((row) => [row.asset_id, row])
  );
  const movableGoods = new Map(
    ((movableGoodsResult.data ?? []) as unknown as MovableAssetRow[]).map((row) => [row.asset_id, row])
  );

  return assetRows.map((row) => {
    const account = accounts.get(row.id);
    const security = securities.get(row.id);
    const collective = collectiveInvestments.get(row.id);
    const insurance = insurances.get(row.id);
    const realEstateDetails = realEstate.get(row.id);
    const movable = movableGoods.get(row.id);

    return {
      id: row.id,
      expediente_id: expedienteId,
      asset_class: row.asset_class,
      condition_key: row.clave_condicion,
      ownership_type_description: row.tipo_titularidad,
      asset_key: row.clave_tipo_bien,
      asset_subkey: row.subclave,
      country_code: row.codigo_pais,
      tax_territory_code: row.codigo_territorio,
      location_key: row.clave_situacion,
      incorporation_date: row.fecha_incorporacion,
      origin_key: row.clave_origen,
      extinction_date: row.fecha_extincion,
      valuation_1_eur: toNullableNumber(row.valoracion_1_eur) ?? 0,
      valuation_2_eur: toNullableNumber(row.valoracion_2_eur),
      ownership_percentage: toNullableNumber(row.porcentaje_participacion) ?? 100,
      currency: row.currency,
      entity_name: row.denominacion_entidad,
      asset_description: row.descripcion_activo,
      address: {
        street_line: row.domicilio_via,
        complement: row.domicilio_complemento,
        city: row.domicilio_poblacion,
        region: row.domicilio_region,
        postal_code: row.domicilio_codigo_postal,
        country_code: row.domicilio_pais
      },
      account: account
        ? {
            account_identification_key: account.clave_identif_cuenta,
            bic: account.codigo_bic,
            account_code: account.codigo_cuenta,
            entity_tax_id: account.nif_entidad_pais
          }
        : null,
      security: security
        ? {
            identification_key: security.clave_identificacion,
            security_identifier: security.identificacion_valores,
            entity_tax_id: security.nif_entidad_pais,
            representation_key: security.clave_representacion,
            units: toNullableNumber(security.numero_valores),
            listed: true,
            regulated: true
          }
        : null,
      collective_investment: collective
        ? {
            identification_key: collective.clave_identificacion,
            security_identifier: collective.identificacion_valores,
            entity_tax_id: collective.nif_entidad_pais,
            representation_key: collective.clave_representacion,
            units: toNullableNumber(collective.numero_valores),
            listed: true,
            regulated: true
          }
        : null,
      insurance: insurance
        ? {
            insurance_kind: insurance.insurance_kind,
            entity_tax_id: insurance.nif_entidad_pais
          }
        : null,
      real_estate: realEstateDetails
        ? {
            real_estate_type_key: realEstateDetails.clave_tipo_inmueble,
            cadastral_reference: realEstateDetails.referencia_catastral
          }
        : null,
      movable: movable
        ? {
            movable_kind: movable.clave_tipo_bien_mueble,
            registry_reference: movable.referencia_registro,
            valuation_method: movable.metodo_valoracion
          }
        : null,
      metadata: row.metadata ?? {}
    } satisfies AeatAssetRecord;
  });
}

export async function GET(
  request: Request,
  { params }: { params: { expediente_id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const url = new URL(request.url);
    const modelParam = url.searchParams.get("model") ?? "100";
    const nif = url.searchParams.get("nif") ?? "00000000T";
    const ejercicio = url.searchParams.get("ejercicio") ?? new Date().getFullYear().toString();

    if (!["100", "714", "720"].includes(modelParam)) {
      return NextResponse.json(
        { error: "Parámetro model inválido. Valores: 100, 714, 720" },
        { status: 400 }
      );
    }

    const resolvedExpediente = normalizeExpedienteId(params.expediente_id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "exports.generate");

    const [operationsResult, canonicalAssets, model100Runtime] = await Promise.all([
      modelParam === "100"
        ? Promise.resolve({ data: [] as OperationRow[], error: null })
        : supabase
            .from(dbTables.operations)
            .select(
              "id, expediente_id, isin, operation_type, operation_date, quantity, realized_gain, description, amount, currency, retention, origin_trace, manual_notes, source, created_at"
            )
            .eq("expediente_id", resolvedExpediente.id)
            .order("operation_date", { ascending: true }),
      modelParam === "100"
        ? Promise.resolve(null)
        : loadCanonicalAssetsForExport(supabase, resolvedExpediente.id),
      modelParam === "100"
        ? loadModel100Runtime(supabase, resolvedExpediente.id)
        : Promise.resolve(null)
    ]);

    if (operationsResult.error) {
      return NextResponse.json(
        {
          error: `No se pudieron cargar operaciones: ${operationsResult.error.message}`
        },
        { status: 500 }
      );
    }

    const rows = (operationsResult.data ?? []) as OperationRow[];
    const saleSummaries = model100Runtime?.saleSummaries ?? [];

    if (modelParam === "100") {
      const baseValidation = validateModel100({
        trades: [],
        unresolvedSales: saleSummaries.filter((sale) => sale.status === "UNRESOLVED").length,
        pendingCostBasisSales: saleSummaries.filter((sale) => sale.status === "PENDING_COST_BASIS").length,
        invalidSales: saleSummaries.filter((sale) => sale.status === "INVALID_DATA").length,
        blockedLossesCount: model100Runtime?.blockedLosses.length ?? 0
      });
      const adjustmentIssues = model100Runtime?.issues ?? [];
      const validation =
        adjustmentIssues.length > 0
          ? {
              validationState: "errors" as const,
              messages: [...adjustmentIssues.map((issue) => issue.message), ...baseValidation.messages]
            }
          : baseValidation;

      if (validation.validationState === "errors") {
        return NextResponse.json(
          {
            error: "El modelo 100 tiene ventas no cuadradas o sin coste fiscal y no puede descargarse.",
            messages: validation.messages
          },
          { status: 409 }
        );
      }
    }

    const records: AeatRecord[] =
      modelParam === "100"
        ? saleSummaries.map((summary) => ({
            isin: summary.isin,
            description: summary.description,
            operation_date: summary.operation_date,
            amount: summary.sale_amount,
            currency: summary.currency ?? "EUR",
            quantity: summary.quantity,
            realized_gain: summary.realized_gain,
            operation_type: "VENTA"
          }))
        : rows.map((row) => toAeatRecord(row));

    const fileContent =
      modelParam !== "100" && canonicalAssets && canonicalAssets.length > 0
        ? generateAeatAssetFile(modelParam as "714" | "720", canonicalAssets, nif, ejercicio)
        : generateAeatFile(modelParam as "100" | "714" | "720", records, nif, ejercicio);

    const filename = `MODELO_${modelParam}_${resolvedExpediente.reference}_${ejercicio}.${modelParam}`;

    const exportedItemsCount =
      modelParam !== "100" && canonicalAssets && canonicalAssets.length > 0
        ? canonicalAssets.length
        : records.length;

    await supabase.from(dbTables.auditLog).insert({
        expediente_id: resolvedExpediente.id,
        user_id: sessionUser.reference,
        action: `export.download.${modelParam}`,
      entity_type: "export",
      entity_id: resolvedExpediente.id,
      after_data: {
        filename,
        records_count: exportedItemsCount,
        assets_count: canonicalAssets?.length ?? 0,
        export_source:
          modelParam === "100"
            ? (model100Runtime?.source ?? "irpf_operations")
            : modelParam !== "100" && canonicalAssets && canonicalAssets.length > 0
              ? "irpf_asset_registry"
              : "irpf_operations",
        ejercicio,
        nif_masked: nif.slice(0, 3) + "****" + nif.slice(-1)
      }
    });

    return new Response(fileContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": Buffer.byteLength(fileContent, "utf8").toString(),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo descargar el fichero AEAT") },
      { status: accessErrorStatus(error) }
    );
  }
}
