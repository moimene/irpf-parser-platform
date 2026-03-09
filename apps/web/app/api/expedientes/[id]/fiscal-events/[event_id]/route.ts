import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { syncExpedienteWorkflowById } from "@/lib/expediente-workflow";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const canonicalStatusSchema = z.enum([
  "RECORDED",
  "MATCHED",
  "UNRESOLVED",
  "PENDING_COST_BASIS",
  "INVALID_DATA"
]);

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

const eventPatchSchema = z.object({
  description: z.string().max(240).optional().or(z.literal("")),
  amount: nullableNumberSchema.optional(),
  quantity: nullableNumberSchema.optional(),
  retention: nullableNumberSchema.optional(),
  realized_gain: nullableNumberSchema.optional(),
  status: canonicalStatusSchema,
  notes: z.string().max(2000).optional().or(z.literal(""))
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
  { params }: { params: { id: string; event_id: string } }
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
    const parsed = eventPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido para ajuste de evento fiscal", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: expediente, error: expedienteError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference")
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

    const sourceEventId = decodeRouteParam(params.event_id);
    const { data: eventRow, error: eventError } = await supabase
      .from(dbTables.fiscalEvents)
      .select("id, source_event_id, metadata")
      .eq("expediente_id", expediente.id)
      .eq("source_event_id", sourceEventId)
      .maybeSingle();

    if (eventError) {
      return NextResponse.json(
        { error: `No se pudo cargar el evento fiscal canónico: ${eventError.message}` },
        { status: 500 }
      );
    }

    if (!eventRow) {
      return NextResponse.json(
        { error: "Evento fiscal canónico no encontrado. Recalcula el runtime antes de aplicar overrides." },
        { status: 404 }
      );
    }

    const nextMetadata = {
      ...(eventRow.metadata && typeof eventRow.metadata === "object" ? eventRow.metadata : {}),
      manual_description: parsed.data.description?.trim() || null,
      manual_amount: parsed.data.amount ?? null,
      manual_quantity: parsed.data.quantity ?? null,
      manual_retention: parsed.data.retention ?? null,
      manual_realized_gain: parsed.data.realized_gain ?? null,
      manual_status: parsed.data.status,
      manual_notes: parsed.data.notes?.trim() || null,
      manual_updated_at: new Date().toISOString(),
      manual_updated_by: sessionUser.reference
    };

    const { error: updateError } = await supabase
      .from(dbTables.fiscalEvents)
      .update({ metadata: nextMetadata })
      .eq("id", eventRow.id);

    if (updateError) {
      return NextResponse.json(
        { error: `No se pudo actualizar el evento fiscal canónico: ${updateError.message}` },
        { status: 500 }
      );
    }

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: expediente.id,
      user_id: sessionUser.reference,
      action: "canonical.event.updated",
      entity_type: "fiscal_event",
      entity_id: String(eventRow.id),
      after_data: {
        source_event_id: eventRow.source_event_id,
        manual_description: parsed.data.description?.trim() || null,
        manual_amount: parsed.data.amount ?? null,
        manual_quantity: parsed.data.quantity ?? null,
        manual_retention: parsed.data.retention ?? null,
        manual_realized_gain: parsed.data.realized_gain ?? null,
        manual_status: parsed.data.status,
        manual_notes: parsed.data.notes?.trim() || null
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
      source_event_id: eventRow.source_event_id,
      message: "Evento fiscal canónico actualizado."
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar el evento fiscal canónico") },
      { status: accessErrorStatus(error) }
    );
  }
}
