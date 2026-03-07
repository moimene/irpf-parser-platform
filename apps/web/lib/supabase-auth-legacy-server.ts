import { getCurrentSessionUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { createSupabaseServerAuthClient } from "@/lib/supabase-auth-server";

const LEGACY_ROLE_MAP: Record<string, string> = {
  admin: "socio",
  fiscal_senior: "asociado",
  fiscal_junior: "paralegal",
  solo_lectura: "paralegal"
};

export async function createSupabaseServerClient() {
  const client = createSupabaseServerAuthClient();
  if (!client) {
    throw new Error("Supabase Auth no configurado para servidor.");
  }

  return client;
}

export async function getAbogadoActual(_supabase?: unknown) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return null;
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    return {
      id: sessionUser.id,
      nombre: sessionUser.display_name,
      email: sessionUser.email,
      rol: LEGACY_ROLE_MAP[sessionUser.role] ?? "paralegal",
      activo: sessionUser.status === "active"
    };
  } catch {
    return null;
  }
}
