import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import {
  type CanonicalApprovalStatus,
  type FilingWorkflowStatus,
  syncExpedienteWorkflowById
} from "@/lib/expediente-workflow";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { createSupabaseAdminClient } from "@/lib/supabase";

const workflowPatchSchema = z.object({
  take_ownership: z.boolean().optional(),
  clear_ownership: z.boolean().optional(),
  pending_task: z.string().max(240).optional().nullable(),
  pending_reason: z.string().max(2000).optional().nullable(),
  canonical_approval_status: z.enum(["draft", "reviewed", "approved"]).optional(),
  filing_status: z.enum(["draft", "ready", "filed"]).optional()
});

function normalizeNullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function canManageApproval(role: string): boolean {
  return role === "admin" || role === "fiscal_senior";
}

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
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
    const parsed = workflowPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para workflow de expediente", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const overrides: {
      workflow_owner_ref?: string | null;
      workflow_owner_name?: string | null;
      pending_task?: string | null;
      pending_reason?: string | null;
      canonical_approval_status?: CanonicalApprovalStatus;
      filing_status?: FilingWorkflowStatus;
    } = {};

    if (parsed.data.take_ownership) {
      overrides.workflow_owner_ref = sessionUser.reference;
      overrides.workflow_owner_name = sessionUser.display_name;
    }

    if (parsed.data.clear_ownership) {
      overrides.workflow_owner_ref = null;
      overrides.workflow_owner_name = null;
    }

    if (parsed.data.pending_task !== undefined) {
      overrides.pending_task = normalizeNullableText(parsed.data.pending_task);
    }

    if (parsed.data.pending_reason !== undefined) {
      overrides.pending_reason = normalizeNullableText(parsed.data.pending_reason);
    }

    if (parsed.data.canonical_approval_status) {
      if (!canManageApproval(sessionUser.role)) {
        return NextResponse.json(
          { error: "Solo un fiscal senior o administrador puede aprobar el canónico." },
          { status: 403 }
        );
      }

      overrides.canonical_approval_status = parsed.data.canonical_approval_status;
    }

    if (parsed.data.filing_status) {
      if (!canManageApproval(sessionUser.role)) {
        return NextResponse.json(
          { error: "Solo un fiscal senior o administrador puede cambiar el estado de presentación." },
          { status: 403 }
        );
      }

      overrides.filing_status = parsed.data.filing_status;
    }

    const snapshot = await syncExpedienteWorkflowById(supabase, {
      expedienteId: resolvedExpediente.id,
      overrides
    });

    if (!snapshot) {
      return NextResponse.json({ error: "Expediente no encontrado." }, { status: 404 });
    }

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: "expediente.workflow.updated",
      entity_type: "expediente_workflow",
      entity_id: resolvedExpediente.id,
      after_data: {
        workflow_owner_ref: snapshot.workflow_owner_ref,
        workflow_owner_name: snapshot.workflow_owner_name,
        pending_task: snapshot.pending_task,
        pending_reason: snapshot.pending_reason,
        canonical_approval_status: snapshot.canonical_approval_status,
        filing_status: snapshot.filing_status,
        expediente_status: snapshot.expediente_status
      }
    });

    return NextResponse.json({
      ok: true,
      workflow: snapshot,
      message: "Workflow del expediente actualizado."
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar el workflow del expediente") },
      { status: accessErrorStatus(error) }
    );
  }
}
