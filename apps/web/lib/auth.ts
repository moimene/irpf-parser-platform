import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  bindProfileAuthUserId,
  findProfileByAuthUserId,
  findProfileByEmail,
  findProfileByReference,
  listClientAssignments,
  type AccessProfile
} from "@/lib/access-store";
import { dbTables } from "@/lib/db-tables";
import { isSupabaseAuthEnabled } from "@/lib/supabase-auth";
import { createSupabaseServerAuthClient } from "@/lib/supabase-auth-server";

export type AppRole = "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
export type AppPermission =
  | "dashboard.read"
  | "clients.read"
  | "clients.write"
  | "expedientes.read"
  | "expedientes.write"
  | "documents.intake"
  | "review.write"
  | "exports.generate"
  | "access.manage";

export type SessionUser = AccessProfile;

const SESSION_COOKIE = "irpf_user_ref";
const DEFAULT_USER_REFERENCE = "demo-admin";

const ROLE_PERMISSIONS: Record<AppRole, readonly AppPermission[]> = {
  admin: [
    "dashboard.read",
    "clients.read",
    "clients.write",
    "expedientes.read",
    "expedientes.write",
    "documents.intake",
    "review.write",
    "exports.generate",
    "access.manage"
  ],
  fiscal_senior: [
    "dashboard.read",
    "clients.read",
    "expedientes.read",
    "expedientes.write",
    "documents.intake",
    "review.write",
    "exports.generate"
  ],
  fiscal_junior: [
    "dashboard.read",
    "clients.read",
    "expedientes.read",
    "expedientes.write",
    "documents.intake"
  ],
  solo_lectura: [
    "dashboard.read",
    "clients.read",
    "expedientes.read"
  ]
};

export class AccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

type AuthResolution =
  | {
      mode: "supabase";
      auth_user_id: string;
      auth_email: string;
    }
  | {
      mode: "demo";
      reference: string;
    };

function sessionCookieReference(): string {
  const cookieValue = cookies().get(SESSION_COOKIE)?.value?.trim();
  return cookieValue || DEFAULT_USER_REFERENCE;
}

async function loadUserByReference(
  supabase: SupabaseClient,
  reference: string
): Promise<SessionUser | null> {
  return findProfileByReference(supabase, reference);
}

async function resolveAuthSession(): Promise<AuthResolution> {
  if (!isSupabaseAuthEnabled()) {
    return {
      mode: "demo",
      reference: sessionCookieReference()
    };
  }

  const authClient = createSupabaseServerAuthClient();
  if (!authClient) {
    return {
      mode: "demo",
      reference: sessionCookieReference()
    };
  }

  const {
    data: { user },
    error
  } = await authClient.auth.getUser();

  if (error) {
    throw new AccessError("No se pudo validar la sesión del despacho.", 401);
  }

  if (!user?.email) {
    throw new AccessError("Sesión no autenticada.", 401);
  }

  return {
    mode: "supabase",
    auth_user_id: user.id,
    auth_email: user.email.trim().toLowerCase()
  };
}

export async function getCurrentSessionUser(supabase: SupabaseClient): Promise<SessionUser> {
  const session = await resolveAuthSession();
  if (session.mode === "supabase") {
    const linkedProfile = await findProfileByAuthUserId(supabase, session.auth_user_id);
    if (linkedProfile) {
      if (linkedProfile.status !== "active") {
        throw new AccessError(
          "Tu usuario autenticado no tiene un perfil activo en la plataforma.",
          403
        );
      }

      return linkedProfile;
    }

    const emailProfile = await findProfileByEmail(supabase, session.auth_email);
    if (!emailProfile || emailProfile.status !== "active") {
      throw new AccessError(
        "Tu usuario autenticado no tiene un perfil activo en la plataforma.",
        403
      );
    }

    if (emailProfile.auth_user_id && emailProfile.auth_user_id !== session.auth_user_id) {
      throw new AccessError(
        "El perfil del despacho está vinculado a un identificador de autenticación distinto.",
        403
      );
    }

    return bindProfileAuthUserId(supabase, {
      id: emailProfile.id,
      auth_user_id: session.auth_user_id
    });
  }

  const requestedReference = sessionCookieReference();
  const requestedUser = await loadUserByReference(supabase, requestedReference);
  if (requestedUser && requestedUser.status === "active") {
    return requestedUser;
  }

  const fallbackUser = await loadUserByReference(supabase, DEFAULT_USER_REFERENCE);
  if (!fallbackUser || fallbackUser.status !== "active") {
    throw new Error("No existe usuario de sesión por defecto configurado.");
  }

  return fallbackUser;
}

