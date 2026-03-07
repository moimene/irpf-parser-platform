import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOnboardingRedirectUrl, generateAccessUserLink } from "@/lib/access-onboarding";
import { recordAccessAudit, serializeAccessProfile } from "@/lib/access-audit";
import { listAccessProfiles, saveAccessProfile } from "@/lib/access-store";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, requirePermission } from "@/lib/auth";
import { slugifyClientReference } from "@/lib/client-id";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  display_name: z.string().min(3).max(120),
  reference: z.string().min(2).max(80).optional(),
  email: z.string().email(),
  role: z.enum(["admin", "fiscal_senior", "fiscal_junior", "solo_lectura"]),
  status: z.enum(["active", "inactive"]).default("active")
});

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "access.manage");

    const body = await request.json().catch(() => null);
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido para nuevo usuario", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const reference = slugifyClientReference(parsed.data.reference ?? email.split("@")[0]);
    const redirectTo = buildOnboardingRedirectUrl(request);

    const existingProfiles = await listAccessProfiles(supabase);
    const existingProfile = existingProfiles.find((profile) => profile.email === email);
    if (existingProfile) {
      return NextResponse.json(
        { error: "Ya existe un perfil del despacho con ese email." },
        { status: 409 }
      );
    }

    const accessLink =
      parsed.data.status === "active"
        ? await generateAccessUserLink(supabase, {
            email,
            display_name: parsed.data.display_name.trim(),
            redirectTo,
            mode: "onboarding"
          })
        : null;

    let profileData;
    try {
      profileData = await saveAccessProfile(supabase, {
        reference,
        display_name: parsed.data.display_name.trim(),
        email,
        role: parsed.data.role,
        status: parsed.data.status,
        auth_user_id: accessLink?.auth_user_id ?? null
      });
    } catch (profileError) {
      if (accessLink?.created_auth_user) {
        await supabase.auth.admin.deleteUser(accessLink.auth_user_id);
      }
      return NextResponse.json(
        {
          error: `No se pudo crear el perfil persistente: ${
            profileError instanceof Error ? profileError.message : "unknown"
          }`
        },
        { status: 500 }
      );
    }

    try {
      await recordAccessAudit(supabase, {
        actor: sessionUser,
        action: "access.user.created",
        entity_type: "access_user",
        entity_id: profileData.id,
        after_data: serializeAccessProfile(profileData)
      });
    } catch (auditError) {
      console.error("No se pudo auditar el alta de usuario", auditError);
    }

    return NextResponse.json(
      {
        user: profileData,
        access_link: accessLink
          ? {
              requested_mode: accessLink.requested_mode,
              delivery: accessLink.delivery,
              url: accessLink.url
            }
          : null
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo crear el usuario del despacho") },
      { status: accessErrorStatus(error) }
    );
  }
}
