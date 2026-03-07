import { NextResponse } from "next/server";
import { z } from "zod";
import { listAccessAuthStatusMap } from "@/lib/access-onboarding";
import {
  listAccessAuditEntries,
  recordAccessAudit,
  serializeClientAssignment
} from "@/lib/access-audit";
import {
  listAccessProfiles,
  listClientAssignments,
  saveClientAssignment,
  type AccessProfile
} from "@/lib/access-store";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, requirePermission } from "@/lib/auth";
import { listClientsCompat } from "@/lib/client-store";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const assignmentRoleSchema = z.enum(["owner", "manager", "support", "viewer"]);

const createAssignmentSchema = z.object({
  user_id: z.string().uuid(),
  client_id: z.string().uuid(),
  assignment_role: assignmentRoleSchema
});

function summarizeSessionUser(user: AccessProfile) {
  return {
    id: user.id,
    reference: user.reference,
    display_name: user.display_name,
    email: user.email,
    role: user.role,
    status: user.status
  };
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "access.manage");

    const [users, clients, assignments, accessAuditEntries] = await Promise.all([
      listAccessProfiles(supabase),
      listClientsCompat(supabase),
      listClientAssignments(supabase),
      listAccessAuditEntries(supabase)
    ]);
    const authStatusByUserId = await listAccessAuthStatusMap(supabase, users);

    const usersById = new Map(users.map((user) => [user.id, user]));
    const clientsById = new Map(clients.map((client) => [client.id, client]));

    const formattedAssignments = assignments
      .map((assignment) => {
        const user = usersById.get(assignment.user_id);
        const client = clientsById.get(assignment.client_id);
        if (!user || !client) {
          return null;
        }

        return {
          id: assignment.id,
          assignment_role: assignment.assignment_role,
          created_at: assignment.created_at,
          user: summarizeSessionUser(user),
          client: {
            id: client.id,
            reference: client.reference,
            display_name: client.display_name,
            status: client.status
          }
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const audits = accessAuditEntries.map((entry) => {
      const actor = entry.user_id ? usersById.get(entry.user_id) ?? null : null;
      const assignmentSnapshot =
        (entry.after_data as { user_id?: string; client_id?: string; assignment_role?: string } | null) ??
        (entry.before_data as { user_id?: string; client_id?: string; assignment_role?: string } | null) ??
        null;
      const targetUserId =
        entry.entity_type === "access_user" ? entry.entity_id : assignmentSnapshot?.user_id ?? null;
      const targetClientId = assignmentSnapshot?.client_id ?? null;
      const targetUser = targetUserId ? usersById.get(targetUserId) ?? null : null;
      const targetClient = targetClientId ? clientsById.get(targetClientId) ?? null : null;

      return {
        id: entry.id,
        action: entry.action,
        created_at: entry.created_at,
        actor: actor ? summarizeSessionUser(actor) : null,
        target: {
          user:
            targetUser
              ? {
                  id: targetUser.id,
                  reference: targetUser.reference,
                  display_name: targetUser.display_name
                }
              : null,
          client:
            targetClient
              ? {
                  id: targetClient.id,
                  reference: targetClient.reference,
                  display_name: targetClient.display_name
                }
              : null,
          assignment_role:
            typeof assignmentSnapshot?.assignment_role === "string"
              ? assignmentSnapshot.assignment_role
              : null
        }
      };
    });

    return NextResponse.json({
      current_user: summarizeSessionUser(sessionUser),
      users: users.map((user) => ({
        ...summarizeSessionUser(user),
        auth: authStatusByUserId.get(user.id) ?? {
          auth_user_id: user.auth_user_id,
          invited_at: null,
          email_confirmed_at: null,
          last_sign_in_at: null,
          recovery_sent_at: null,
          onboarding_state: "no_auth_user"
        },
        assignment_count: formattedAssignments.filter((assignment) => assignment.user.id === user.id).length,
        assigned_clients: formattedAssignments
          .filter((assignment) => assignment.user.id === user.id)
          .map((assignment) => ({
            id: assignment.id,
            assignment_role: assignment.assignment_role,
            client_id: assignment.client.id,
            client_reference: assignment.client.reference,
            client_display_name: assignment.client.display_name
          }))
      })),
      clients: clients.map((client) => ({
        id: client.id,
        reference: client.reference,
        display_name: client.display_name,
        status: client.status,
        assignment_count: formattedAssignments.filter((assignment) => assignment.client.id === client.id).length,
        assigned_users: formattedAssignments
          .filter((assignment) => assignment.client.id === client.id)
          .map((assignment) => ({
            id: assignment.id,
            assignment_role: assignment.assignment_role,
            user_id: assignment.user.id,
            user_reference: assignment.user.reference,
            user_display_name: assignment.user.display_name,
            user_role: assignment.user.role
          }))
      })),
      assignments: formattedAssignments,
      audits
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar la administración de accesos") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "access.manage");

    const body = await request.json().catch(() => null);
    const parsed = createAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para asignación", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const [users, clients, assignments] = await Promise.all([
      listAccessProfiles(supabase),
      listClientsCompat(supabase),
      listClientAssignments(supabase)
    ]);

    const user = users.find((item) => item.id === parsed.data.user_id) ?? null;
    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const client = clients.find((item) => item.id === parsed.data.client_id) ?? null;
    if (!client) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    if (user.role === "admin") {
      return NextResponse.json(
        { error: "El perfil administrador ya dispone de acceso global y no requiere asignación." },
        { status: 400 }
      );
    }

    if (user.status !== "active") {
      return NextResponse.json(
        { error: "No puedes asignar clientes a un usuario inactivo." },
        { status: 400 }
      );
    }

    const existingAssignment = assignments.find(
      (assignment) => assignment.user_id === user.id && assignment.client_id === client.id
    );
    const assignment = await saveClientAssignment(supabase, {
      id: existingAssignment?.id,
      user_id: user.id,
      client_id: client.id,
      assignment_role: parsed.data.assignment_role
    });

    try {
      await recordAccessAudit(supabase, {
        actor: sessionUser,
        action: existingAssignment ? "access.assignment.updated" : "access.assignment.created",
        entity_type: "access_assignment",
        entity_id: assignment.id,
        before_data: existingAssignment ? serializeClientAssignment(existingAssignment) : null,
        after_data: serializeClientAssignment(assignment)
      });
    } catch (auditError) {
      console.error("No se pudo auditar la asignacion de acceso", auditError);
    }

    return NextResponse.json(
      {
        assignment: {
          id: assignment.id,
          assignment_role: assignment.assignment_role,
          created_at: assignment.created_at,
          user: summarizeSessionUser(user),
          client: {
            id: client.id,
            reference: client.reference,
            display_name: client.display_name,
            status: client.status
          }
        }
      },
      { status: existingAssignment ? 200 : 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo guardar la asignación") },
      { status: accessErrorStatus(error) }
    );
  }
}
