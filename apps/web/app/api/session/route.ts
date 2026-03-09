import { NextResponse } from "next/server";
import { z } from "zod";
import { findProfileByReference, listAccessProfiles } from "@/lib/access-store";
import {
  accessErrorMessage,
  accessErrorStatus,
  currentAuthMode,
  defaultSessionReference,
  getCurrentSessionUser,
  sessionCookieName
} from "@/lib/auth";
import { resolveRuntimeEnvironmentKind } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const sessionSchema = z.object({
  user_reference: z.string().min(2).max(80)
});

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const authMode = await currentAuthMode();
    const currentUser = await getCurrentSessionUser(supabase);
    const responsePayload: {
      auth_mode: "supabase" | "demo";
      runtime_environment: "demo" | "sandbox" | "operational";
      current_user: typeof currentUser;
      default_reference: string;
      available_users?: Array<{
        id: string;
        reference: string;
        display_name: string;
        email: string;
        role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
      }>;
    } = {
      auth_mode: authMode,
      runtime_environment: resolveRuntimeEnvironmentKind(),
      current_user: currentUser,
      default_reference: defaultSessionReference()
    };

    if (authMode === "demo") {
      const users = await listAccessProfiles(supabase);
      responsePayload.available_users = users.map((user) => ({
        id: user.id,
        reference: user.reference,
        display_name: user.display_name,
        email: user.email,
        role: user.role
      }));
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar la sesión") },
      { status: accessErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const authMode = await currentAuthMode().catch(() => "demo");
  if (authMode === "supabase") {
    return NextResponse.json(
      { error: "La sesión real se gestiona vía Supabase Auth y no admite cambio manual." },
      { status: 405 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = sessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido de sesión", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const profile = await findProfileByReference(supabase, parsed.data.user_reference.trim());
  if (!profile || profile.status !== "active") {
    return NextResponse.json({ error: "Usuario de sesión no encontrado" }, { status: 404 });
  }

  const response = NextResponse.json({
    current_user: profile
  });

  response.cookies.set({
    name: sessionCookieName(),
    value: profile.reference,
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    secure: false,
    maxAge: 60 * 60 * 24 * 30
  });

  return response;
}
