import { NextResponse } from "next/server";
import { createSupabaseServerAuthClient } from "@/lib/supabase-auth-server";

export const dynamic = "force-dynamic";

function resolveNextPath(candidate: string | null): string {
  if (!candidate || !candidate.startsWith("/")) {
    return "/onboarding";
  }

  return candidate;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = resolveNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "El enlace de acceso no es válido o ya ha caducado.");
    return NextResponse.redirect(loginUrl);
  }

  const authClient = createSupabaseServerAuthClient();
  if (!authClient) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "Supabase Auth no está configurado en este entorno.");
    return NextResponse.redirect(loginUrl);
  }

  const { error } = await authClient.auth.exchangeCodeForSession(code);
  if (error) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "No se pudo completar el acceso seguro. Solicita un enlace nuevo.");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(nextPath, request.url));
}
