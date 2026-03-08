import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { isExportModel, type ExportModel } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { loadModel100Runtime } from "@/lib/model100-runtime";
import { validateModel100, validateModel714, validateModel720 } from "@/lib/rules/validation";
import { sha256 } from "@/lib/hash";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface AssetValidationRow {
  id: string;
  clave_tipo_bien: string;
  clave_situacion: "ES" | "EX";
  codigo_pais: string;
  valoracion_1_eur: number | string | null;
  porcentaje_participacion: number | string | null;
}

function toModelExtension(model: ExportModel): string {
  return model;
}

function isMissingRelation(errorMessage: string | undefined): boolean {
  return Boolean(errorMessage && /does not exist|relation .* does not exist/i.test(errorMessage));
}

async function loadCanonicalAssetValidationRows(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<AssetValidationRow[] | null> {
  const result = await supabase
    .from(dbTables.assetRegistry)
    .select("id, clave_tipo_bien, clave_situacion, codigo_pais, valoracion_1_eur, porcentaje_participacion")
    .eq("expediente_id", expedienteId);

  if (result.error) {
    if (isMissingRelation(result.error.message)) {
      return null;
    }

    throw new Error(`No se pudo cargar el registro canonico de activos: ${result.error.message}`);
  }

  return (result.data ?? []) as AssetValidationRow[];
}

export async function GET(request: Request, context: { params: { expediente_id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(context.params.expediente_id);
    const searchParams = new URL(request.url).searchParams;
    const modelCandidate = searchParams.get("model") ?? "100";

    if (!isExportModel(modelCandidate)) {
      return NextResponse.json(
        {
          error: "Parametro model invalido. Valores permitidos: 100, 714, 720"
        },
        { status: 400 }
      );
    }

    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "exports.generate");

    const model = modelCandidate;
    const generatedAt = new Date().toISOString();
    const { error: expedienteError } = await supabase.from(dbTables.expedientes).upsert(
      {
        id: resolvedExpediente.id,
        reference: resolvedExpediente.reference,
        fiscal_year: new Date().getFullYear(),
        model_type: model === "100" ? "IRPF" : model === "714" ? "IP" : "720",
        title: `Expediente ${resolvedExpediente.reference}`,
        status: "EN_REVISION"
      },
      { onConflict: "id" }
    );

    if (expedienteError) {
      return NextResponse.json(
        {
          error: `No se pudo garantizar expediente para exportacion: ${expedienteError.message}`
        },
        { status: 500 }
      );
    }

    const artifactPath = `exports/${resolvedExpediente.id}/MODELO_${model}_${generatedAt.slice(0, 10)}.${toModelExtension(
      model
    )}`;

    const [model100Runtime, canonicalAssetRows] = await Promise.all([
      model === "100" ? loadModel100Runtime(supabase, resolvedExpediente.id) : Promise.resolve(null),
      model === "100" ? Promise.resolve(null) : loadCanonicalAssetValidationRows(supabase, resolvedExpediente.id)
    ]);

    const baseValidation =
      model === "100"
        ? validateModel100({
            trades: [],
            unresolvedSales:
              model100Runtime?.saleSummaries.filter((sale) => sale.status === "UNRESOLVED").length ?? 0,
            pendingCostBasisSales:
              model100Runtime?.saleSummaries.filter((sale) => sale.status === "PENDING_COST_BASIS").length ?? 0,
            invalidSales:
              model100Runtime?.saleSummaries.filter((sale) => sale.status === "INVALID_DATA").length ?? 0,
            blockedLossesCount: model100Runtime?.blockedLosses.length ?? 0
          })
        : model === "714"
          ? validateModel714(
              canonicalAssetRows
                ? {
                    totalAssets: canonicalAssetRows.length,
                    invalidAssetCount: canonicalAssetRows.filter(
                      (asset) =>
                        !asset.clave_tipo_bien ||
                        (asset.clave_situacion === "ES" && asset.codigo_pais !== "ES")
                    ).length,
                    missingValuationCount: canonicalAssetRows.filter(
                      (asset) => asset.valoracion_1_eur === null || Number(asset.valoracion_1_eur) <= 0
                    ).length,
                    missingClassificationCount: canonicalAssetRows.filter((asset) => !asset.clave_tipo_bien).length
                  }
                : undefined
            )
          : validateModel720(
              canonicalAssetRows
                ? {
                    totalAssets: canonicalAssetRows.length,
                    foreignAssets: canonicalAssetRows.filter(
                      (asset) => asset.clave_situacion === "EX" && asset.codigo_pais !== "ES"
                    ).length,
                    invalidForeignAssetCount: canonicalAssetRows.filter(
                      (asset) => asset.clave_situacion === "EX" && (!asset.clave_tipo_bien || asset.codigo_pais === "ES")
                    ).length,
                    missingCountryCount: canonicalAssetRows.filter((asset) => !asset.codigo_pais).length,
                    missingOwnershipCount: canonicalAssetRows.filter(
                      (asset) =>
                        asset.porcentaje_participacion === null ||
                        Number(asset.porcentaje_participacion) <= 0
                    ).length
                  }
                : undefined
            );

    const adjustmentIssues =
      model === "100"
        ? (model100Runtime?.issues ?? [])
        : [];

    const validation =
      adjustmentIssues.length > 0
        ? {
            validationState: "errors" as const,
            messages: [...adjustmentIssues.map((issue) => issue.message), ...baseValidation.messages]
          }
        : baseValidation;

    const artifactHash = sha256(
      JSON.stringify({
        expedienteId: resolvedExpediente.id,
        model,
        generatedAt,
        validation,
        sales: model100Runtime?.saleSummaries.length ?? 0,
        runtimeSource: model100Runtime?.source ?? null,
        assets: canonicalAssetRows?.length ?? 0
      })
    );

    const payload = {
      expediente_id: resolvedExpediente.id,
      expediente_reference: resolvedExpediente.reference,
      model,
      status: "generated" as const,
      validation_state: validation.validationState,
      artifact_path: artifactPath,
      artifact_hash: artifactHash,
      generated_at: generatedAt,
      messages: validation.messages,
      runtime_source: model100Runtime?.source ?? null,
      blocked_losses: model100Runtime?.blockedLosses ?? [],
      runtime_issues: adjustmentIssues,
      assets_count: canonicalAssetRows?.length ?? 0,
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      }
    };

    const exportId = crypto.randomUUID();

    const { error: exportError } = await supabase.from(dbTables.exports).insert({
      id: exportId,
      expediente_id: resolvedExpediente.id,
      model,
      status: payload.status,
      validation_state: payload.validation_state,
      artifact_path: artifactPath,
      artifact_hash: artifactHash,
      generated_at: generatedAt,
      generated_by: sessionUser.reference,
      payload: {
        messages: validation.messages,
        sales_count: model100Runtime?.saleSummaries.length ?? 0,
        runtime_source: model100Runtime?.source ?? null,
        assets_count: canonicalAssetRows?.length ?? 0,
        blocked_losses: model100Runtime?.blockedLosses ?? [],
        runtime_issues: adjustmentIssues,
        expediente_reference: resolvedExpediente.reference
      }
    });

    if (exportError) {
      return NextResponse.json(
        {
          error: `No se pudo guardar exportacion: ${exportError.message}`
        },
        { status: 500 }
      );
    }

    const { error: auditError } = await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: `export.generated.${model}`,
      entity_type: "export",
      entity_id: exportId,
      after_data: {
        artifact_path: artifactPath,
        validation_state: payload.validation_state,
        messages: payload.messages
      }
    });

    if (auditError) {
      console.error("No se pudo auditar la exportación", auditError.message);
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo generar la exportación") },
      { status: accessErrorStatus(error) }
    );
  }
}
