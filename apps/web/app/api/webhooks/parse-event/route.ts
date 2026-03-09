import { NextResponse } from "next/server";
import { z } from "zod";
import { isWorkflowEventType } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { syncExpedienteWorkflowById } from "@/lib/expediente-workflow";
import { createSupabaseAdminClient } from "@/lib/supabase";

const parseEventSchema = z.object({
  event_type: z.string(),
  document_id: z.string().min(10),
  expediente_id: z.string().min(3),
  payload: z.record(z.string(), z.unknown()).optional()
});

function statusFromEvent(eventType: string) {
  switch (eventType) {
    case "parse.started":
      return "processing";
    case "parse.completed":
      return "completed";
    case "parse.failed":
      return "failed";
    case "manual.review.required":
      return "manual_review";
    default:
      return null;
  }
}

async function shouldIgnoreManualReviewEvent(
  documentId: string,
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const [{ data: document }, { data: extraction }] = await Promise.all([
    supabase
      .from(dbTables.documents)
      .select("processing_status")
      .eq("id", documentId)
      .maybeSingle(),
    supabase
      .from(dbTables.extractions)
      .select("review_status")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (document?.processing_status === "completed") {
    return true;
  }

  return extraction?.review_status === "validated" || extraction?.review_status === "not_required";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseEventSchema.safeParse(body);

  if (!parsed.success || !isWorkflowEventType(parsed.data.event_type)) {
    return NextResponse.json({ error: "Evento invalido" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const resolvedExpediente = normalizeExpedienteId(parsed.data.expediente_id);
  const { data: existingExpediente, error: existingExpedienteError } = await supabase
    .from(dbTables.expedientes)
    .select("id, reference")
    .eq("id", resolvedExpediente.id)
    .maybeSingle();

  if (existingExpedienteError) {
    return NextResponse.json(
      {
        error: `No se pudo verificar el expediente del webhook: ${existingExpedienteError.message}`
      },
      { status: 500 }
    );
  }

  const ignoreManualReviewEvent =
    parsed.data.event_type === "manual.review.required"
      ? await shouldIgnoreManualReviewEvent(parsed.data.document_id, supabase)
      : false;

  if (!existingExpediente) {
    const { error: expedienteError } = await supabase.from(dbTables.expedientes).upsert(
      {
        id: resolvedExpediente.id,
        reference: resolvedExpediente.reference,
        fiscal_year: new Date().getFullYear(),
        model_type: "IRPF",
        title: `Expediente ${resolvedExpediente.reference}`,
        status: "EN_REVISION"
      },
      { onConflict: "id" }
    );

    if (expedienteError) {
      return NextResponse.json(
        {
          error: `No se pudo garantizar expediente para webhook: ${expedienteError.message}`
        },
        { status: 500 }
      );
    }
  }

  const status = statusFromEvent(parsed.data.event_type);
  if (status && !ignoreManualReviewEvent) {
    const { error: updateError } = await supabase
      .from(dbTables.documents)
      .update({
        processing_status: status,
        manual_review_required: parsed.data.event_type === "manual.review.required"
      })
      .eq("id", parsed.data.document_id);

    if (updateError) {
      return NextResponse.json(
        {
          error: `No se pudo actualizar estado de documento: ${updateError.message}`
        },
        { status: 500 }
      );
    }
  }

  const { error: eventAuditError } = await supabase.from(dbTables.auditLog).insert({
    expediente_id: resolvedExpediente.id,
    user_id: "n8n.webhook",
    action: `webhook.parse-event.${parsed.data.event_type}`,
    entity_type: "document",
    entity_id: parsed.data.document_id,
    after_data: {
      event_type: parsed.data.event_type,
      payload: parsed.data.payload ?? {},
      document_id: parsed.data.document_id,
      expediente_reference: existingExpediente?.reference ?? resolvedExpediente.reference
    }
  });

  if (eventAuditError) {
    return NextResponse.json(
      {
        error: `No se pudo auditar el evento: ${eventAuditError.message}`
      },
      { status: 500 }
    );
  }

  if (
    (parsed.data.event_type === "parse.failed" || parsed.data.event_type === "manual.review.required") &&
    !ignoreManualReviewEvent
  ) {
    const { error: alertError } = await supabase.from(dbTables.alerts).insert({
      id: crypto.randomUUID(),
      expediente_id: resolvedExpediente.id,
      severity: parsed.data.event_type === "parse.failed" ? "critical" : "warning",
      category: parsed.data.event_type,
      message:
        parsed.data.event_type === "parse.failed"
          ? "El parseo del documento ha fallado"
          : "Documento requiere validacion manual",
      status: "open",
      entity_type: "document",
      entity_id: parsed.data.document_id,
      metadata: {
        payload: parsed.data.payload ?? {}
      }
    });

    if (alertError) {
      return NextResponse.json(
        {
          error: `No se pudo registrar alerta: ${alertError.message}`
        },
        { status: 500 }
      );
    }
  }

  await syncExpedienteWorkflowById(supabase, {
    expedienteId: resolvedExpediente.id
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
