import type { WorkflowEventPayload, WorkflowEventType } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function emitWorkflowEvent<T extends Record<string, unknown>>(
  eventType: WorkflowEventType,
  documentId: string,
  expedienteId: string,
  payload: T
): Promise<void> {
  const event: WorkflowEventPayload<T> = {
    event_type: eventType,
    timestamp: new Date().toISOString(),
    document_id: documentId,
    expediente_id: expedienteId,
    payload
  };

  const supabase = createSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from(dbTables.auditLog).insert({
      expediente_id: expedienteId,
      user_id: "system",
      action: `workflow.event.${eventType}`,
      entity_type: "document",
      entity_id: documentId,
      after_data: {
        event_type: eventType,
        timestamp: event.timestamp,
        payload
      }
    });

    if (error) {
      console.error("No se pudo persistir evento en audit_log", error.message);
    }
  }

  if (!env.n8nWebhookUrl) {
    return;
  }

  try {
    await fetch(env.n8nWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(event)
    });
  } catch (error) {
    console.error("No se pudo enviar evento a n8n", error);
  }
}
