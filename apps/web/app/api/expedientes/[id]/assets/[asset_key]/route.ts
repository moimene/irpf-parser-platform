import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { syncExpedienteWorkflowById } from "@/lib/expediente-workflow";
import {
  canonicalAssetTypes,
  canonicalForeignAssetBlocks,
  canonicalHolderRoles,
  canonicalValuationMethods
} from "@/lib/fiscal-canonical";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const nullableNumberSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return Number(trimmed.replace(",", "."));
  }

  return value;
}, z.number().finite().nullable());

const assetPatchSchema = z.object({
  label: z.string().trim().min(1).max(180),
  notes: z.string().max(2000).optional().or(z.literal("")),
  asset_type: z.enum(canonicalAssetTypes).optional(),
  holder_role: z.enum(canonicalHolderRoles).optional(),
  ownership_pct: nullableNumberSchema.optional(),
  country: z.string().trim().max(2).optional().or(z.literal("")),
  year_end_value: nullableNumberSchema.optional(),
  q4_avg_balance: nullableNumberSchema.optional(),
  valuation_method: z.enum(canonicalValuationMethods).optional(),
  foreign_block: z.enum(canonicalForeignAssetBlocks).optional().nullable()
});

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; asset_key: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(params.id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "expedientes.write");

    const body = await request.json().catch(() => null);
    const parsed = assetPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido para ajuste de activo", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: expediente, error: expedienteError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference, client_id")
      .eq("id", resolvedExpediente.id)
      .maybeSingle();

    if (expedienteError) {
      return NextResponse.json(
        { error: `No se pudo cargar el expediente: ${expedienteError.message}` },
        { status: 500 }
      );
    }

    if (!expediente) {
      return NextResponse.json({ error: "Expediente no encontrado." }, { status: 404 });
    }

    if (!expediente.client_id) {
      return NextResponse.json(
        { error: "El expediente no está vinculado a un cliente. No se puede ajustar el activo canónico." },
        { status: 409 }
      );
    }

    const assetKey = decodeRouteParam(params.asset_key);
    const { data: assetRow, error: assetError } = await supabase
      .from(dbTables.assets)
      .select("id, asset_key, metadata")
      .eq("client_id", expediente.client_id)
      .eq("asset_key", assetKey)
      .maybeSingle();

    if (assetError) {
      return NextResponse.json(
        { error: `No se pudo cargar el activo canónico: ${assetError.message}` },
        { status: 500 }
      );
    }

    if (!assetRow) {
      return NextResponse.json(
        { error: "Activo canónico no encontrado. Recalcula el runtime antes de aplicar overrides." },
        { status: 404 }
      );
    }

    const nextMetadata = {
      ...(assetRow.metadata && typeof assetRow.metadata === "object" ? assetRow.metadata : {}),
      manual_label: parsed.data.label,
      manual_notes: parsed.data.notes?.trim() || null,
      manual_asset_type: parsed.data.asset_type ?? null,
      manual_holder_role: parsed.data.holder_role ?? null,
      manual_ownership_pct: parsed.data.ownership_pct ?? null,
      manual_country: parsed.data.country?.trim().toUpperCase() || null,
      manual_year_end_value: parsed.data.year_end_value ?? null,
      manual_q4_avg_balance: parsed.data.q4_avg_balance ?? null,
      manual_valuation_method: parsed.data.valuation_method ?? null,
      manual_foreign_block: parsed.data.foreign_block ?? null,
      manual_updated_at: new Date().toISOString(),
      manual_updated_by: sessionUser.reference
    };

    const { error: updateError } = await supabase
      .from(dbTables.assets)
      .update({ metadata: nextMetadata })
      .eq("id", assetRow.id);

    if (updateError) {
      return NextResponse.json(
        { error: `No se pudo actualizar el activo canónico: ${updateError.message}` },
        { status: 500 }
      );
    }

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: expediente.id,
      user_id: sessionUser.reference,
      action: "canonical.asset.updated",
      entity_type: "asset",
      entity_id: String(assetRow.id),
      after_data: {
        asset_key: assetRow.asset_key,
        manual_label: parsed.data.label,
        manual_notes: parsed.data.notes?.trim() || null,
        manual_asset_type: parsed.data.asset_type ?? null,
        manual_holder_role: parsed.data.holder_role ?? null,
        manual_ownership_pct: parsed.data.ownership_pct ?? null,
        manual_country: parsed.data.country?.trim().toUpperCase() || null,
        manual_year_end_value: parsed.data.year_end_value ?? null,
        manual_q4_avg_balance: parsed.data.q4_avg_balance ?? null,
        manual_valuation_method: parsed.data.valuation_method ?? null,
        manual_foreign_block: parsed.data.foreign_block ?? null
      }
    });

    await syncExpedienteWorkflowById(supabase, {
      expedienteId: expediente.id,
      overrides: {
        canonical_approval_status: "reviewed"
      }
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      asset_key: assetRow.asset_key,
      message: "Activo canónico actualizado."
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar el activo canónico") },
      { status: accessErrorStatus(error) }
    );
  }
}