export async function currentAuthMode(): Promise<"supabase" | "demo"> {
  const session = await resolveAuthSession().catch((error) => {
    if (error instanceof AccessError && error.status === 401 && isSupabaseAuthEnabled()) {
      return { mode: "supabase", auth_user_id: "", auth_email: "" } as const;
    }

    throw error;
  });

  return session.mode;
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function defaultSessionReference(): string {
  return DEFAULT_USER_REFERENCE;
}

export function hasPermission(user: SessionUser, permission: AppPermission): boolean {
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

export function requirePermission(user: SessionUser, permission: AppPermission): void {
  if (!hasPermission(user, permission)) {
    throw new AccessError("No tienes permisos suficientes para esta operación.", 403);
  }
}

export async function listAccessibleClientIds(
  supabase: SupabaseClient,
  user: SessionUser
): Promise<string[]> {
  if (user.role === "admin") {
    const { data, error } = await supabase.from(dbTables.clients).select("id");
    if (error) {
      throw new Error(`No se pudo resolver el scope de clientes: ${error.message}`);
    }

    return (data ?? []).map((row) => String(row.id));
  }

  const assignments = await listClientAssignments(supabase);
  return [
    ...new Set(
      assignments
        .filter((assignment) => assignment.user_id === user.id)
        .map((assignment) => String(assignment.client_id))
    )
  ];
}

export async function listAccessibleExpedienteIds(
  supabase: SupabaseClient,
  user: SessionUser
): Promise<string[]> {
  if (user.role === "admin") {
    const { data, error } = await supabase.from(dbTables.expedientes).select("id");
    if (error) {
      throw new Error(`No se pudo resolver el scope de expedientes: ${error.message}`);
    }

    return (data ?? []).map((row) => String(row.id));
  }

  const clientIds = await listAccessibleClientIds(supabase, user);
  if (clientIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from(dbTables.expedientes)
    .select("id")
    .in("client_id", clientIds);

  if (error) {
    throw new Error(`No se pudieron cargar expedientes accesibles: ${error.message}`);
  }

  return (data ?? []).map((row) => String(row.id));
}

export async function assertClientAccess(
  supabase: SupabaseClient,
  user: SessionUser,
  clientId: string,
  permission: AppPermission
): Promise<void> {
  requirePermission(user, permission);
  if (user.role === "admin") {
    return;
  }

  const accessibleClientIds = await listAccessibleClientIds(supabase, user);
  if (!accessibleClientIds.includes(clientId)) {
    throw new AccessError("No tienes acceso al cliente solicitado.", 403);
  }
}

export async function assertExpedienteAccess(
  supabase: SupabaseClient,
  user: SessionUser,
  expedienteId: string,
  permission: AppPermission
): Promise<{ client_id: string | null }> {
  requirePermission(user, permission);

  const { data, error } = await supabase
    .from(dbTables.expedientes)
    .select("id, client_id")
    .eq("id", expedienteId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo resolver el expediente para control de acceso: ${error.message}`);
  }

  if (!data) {
    throw new AccessError("Expediente no encontrado.", 404);
  }

  const clientId = data.client_id as string | null;
  if (user.role === "admin") {
    return { client_id: clientId };
  }

  if (!clientId) {
    throw new AccessError("El expediente no está asignado a un cliente accesible.", 403);
  }

  await assertClientAccess(supabase, user, clientId, permission);
  return { client_id: clientId };
}

export async function assertDocumentAccess(
  supabase: SupabaseClient,
  user: SessionUser,
  documentId: string,
  permission: AppPermission
): Promise<{ expediente_id: string; client_id: string | null }> {
  requirePermission(user, permission);

  const { data, error } = await supabase
    .from(dbTables.documents)
    .select("id, expediente_id")
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo resolver el documento para control de acceso: ${error.message}`);
  }

  if (!data) {
    throw new AccessError("Documento no encontrado.", 404);
  }

  const access = await assertExpedienteAccess(supabase, user, String(data.expediente_id), permission);
  return {
    expediente_id: String(data.expediente_id),
    client_id: access.client_id
  };
}

export function accessErrorStatus(error: unknown): number {
  return error instanceof AccessError ? error.status : 500;
}

export function accessErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
