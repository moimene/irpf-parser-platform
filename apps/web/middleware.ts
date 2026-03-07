import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseAuthEnabled } from "@/lib/supabase-auth";
import { createSupabaseMiddlewareAuthClient } from "@/lib/supabase-auth-server";

function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/onboarding" ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/api/webhooks/parse-event")
  );
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|map)$/.test(pathname)
  );
}

export async function middleware(request: NextRequest) {
  if (!isSupabaseAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const supabase = createSupabaseMiddlewareAuthClient(request, response);
  if (!supabase) {
    return response;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isPublicRoute(pathname)) {
    return response;
  }

  if (user) {
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sesión no autenticada." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
