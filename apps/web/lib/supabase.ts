import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabaseConfig } from "@/lib/env";

export function createSupabaseAdminClient(): SupabaseClient | null {
  if (!hasSupabaseConfig()) {
    return null;
  }

  const key = env.supabaseServiceRoleKey ?? env.supabasePublishableKey;
  if (!key) {
    return null;
  }

  return createClient(env.supabaseUrl!, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function requireSupabaseAdminClient(): SupabaseClient {
  const client = createSupabaseAdminClient();
  if (!client) {
    throw new Error(
      "Supabase no configurado. Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_PUBLISHABLE_KEY)."
    );
  }
  return client;
}
