import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOnboardingRedirectUrl, generateAccessUserLink } from "@/lib/access-onboarding";
import { recordAccessAudit, serializeAccessProfile } from "@/lib/access-audit";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, requirePermission } from "@/lib/auth";
import { listAccessProfiles, saveAccessProfile } from "@/lib/access-store";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const accessLinkSchema = z.object({
  mode: z.enum(["onboarding", "recovery"])
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "access.manage");

    const body = await request.json().catch(() => null);
    const parsed = accessLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para enlace de acceso", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const profiles = await listAccessProfiles(supabase);
    const targetProfile = profiles.find((profile) => profile.id === params.id) ?? null;

    if (!targetProfile) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    if (targetProfile.status !== "active") {
      return NextResponse.json(
        { error: "Solo puedes emitir enlaces para usuarios activos." },
        { status: 400 }
      );
    }

    const redirectTo = buildOnboardingRedirectUrl(request);

    const accessLink = await generateAccessUserLink(supabase, {
      email: targetProfile.email,
      display_name: targetProfile.display_name,
      redirectTo,
      mode: parsed.data.mode,
      auth_user_id: targetProfile.auth_user_id
    });
    const resolvedProfile =
      targetProfile.auth_user_id === accessLink.auth_user_id
        ? targetProfile
        : await saveAccessProfile(supabase, {
            id: targetProfile.id,
            reference: targetProfile.reference,
            display_name: targetProfile.display_name,
            email: targetProfile.email,
            role: targetProfile.role,
            status: targetProfile.status,
            auth_user_id: accessLink.auth_user_id
          });

    try {
      await recordAccessAudit(supabase, {
        actor: sessionUser,
        action:
          parsed.data.mode === "onboarding"
            ? "access.user.onboarding_link.generated"
            : "access.user.recovery_link.generated",
        entity_type: "access_user",
        entity_id: resolvedProfile.id,
        after_data: {
          ...serializeAccessProfile(resolvedProfile),
          requested_mode: accessLink.requested_mode,
          delivery: accessLink.delivery
        }
      });
    } catch (auditError) {
      console.error("No se pudo auditar la generación del enlace de acceso", auditError);
    }

    return NextResponse.json({
      user: serializeAccessProfile(resolvedProfile),
      access_link: {
        requested_mode: accessLink.requested_mode,
        delivery: accessLink.delivery,
        url: accessLink.url
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo generar el enlace seguro del usuario") },
      { status: accessErrorStatus(error) }
    );
  }
}
