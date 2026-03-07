import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAccessAudit, serializeClientAssignment } from "@/lib/access-audit";
import { listClientAssignments, removeClientAssignment, saveClientAssignment } from "@/lib/access-store";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, requirePermission } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const assignmentUpdateSchema = z.object({
  assignment_role: z.enum(["owner", "manager", "support", "viewer"])
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "access.manage");

    const body = await request.json().catch(() => null);
    const parsed = assignmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para asignación", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const assignments = await listClientAssignments(supabase);
    const existing = assignments.find((assignment) => assignment.id === params.id) ?? null;
    if (!existing) {
      return NextResponse.json({ error: "Asignación no encontrada" }, { status: 404 });
    }

    const updated = await saveClientAssignment(supabase, {
      id: existing.id,
      user_id: existing.user_id,
      client_id: existing.client_id,
      assignment_role: parsed.data.assignment_role
    });

    try {
      await recordAccessAudit(supabase, {
        actor: sessionUser,
        action: "access.assignment.updated",
        entity_type: "access_assignment",
        entity_id: updated.id,
        before_data: serializeClientAssignment(existing),
        after_data: serializeClientAssignment(updated)
      });
    } catch (auditError) {
      console.error("No se pudo auditar la actualizacion de asignacion", auditError);
    }

    return NextResponse.json({
      assignment: updated
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar la asignación") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "access.manage");

    const assignments = await listClientAssignments(supabase);
    const existing = assignments.find((assignment) => assignment.id === params.id) ?? null;
    if (!existing) {
      return NextResponse.json({ error: "Asignación no encontrada" }, { status: 404 });
    }

    await removeClientAssignment(supabase, params.id);

    try {
      await recordAccessAudit(supabase, {
        actor: sessionUser,
        action: "access.assignment.deleted",
        entity_type: "access_assignment",
        entity_id: existing.id,
        before_data: serializeClientAssignment(existing),
        after_data: null
      });
    } catch (auditError) {
      console.error("No se pudo auditar la eliminacion de asignacion", auditError);
    }

    return NextResponse.json({
      removed_assignment_id: params.id
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo eliminar la asignación") },
      { status: accessErrorStatus(error) }
    );
  }
}
