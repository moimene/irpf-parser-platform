import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { deleteCanonicalFiscalEvent, upsertCanonicalFiscalEvent } from "@/lib/canonical-registry-manual";
import { canonicalFiscalEventInputSchema } from "@/lib/canonical-registry-schemas";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
    const parsed = canonicalFiscalEventInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para evento fiscal", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await upsertCanonicalFiscalEvent(supabase, {
      expedienteId: resolvedExpediente.id,
      actor: sessionUser.reference,
      eventId: params.event_id,
      event: {
        ...parsed.data,
        event_type: "ADJUSTMENT"
      }
    });

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "canonical.fiscal_event.updated",
      entity_type: "fiscal_event",
      entity_id: result.after.id,
      before_data: result.before,
      after_data: result.after
    });

    return NextResponse.json({ fiscal_event: result.after });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar el evento fiscal") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function DELETE(
  _request: Request,
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

    const deleted = await deleteCanonicalFiscalEvent(supabase, {
      expedienteId: resolvedExpediente.id,
      eventId: params.event_id
    });

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "canonical.fiscal_event.deleted",
      entity_type: "fiscal_event",
      entity_id: deleted.id,
      before_data: deleted,
      after_data: null
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo eliminar el evento fiscal") },
      { status: accessErrorStatus(error) }
    );
  }
}
