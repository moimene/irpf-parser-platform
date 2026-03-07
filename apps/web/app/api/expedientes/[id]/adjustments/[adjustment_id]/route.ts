import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import {
  buildTargetSnapshot,
  serializeFiscalAdjustment,
  toNullableNumber,
  type FiscalAdjustmentRow,
  type FiscalAdjustmentType
} from "@/lib/fiscal-adjustments";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { rebuildExpedienteFiscalRuntime } from "@/lib/lots";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional()
);

const optionalPositiveNumber = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? undefined : value),
  z.coerce.number().positive().optional()
);

const optionalAmountNumber = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? undefined : value),
  z.coerce.number().nonnegative().optional()
);

const updateAdjustmentSchema = z
  .object({
    adjustment_type: z
      .enum(["COST_BASIS", "INHERITANCE", "TRANSFER_IN", "TRANSFER_OUT"])
      .optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
    target_operation_id: z.string().uuid().nullable().optional(),
    operation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    isin: optionalString,
    description: optionalString,
    quantity: optionalPositiveNumber,
    total_amount: optionalAmountNumber,
    currency: optionalString,
    notes: optionalString
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "Debes indicar al menos un campo para actualizar."
  });

async function loadTargetOperation(
  supabase: SupabaseClient,
  expedienteId: string,
  targetOperationId: string
) {
  const { data, error } = await supabase
    .from(dbTables.operations)
    .select("id, operation_type, operation_date, isin, description, quantity, amount, currency")
    .eq("id", targetOperationId)
    .eq("expediente_id", expedienteId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo cargar la compra objetivo del ajuste: ${error.message}`);
  }

  if (!data || data.operation_type !== "COMPRA") {
    throw new Error("La compra objetivo del ajuste no existe o no es válida.");
  }

  return data;
}

function validateMergedPayload(payload: {
  adjustment_type: FiscalAdjustmentType;
  target_operation_id: string | null;
  operation_date: string;
  isin: string | null;
  quantity: number | null;
  total_amount: number | null;
}) {
  if (payload.adjustment_type === "COST_BASIS" && !payload.target_operation_id) {
    throw new Error("El ajuste de coste debe apuntar a una compra existente.");
  }

  if (
    (payload.adjustment_type === "INHERITANCE" || payload.adjustment_type === "TRANSFER_IN") &&
    !payload.isin
  ) {
    throw new Error("La adquisición manual requiere ISIN.");
  }

  if (
    (payload.adjustment_type === "INHERITANCE" || payload.adjustment_type === "TRANSFER_IN") &&
    payload.total_amount === null
  ) {
    throw new Error("La adquisición manual requiere coste total.");
  }

  if (payload.adjustment_type !== "COST_BASIS" && (payload.quantity === null || payload.quantity <= 0)) {
    throw new Error("El ajuste manual requiere cantidad.");
  }

  if (payload.adjustment_type === "TRANSFER_OUT" && !payload.isin) {
    throw new Error("La transferencia de salida requiere ISIN.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; adjustment_id: string } }
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
    const parsed = updateAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para actualizar ajuste fiscal", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: currentAdjustment, error: currentError } = await supabase
      .from(dbTables.fiscalAdjustments)
      .select(
        "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
      )
      .eq("id", params.adjustment_id)
      .eq("expediente_id", resolvedExpediente.id)
      .maybeSingle();

    if (currentError) {
      return NextResponse.json(
        { error: `No se pudo cargar el ajuste fiscal: ${currentError.message}` },
        { status: 500 }
      );
    }

    if (!currentAdjustment) {
      return NextResponse.json({ error: "Ajuste fiscal no encontrado" }, { status: 404 });
    }

    const nextPayload = {
      adjustment_type:
        (parsed.data.adjustment_type ?? currentAdjustment.adjustment_type) as FiscalAdjustmentType,
      status: parsed.data.status ?? currentAdjustment.status,
      target_operation_id:
        parsed.data.target_operation_id !== undefined
          ? parsed.data.target_operation_id
          : currentAdjustment.target_operation_id,
      operation_date: parsed.data.operation_date ?? currentAdjustment.operation_date,
      isin:
        parsed.data.isin !== undefined
          ? parsed.data.isin?.trim().toUpperCase() ?? null
          : currentAdjustment.isin,
      description:
        parsed.data.description !== undefined
          ? parsed.data.description?.trim() ?? null
          : currentAdjustment.description,
      quantity:
        parsed.data.quantity !== undefined
          ? parsed.data.quantity
          : toNullableNumber(currentAdjustment.quantity),
      total_amount:
        parsed.data.total_amount !== undefined
          ? parsed.data.total_amount
          : toNullableNumber(currentAdjustment.total_amount),
      currency:
        parsed.data.currency !== undefined
          ? parsed.data.currency?.trim().toUpperCase() ?? null
          : currentAdjustment.currency,
      notes:
        parsed.data.notes !== undefined ? parsed.data.notes?.trim() ?? null : currentAdjustment.notes
    };

    validateMergedPayload({
      adjustment_type: nextPayload.adjustment_type,
      target_operation_id: nextPayload.target_operation_id ?? null,
      operation_date: nextPayload.operation_date,
      isin: nextPayload.isin,
      quantity: nextPayload.quantity,
      total_amount: nextPayload.total_amount
    });

    let metadata = currentAdjustment.metadata ?? {};
    if (nextPayload.adjustment_type === "COST_BASIS" && nextPayload.target_operation_id) {
      const targetOperation = await loadTargetOperation(
        supabase,
        resolvedExpediente.id,
        nextPayload.target_operation_id
      );
      metadata = {
        ...(currentAdjustment.metadata ?? {}),
        target_snapshot: buildTargetSnapshot(targetOperation)
      };
    }

    const { data: updatedAdjustment, error: updateError } = await supabase
      .from(dbTables.fiscalAdjustments)
      .update({
        adjustment_type: nextPayload.adjustment_type,
        status: nextPayload.status,
        target_operation_id: nextPayload.target_operation_id,
        operation_date: nextPayload.operation_date,
        isin: nextPayload.isin,
        description: nextPayload.description,
        quantity: nextPayload.quantity,
        total_amount: nextPayload.total_amount,
        currency: nextPayload.currency,
        notes: nextPayload.notes,
        metadata,
        updated_by: sessionUser.reference
      })
      .eq("id", params.adjustment_id)
      .eq("expediente_id", resolvedExpediente.id)
      .select(
        "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
      )
      .single();

    if (updateError || !updatedAdjustment) {
      return NextResponse.json(
        { error: `No se pudo actualizar el ajuste fiscal: ${updateError?.message ?? "desconocido"}` },
        { status: 500 }
      );
    }

    await rebuildExpedienteFiscalRuntime(supabase, resolvedExpediente.id);

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "fiscal.adjustment.updated",
      entity_type: "adjustment",
      entity_id: updatedAdjustment.id,
      before_data: serializeFiscalAdjustment(currentAdjustment as FiscalAdjustmentRow),
      after_data: serializeFiscalAdjustment(updatedAdjustment as FiscalAdjustmentRow)
    });

    return NextResponse.json({
      adjustment: serializeFiscalAdjustment(updatedAdjustment as FiscalAdjustmentRow)
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar el ajuste fiscal") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; adjustment_id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(params.id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "expedientes.write");

    const { data: currentAdjustment, error: currentError } = await supabase
      .from(dbTables.fiscalAdjustments)
      .select(
        "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
      )
      .eq("id", params.adjustment_id)
      .eq("expediente_id", resolvedExpediente.id)
      .maybeSingle();

    if (currentError) {
      return NextResponse.json(
        { error: `No se pudo cargar el ajuste fiscal: ${currentError.message}` },
        { status: 500 }
      );
    }

    if (!currentAdjustment) {
      return NextResponse.json({ error: "Ajuste fiscal no encontrado" }, { status: 404 });
    }

    const { error: deleteError } = await supabase
      .from(dbTables.fiscalAdjustments)
      .delete()
      .eq("id", params.adjustment_id)
      .eq("expediente_id", resolvedExpediente.id);

    if (deleteError) {
      return NextResponse.json(
        { error: `No se pudo eliminar el ajuste fiscal: ${deleteError.message}` },
        { status: 500 }
      );
    }

    await rebuildExpedienteFiscalRuntime(supabase, resolvedExpediente.id);

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "fiscal.adjustment.deleted",
      entity_type: "adjustment",
      entity_id: currentAdjustment.id,
      before_data: serializeFiscalAdjustment(currentAdjustment as FiscalAdjustmentRow)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo eliminar el ajuste fiscal") },
      { status: accessErrorStatus(error) }
    );
  }
}
