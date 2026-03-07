import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAccessAudit, serializeAccessProfile } from "@/lib/access-audit";
import {
  accessErrorMessage,
  accessErrorStatus,
  defaultSessionReference,
  getCurrentSessionUser,
  requirePermission,
  type AppRole
} from "@/lib/auth";
import { listAccessProfiles, saveAccessProfile } from "@/lib/access-store";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const userUpdateSchema = z
  .object({
    role: z.enum(["admin", "fiscal_senior", "fiscal_junior", "solo_lectura"]).optional(),
    status: z.enum(["active", "inactive"]).optional()
  })
  .refine((payload) => payload.role !== undefined || payload.status !== undefined, {
    message: "Debes indicar al menos un campo para actualizar."
  });

type UserRow = {
  id: string;
  reference: string;
  display_name: string;
  email: string;
  role: AppRole;
  status: "active" | "inactive";
};

function summarizeUser(user: UserRow) {
  return {
    id: user.id,
    reference: user.reference,
    display_name: user.display_name,
    email: user.email,
    role: user.role,
    status: user.status
  };
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "access.manage");

    const body = await request.json().catch(() => null);
    const parsed = userUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para usuario", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const profiles = await listAccessProfiles(supabase);
    const currentUser = profiles.find((profile) => profile.id === params.id) ?? null;
    if (!currentUser) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }
    const nextRole = parsed.data.role ?? currentUser.role;
    const nextStatus = parsed.data.status ?? currentUser.status;

    if (
      currentUser.reference === defaultSessionReference() &&
      (nextRole !== "admin" || nextStatus !== "active")
    ) {
      return NextResponse.json(
        { error: "No puedes desactivar ni despromocionar el usuario administrador por defecto." },
        { status: 400 }
      );
    }

    const removesActiveAdmin =
      currentUser.role === "admin" &&
      currentUser.status === "active" &&
      (nextRole !== "admin" || nextStatus !== "active");

    if (removesActiveAdmin) {
      const remainingAdmins = profiles.filter(
        (profile) => profile.id !== currentUser.id && profile.role === "admin" && profile.status === "active"
      );
      if (remainingAdmins.length === 0) {
        return NextResponse.json(
          { error: "Debe permanecer al menos un administrador activo en la plataforma." },
          { status: 400 }
        );
      }
    }

    const updatedUser = await saveAccessProfile(supabase, {
      id: currentUser.id,
      reference: currentUser.reference,
      display_name: currentUser.display_name,
      email: currentUser.email,
      role: nextRole,
      status: nextStatus
    });

    try {
      await recordAccessAudit(supabase, {
        actor: sessionUser,
        action: "access.user.updated",
        entity_type: "access_user",
        entity_id: updatedUser.id,
        before_data: serializeAccessProfile(currentUser),
        after_data: serializeAccessProfile(updatedUser)
      });
    } catch (auditError) {
      console.error("No se pudo auditar la actualizacion de usuario", auditError);
    }

    return NextResponse.json({
      user: summarizeUser(updatedUser)
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo actualizar el usuario") },
      { status: accessErrorStatus(error) }
    );
  }
}
