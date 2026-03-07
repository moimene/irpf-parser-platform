import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionUser } from "@/lib/auth";
import type { AccessProfile, ClientAssignment } from "@/lib/access-store";
import { dbTables } from "@/lib/db-tables";

type JsonObject = Record<string, unknown>;

export type AccessAuditAction =
  | "access.user.created"
  | "access.user.updated"
  | "access.user.onboarding_link.generated"
  | "access.user.recovery_link.generated"
  | "access.assignment.created"
  | "access.assignment.updated"
  | "access.assignment.deleted";

export type AccessAuditEntityType = "access_user" | "access_assignment";

export type AccessAuditEntry = {
  id: number;
  user_id: string | null;
  action: AccessAuditAction;
  entity_type: AccessAuditEntityType;
  entity_id: string | null;
  before_data: JsonObject | null;
  after_data: JsonObject | null;
  created_at: string;
};

type AccessAuditRow = {
  id: number;
  user_id: string | null;
  action: AccessAuditAction;
  entity_type: AccessAuditEntityType;
  entity_id: string | null;
  before_data: JsonObject | null;
  after_data: JsonObject | null;
  created_at: string;
};

export function serializeAccessProfile(profile: AccessProfile): JsonObject {
  return {
    id: profile.id,
    reference: profile.reference,
    display_name: profile.display_name,
    email: profile.email,
    role: profile.role,
    status: profile.status,
    auth_user_id: profile.auth_user_id
  };
}

export function serializeClientAssignment(assignment: ClientAssignment): JsonObject {
  return {
    id: assignment.id,
    user_id: assignment.user_id,
    client_id: assignment.client_id,
    assignment_role: assignment.assignment_role,
    created_at: assignment.created_at
  };
}

export async function recordAccessAudit(
  supabase: SupabaseClient,
  input: {
    actor: SessionUser;
    action: AccessAuditAction;
    entity_type: AccessAuditEntityType;
    entity_id: string | null;
    before_data?: JsonObject | null;
    after_data?: JsonObject | null;
  }
): Promise<void> {
  const { error } = await supabase.from(dbTables.auditLog).insert({
    user_id: input.actor.id,
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    before_data: input.before_data ?? null,
    after_data: input.after_data ?? null
  });

  if (error) {
    throw error;
  }
}

export async function listAccessAuditEntries(
  supabase: SupabaseClient,
  limit = 20
): Promise<AccessAuditEntry[]> {
  const { data, error } = await supabase
    .from(dbTables.auditLog)
    .select("id, user_id, action, entity_type, entity_id, before_data, after_data, created_at")
    .like("action", "access.%")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => {
    const entry = row as AccessAuditRow;
    return {
      id: entry.id,
      user_id: entry.user_id,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      before_data: entry.before_data ?? null,
      after_data: entry.after_data ?? null,
      created_at: entry.created_at
    };
  });
}
