import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isSupabaseAuthEnabled } from "@/lib/supabase-auth";

type CookieAdapter = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) => void;
};

function createCookieAdapter(): CookieAdapter {
  const cookieStore = cookies();

  return {
    getAll() {
      return cookieStore.getAll().map((item) => ({ name: item.name, value: item.value }));
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      } catch {
        // In some server rendering paths cookies are read-only. Middleware handles refresh writes.
      }
    }
  };
}

export function createSupabaseServerAuthClient() {
  if (!isSupabaseAuthEnabled()) {
    return null;
  }

  return createServerClient(env.supabaseUrl!, env.supabasePublishableKey!, {
    cookies: createCookieAdapter()
  });
}

export function createSupabaseMiddlewareAuthClient(
  request: NextRequest,
  response: NextResponse
) {
  if (!isSupabaseAuthEnabled()) {
    return null;
  }

  return createServerClient(env.supabaseUrl!, env.supabasePublishableKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((item) => ({ name: item.name, value: item.value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });
}
