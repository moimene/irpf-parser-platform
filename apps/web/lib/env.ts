function clean(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .trim();
  return normalized ? normalized : undefined;
}

export const env = {
  appEnvironment: clean(
    process.env.APP_ENVIRONMENT ??
      process.env.NEXT_PUBLIC_APP_ENVIRONMENT ??
      process.env.VITE_APP_ENVIRONMENT
  ),
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
  supabaseStorageBucket:
    clean(process.env.SUPABASE_STORAGE_BUCKET ?? process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET) ??
    "irpf-documents",
  n8nWebhookUrl: clean(process.env.N8N_WEBHOOK_URL),
  parserServiceUrl: clean(process.env.PARSER_SERVICE_URL),
  autoParseOnIntake: clean(process.env.AUTO_PARSE_ON_INTAKE) === "true"
};

export function hasSupabaseConfig(): boolean {
  return Boolean(env.supabaseUrl && (env.supabaseServiceRoleKey || env.supabasePublishableKey));
}

export type RuntimeEnvironmentKind = "demo" | "sandbox" | "operational";

export function resolveRuntimeEnvironmentKind(): RuntimeEnvironmentKind {
  const explicit = env.appEnvironment?.trim().toLowerCase();
  if (explicit === "demo" || explicit === "sandbox" || explicit === "operational") {
    return explicit;
  }

  if (!hasSupabaseConfig()) {
    return "sandbox";
  }

  return process.env.NODE_ENV === "production" ? "operational" : "sandbox";
}

export function runtimeEnvironmentMeta(kind = resolveRuntimeEnvironmentKind()): {
  kind: RuntimeEnvironmentKind;
  label: string;
  description: string;
  shortLabel: string;
} {
  if (kind === "demo") {
    return {
      kind,
      label: "Demo",
      shortLabel: "Entorno demo",
      description: "Solo para demos y formación; no debe usarse para operación real del despacho."
    };
  }

  if (kind === "sandbox") {
    return {
      kind,
      label: "Sandbox",
      shortLabel: "Sandbox",
      description: "Entorno de validación funcional y pruebas controladas, sin operación real de clientes."
    };
  }

  return {
    kind,
    label: "Autenticado",
    shortLabel: "Entorno autenticado",
    description: "Entorno con autenticación real y trazabilidad gobernada, apto para presentación controlada y operación posterior."
  };
}
