import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-auth-legacy-server";

/**
 * Callback de Supabase Auth.
 * Gestiona el intercambio de código para magic links y OAuth.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Error en el intercambio de código
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
