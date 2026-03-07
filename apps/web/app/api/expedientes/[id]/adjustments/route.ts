import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import {
  buildTargetSnapshot,
  serializeFiscalAdjustment,
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

const createAdjustmentSchema = z
  .object({
    adjustment_type: z.enum(["COST_BASIS", "INHERITANCE", "TRANSFER_IN", "TRANSFER_OUT"]),
    target_operation_id: z.string().uuid().optional().nullable(),
    operation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isin: optionalString,
    description: optionalString,
    quantity: optionalPositiveNumber,
    total_amount: optionalAmountNumber,
    currency: optionalString,
    notes: optionalString
  })
  .superRefine((payload, ctx) => {
    if (payload.adjustment_type === "COST_BASIS" && !payload.target_operation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target_operation_id"],
        message: "El ajuste de coste debe apuntar a una compra existente."
      });
    }

    if (
      (payload.adjustment_type === "INHERITANCE" || payload.adjustment_type === "TRANSFER_IN") &&
      !payload.isin
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isin"],
        message: "La adquisición manual requiere ISIN."
      });
    }

    if (
      (payload.adjustment_type === "INHERITANCE" || payload.adjustment_type === "TRANSFER_IN") &&
      payload.total_amount === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total_amount"],
        message: "La adquisición manual requiere coste total."
      });
    }

    if (payload.adjustment_type !== "COST_BASIS" && payload.quantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "El ajuste manual requiere cantidad."
      });
    }

    if (payload.adjustment_type === "TRANSFER_OUT" && !payload.isin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isin"],
        message: "La transferencia de salida requiere ISIN."
      });
    }
  });

type PurchaseCandidateRow = {
  id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | string | null;
  amount: number | string | null;
  currency: string | null;
  source: string;
  manual_notes: string | null;
};

function serializePurchaseCandidate(row: PurchaseCandidateRow) {
  return {
    id: row.id,
    operation_date: row.operation_date,
    isin: row.isin,
    description: row.description ?? row.manual_notes ?? "Compra sin descripción",
    quantity: typeof row.quantity === "number" ? row.quantity : Number(row.quantity ?? 0),
    amount: typeof row.amount === "number" ? row.amount : Number(row.amount ?? 0),
    currency: row.currency,
    source: row.source
  };
}

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

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(params.id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "expedientes.read");

    const [adjustmentsResult, purchasesResult] = await Promise.all([
      supabase
        .from(dbTables.fiscalAdjustments)
        .select(
          "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
        )
        .eq("expediente_id", resolvedExpediente.id)
        .order("operation_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from(dbTables.operations)
        .select(
          "id, operation_type, operation_date, isin, description, quantity, amount, currency, source, manual_notes"
        )
        .eq("expediente_id", resolvedExpediente.id)
        .eq("operation_type", "COMPRA")
        .order("operation_date", { ascending: true })
        .order("created_at", { ascending: true })
    ]);

    if (adjustmentsResult.error || purchasesResult.error) {
      return NextResponse.json(
        {
          error:
            adjustmentsResult.error?.message ??
            purchasesResult.error?.message ??
            "No se pudieron cargar los ajustes fiscales"
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      },
      adjustments: ((adjustmentsResult.data ?? []) as FiscalAdjustmentRow[]).map(serializeFiscalAdjustment),
      purchase_candidates: ((purchasesResult.data ?? []) as PurchaseCandidateRow[]).map(serializePurchaseCandidate)
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudieron cargar los ajustes fiscales") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(params.id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "expedientes.write");

    const body = await request.json().catch(() => null);
    const parsed = createAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para ajuste fiscal", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    let targetSnapshot = null;
    if (parsed.data.adjustment_type === "COST_BASIS" && parsed.data.target_operation_id) {
      const targetOperation = await loadTargetOperation(
        supabase,
        resolvedExpediente.id,
        parsed.data.target_operation_id
      );
      targetSnapshot = buildTargetSnapshot(targetOperation);
    }

    const insertPayload = {
      id: crypto.randomUUID(),
      expediente_id: resolvedExpediente.id,
      adjustment_type: parsed.data.adjustment_type as FiscalAdjustmentType,
      status: "ACTIVE" as const,
      target_operation_id: parsed.data.target_operation_id ?? null,
      operation_date: parsed.data.operation_date,
      isin: parsed.data.isin?.trim().toUpperCase() ?? null,
      description: parsed.data.description?.trim() ?? null,
      quantity: parsed.data.quantity ?? null,
      total_amount: parsed.data.total_amount ?? null,
      currency: parsed.data.currency?.trim().toUpperCase() ?? null,
      notes: parsed.data.notes?.trim() ?? null,
      metadata: targetSnapshot ? { target_snapshot: targetSnapshot } : {},
      created_by: sessionUser.reference,
      updated_by: sessionUser.reference
    };

    const { data: insertedAdjustment, error: insertError } = await supabase
      .from(dbTables.fiscalAdjustments)
      .insert(insertPayload)
      .select(
        "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
      )
      .single();

    if (insertError || !insertedAdjustment) {
      return NextResponse.json(
        { error: `No se pudo guardar el ajuste fiscal: ${insertError?.message ?? "desconocido"}` },
        { status: 500 }
      );
    }

    await rebuildExpedienteFiscalRuntime(supabase, resolvedExpediente.id);

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "fiscal.adjustment.created",
      entity_type: "adjustment",
      entity_id: insertedAdjustment.id,
      after_data: serializeFiscalAdjustment(insertedAdjustment as FiscalAdjustmentRow)
    });

    return NextResponse.json(
      {
        adjustment: serializeFiscalAdjustment(insertedAdjustment as FiscalAdjustmentRow)
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo guardar el ajuste fiscal") },
      { status: accessErrorStatus(error) }
    );
  }
}
