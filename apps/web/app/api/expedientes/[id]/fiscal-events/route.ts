import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { upsertCanonicalFiscalEvent } from "@/lib/canonical-registry-manual";
import { canonicalFiscalEventInputSchema } from "@/lib/canonical-registry-schemas";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
      event: {
        ...parsed.data,
        event_type: "ADJUSTMENT"
      }
    });

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "canonical.fiscal_event.created",
      entity_type: "fiscal_event",
      entity_id: result.after.id,
      before_data: result.before,
      after_data: result.after
    });

    return NextResponse.json({ fiscal_event: result.after });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo crear el evento fiscal") },
      { status: accessErrorStatus(error) }
    );
  }
}
