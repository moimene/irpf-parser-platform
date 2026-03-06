import { NextResponse } from "next/server";
import { z } from "zod";
import { dbTables } from "@/lib/db-tables";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase-auth";
import { detectBlockedLosses, type TradeEvent, type AssetKind } from "@/lib/rules-core";

const reviewActionSchema = z.object({
  action: z.enum(["approve", "reject", "request_correction"]),
  reviewer: z.string().optional(),
  notes: z.string().optional(),
  corrected_fields: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Helpers para convertir registros del parser a TradeEvents del motor fiscal
// ---------------------------------------------------------------------------
function toTradeEvents(records: Array<Record<string, unknown>>): TradeEvent[] {
  return records
    .filter((rec) => ["COMPRA", "VENTA"].includes(String(rec.record_type ?? "")))
    .map((rec) => {
      const fields = (rec.fields ?? {}) as Record<string, unknown>;
      const type = rec.record_type === "COMPRA" ? "BUY" : "SELL";
      const gainLoss =
        type === "SELL" && fields.realized_gain != null
          ? Number(fields.realized_gain)
          : type === "SELL" && fields.amount != null
          ? Number(fields.amount)
          : undefined;
      // Determinar si el activo cotiza en mercado organizado
      const isin = fields.isin ? String(fields.isin) : "";
      // Heurística: ISINs de fondos privados (Citi, GS PE) suelen empezar por XS o KY
      const assetKind: AssetKind =
        isin.startsWith("XS") || isin.startsWith("KY") ? "UNLISTED" : "LISTED";
      return {
        id: String(fields.operation_id ?? crypto.randomUUID()),
        isin,
        type,
        tradeDate: String(fields.operation_date ?? new Date().toISOString().slice(0, 10)),
        quantity: fields.quantity != null ? Number(fields.quantity) : 1,
        gainLossEur: gainLoss,
        assetKind,
      } satisfies TradeEvent;
    });
}

export async function PATCH(
  request: Request,
  { params }: { params: { extraction_id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  // Obtener el usuario autenticado
  const serverClient = await createSupabaseServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { action, notes, corrected_fields } = parsed.data;
  const reviewer = user.email ?? user.id;
  const extractionId = params.extraction_id;

  // Verificar que la extracción existe
  const { data: extraction, error: fetchError } = await supabase
    .from(dbTables.extractions)
    .select("id, document_id, expediente_id, normalized_payload, review_status")
    .eq("id", extractionId)
    .single();

  if (fetchError || !extraction) {
    return NextResponse.json({ error: "Extracción no encontrada" }, { status: 404 });
  }

  // Mapear acción → estado de revisión
  const reviewStatusMap: Record<string, string> = {
    approve: "approved",
    reject: "rejected",
    request_correction: "pending",
  };
  const newReviewStatus = reviewStatusMap[action];

  // Si hay correcciones, actualizar el normalized_payload
  let updatedPayload = extraction.normalized_payload as Record<string, unknown>;
  if (action === "approve" && corrected_fields && Object.keys(corrected_fields).length > 0) {
    updatedPayload = {
      ...updatedPayload,
      records: updatedPayload.records,
      corrections: corrected_fields,
      corrected_by: reviewer,
      corrected_at: new Date().toISOString(),
    };
  }

  // Actualizar la extracción
  const { error: updateError } = await supabase
    .from(dbTables.extractions)
    .update({
      review_status: newReviewStatus,
      normalized_payload: updatedPayload,
    })
    .eq("id", extractionId);

  if (updateError) {
    return NextResponse.json(
      { error: `No se pudo actualizar la revisión: ${updateError.message}` },
      { status: 500 }
    );
  }

  // Si se aprueba, persistir los registros en irpf_operations y aplicar reglas fiscales
  let operationsSaved = 0;
  let blockedLossesDetected = 0;
  const fiscalAlerts: string[] = [];

  if (action === "approve") {
    const records = (updatedPayload.records as Array<Record<string, unknown>>) ?? [];

    // Gap C — Motor de Reglas Fiscales: detectar pérdidas bloqueadas (art. 33.5 LIRPF)
    const tradeEvents = toTradeEvents(records);
    const blockedLosses = detectBlockedLosses(tradeEvents);
    blockedLossesDetected = blockedLosses.length;

    if (blockedLosses.length > 0) {
      // Registrar alerta por cada pérdida bloqueada detectada
      for (const bl of blockedLosses) {
        fiscalAlerts.push(bl.reason);
        await supabase.from(dbTables.alerts).insert({
          id: crypto.randomUUID(),
          expediente_id: extraction.expediente_id,
          severity: "warning",
          category: "fiscal.blocked_loss",
          message: bl.reason,
          status: "open",
          entity_type: "extraction",
          entity_id: extractionId,
          metadata: {
            sell_event_id: bl.sellEventId,
            blocked_by_buy_event_id: bl.blockedByBuyEventId,
            window_months: bl.windowMonths,
          },
        });
      }
    }

    // Persistir operaciones en irpf_operations
    const operationsToInsert = records
      .filter((rec) => {
        const recType = String(rec.record_type ?? "");
        return ["COMPRA", "VENTA", "DIVIDENDO", "INTERES"].includes(recType);
      })
      .map((rec) => {
        const fields = (rec.fields ?? {}) as Record<string, unknown>;
        // Marcar si esta operación tiene pérdida bloqueada
        const tradeEventId = String(fields.operation_id ?? "");
        const isBlocked = blockedLosses.some((bl) => bl.sellEventId === tradeEventId);

        return {
          id: crypto.randomUUID(),
          expediente_id: extraction.expediente_id,
          document_id: extraction.document_id,
          operation_type: String(rec.record_type),
          operation_date: String(fields.operation_date ?? new Date().toISOString().slice(0, 10)),
          isin: fields.isin ? String(fields.isin) : null,
          description: fields.description ? String(fields.description).slice(0, 500) : null,
          amount: fields.amount != null ? Number(fields.amount) : null,
          currency: fields.currency ? String(fields.currency) : "EUR",
          retention: fields.retention != null ? Number(fields.retention) : null,
          quantity: fields.quantity != null ? Number(fields.quantity) : null,
          realized_gain:
            rec.record_type === "VENTA" && fields.amount != null ? Number(fields.amount) : null,
          raw_data: {
            ...fields,
            // Gap C — anotar resultado del motor fiscal en el registro
            fiscal_flags: isBlocked
              ? ["PERDIDA_BLOQUEADA_ART33_5_LIRPF"]
              : [],
          },
          source: "parser.auto",
        };
      });

    if (operationsToInsert.length > 0) {
      const { error: opsError } = await supabase
        .from(dbTables.operations)
        .upsert(operationsToInsert, { onConflict: "id" });

      if (opsError) {
        return NextResponse.json(
          { error: `Revisión guardada pero error al persistir operaciones: ${opsError.message}` },
          { status: 207 }
        );
      }
      operationsSaved = operationsToInsert.length;
    }

    // Actualizar estado del documento a "completed"
    await supabase
      .from(dbTables.documents)
      .update({ processing_status: "completed" })
      .eq("id", extraction.document_id);
  }

  // Registrar en audit log
  await supabase.from(dbTables.auditLog).insert({
    expediente_id: extraction.expediente_id,
    user_id: reviewer,
    action: `review.${action}`,
    entity_type: "extraction",
    entity_id: extractionId,
    after_data: {
      review_status: newReviewStatus,
      notes,
      operations_saved: operationsSaved,
      blocked_losses_detected: blockedLossesDetected,
      fiscal_alerts: fiscalAlerts,
    },
  });

  return NextResponse.json({
    extraction_id: extractionId,
    review_status: newReviewStatus,
    operations_saved: operationsSaved,
    blocked_losses_detected: blockedLossesDetected,
    fiscal_alerts: fiscalAlerts,
    message:
      action === "approve"
        ? `Aprobado. ${operationsSaved} operacion(es) guardadas.${
            blockedLossesDetected > 0
              ? ` Advertencia: ${blockedLossesDetected} perdida(s) bloqueada(s) por art. 33.5 LIRPF.`
              : ""
          }`
        : action === "reject"
        ? "Documento rechazado. Requiere nueva ingesta."
        : "Marcado para correccion.",
  });
}
