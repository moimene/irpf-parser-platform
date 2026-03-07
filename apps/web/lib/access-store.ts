import type { SupabaseClient } from "@supabase/supabase-js";
import { dbTables } from "@/lib/db-tables";

export type AccessRole = "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
export type AccessStatus = "active" | "inactive";
export type AssignmentRole = "owner" | "manager" | "support" | "viewer";

export type AccessProfile = {
  id: string;
  reference: string;
  display_name: string;
  email: string;
  role: AccessRole;
  status: AccessStatus;
  auth_user_id: string | null;
};

export type ClientAssignment = {
  id: string;
  user_id: string;
  client_id: string;
  assignment_role: AssignmentRole;
  created_at: string;
};

type AccessProfileRow = {
  id: string;
  reference: string;
  display_name: string;
  email: string;
  role: AccessRole;
  status: AccessStatus;
  auth_user_id: string | null;
};

type ClientAssignmentRow = {
  id: string;
  user_id: string;
  client_id: string;
  assignment_role: AssignmentRole;
  created_at: string;
};

const accessProfileSelect = "id, reference, display_name, email, role, status, auth_user_id";
const clientAssignmentSelect = "id, user_id, client_id, assignment_role, created_at";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mapAccessProfile(row: AccessProfileRow): AccessProfile {
  return {
    id: row.id,
    reference: row.reference,
    display_name: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status,
    auth_user_id: row.auth_user_id ?? null
  };
}

function mapClientAssignment(row: ClientAssignmentRow): ClientAssignment {
  return row;
}

export async function listAccessProfiles(supabase: SupabaseClient): Promise<AccessProfile[]> {
  const { data, error } = await supabase
    .from(dbTables.users)
    .select(accessProfileSelect)
    .order("display_name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => mapAccessProfile(row as AccessProfileRow));
}

export async function findProfileByReference(
  supabase: SupabaseClient,
  reference: string
): Promise<AccessProfile | null> {
  const { data, error } = await supabase
    .from(dbTables.users)
    .select(accessProfileSelect)
    .eq("reference", reference.trim())
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapAccessProfile(data as AccessProfileRow) : null;
}

export async function findProfileByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<AccessProfile | null> {
  const { data, error } = await supabase
    .from(dbTables.users)
    .select(accessProfileSelect)
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapAccessProfile(data as AccessProfileRow) : null;
}

export async function findProfileByAuthUserId(
  supabase: SupabaseClient,
  authUserId: string
): Promise<AccessProfile | null> {
  const { data, error } = await supabase
    .from(dbTables.users)
    .select(accessProfileSelect)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapAccessProfile(data as AccessProfileRow) : null;
}

export async function bindProfileAuthUserId(
  supabase: SupabaseClient,
  input: {
    id: string;
    auth_user_id: string;
  }
): Promise<AccessProfile> {
  const { data, error } = await supabase
    .from(dbTables.users)
    .update({
      auth_user_id: input.auth_user_id
    })
    .eq("id", input.id)
    .select(accessProfileSelect)
    .single();

  if (error) {
    throw error;
  }

  return mapAccessProfile(data as AccessProfileRow);
}

export async function saveAccessProfile(
  supabase: SupabaseClient,
  input: {
    id?: string;
    reference: string;
    display_name: string;
    email: string;
    role: AccessRole;
    status: AccessStatus;
    auth_user_id?: string | null;
  }
): Promise<AccessProfile> {
  const payload = {
    reference: input.reference.trim(),
    display_name: input.display_name.trim(),
    email: normalizeEmail(input.email),
    role: input.role,
    status: input.status
  };

  const mutation = input.id
    ? supabase
        .from(dbTables.users)
        .update({
          ...payload,
          ...(input.auth_user_id !== undefined ? { auth_user_id: input.auth_user_id } : {})
        })
        .eq("id", input.id)
    : supabase.from(dbTables.users).insert({
        id: crypto.randomUUID(),
        ...payload,
        auth_user_id: input.auth_user_id ?? null
      });

  const { data, error } = await mutation.select(accessProfileSelect).single();

  if (error) {
    throw error;
  }

  return mapAccessProfile(data as AccessProfileRow);
}

export async function listClientAssignments(supabase: SupabaseClient): Promise<ClientAssignment[]> {
  const { data, error } = await supabase
    .from(dbTables.userClientAssignments)
    .select(clientAssignmentSelect)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => mapClientAssignment(row as ClientAssignmentRow));
}

export async function saveClientAssignment(
  supabase: SupabaseClient,
  input: {
    id?: string;
    user_id: string;
    client_id: string;
    assignment_role: AssignmentRole;
  }
): Promise<ClientAssignment> {
  const mutation = input.id
    ? supabase
        .from(dbTables.userClientAssignments)
        .update({ assignment_role: input.assignment_role })
        .eq("id", input.id)
    : supabase.from(dbTables.userClientAssignments).insert({
        user_id: input.user_id,
        client_id: input.client_id,
        assignment_role: input.assignment_role
      });

  const { data, error } = await mutation.select(clientAssignmentSelect).single();

  if (error) {
    throw error;
  }

  return mapClientAssignment(data as ClientAssignmentRow);
}

export async function removeClientAssignment(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<void> {
  const { error } = await supabase
    .from(dbTables.userClientAssignments)
    .delete()
    .eq("id", assignmentId);

  if (error) {
    throw error;
  }
}
