import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

function hasBrowserAuthConfig(): boolean {
  return Boolean(env.supabaseUrl && env.supabasePublishableKey);
}

export function isSupabaseAuthEnabled(): boolean {
  return hasBrowserAuthConfig();
}

export function createSupabaseBrowserAuthClient() {
  if (!hasBrowserAuthConfig()) {
    throw new Error("Supabase Auth no configurado para cliente.");
  }

  return createBrowserClient(env.supabaseUrl!, env.supabasePublishableKey!);
}
