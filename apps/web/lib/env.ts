function clean(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .trim();
  return normalized ? normalized : undefined;
}

export const env = {
  supabaseUrl: clean(
    process.env.SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.VITE_SUPABASE_URL
  ),
  supabaseServiceRoleKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  supabasePublishableKey: clean(
    process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ),
  n8nWebhookUrl: clean(process.env.N8N_WEBHOOK_URL),
  parserServiceUrl: clean(process.env.PARSER_SERVICE_URL),
  autoParseOnIntake: clean(process.env.AUTO_PARSE_ON_INTAKE) === "true"
};

export function hasSupabaseConfig(): boolean {
  return Boolean(env.supabaseUrl && (env.supabaseServiceRoleKey || env.supabasePublishableKey));
}
