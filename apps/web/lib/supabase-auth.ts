/**
 * Clientes Supabase con soporte de sesión via cookies (SSR).
 * Usar createSupabaseBrowserClient() en componentes cliente.
 * Usar createSupabaseServerClient() en Server Components y Route Handlers.
 */
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

const SUPABASE_URL = env.supabaseUrl!;
const SUPABASE_ANON_KEY = env.supabasePublishableKey!;

/** Cliente para componentes "use client" */
export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/** Cliente para Route Handlers y Server Components */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // En Server Components el set es ignorado (solo Route Handlers pueden setear)
        }
      },
    },
  });
}

/** Obtener el usuario autenticado actual (server-side) */
export async function getAuthUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Obtener el perfil del abogado actual con su rol */
export async function getAbogadoActual() {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("irpf_abogados")
    .select("id, nombre, email, rol, activo")
    .eq("id", user.id)
    .single();

  return data;
}
