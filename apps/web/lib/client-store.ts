import type { SupabaseClient } from "@supabase/supabase-js";
import { slugifyClientReference, toDeterministicClientUuid } from "@/lib/client-id";
import { dbTables } from "@/lib/db-tables";

export type ClientRecord = {
  id: string;
  reference: string;
  display_name: string;
  nif: string;
  email: string | null;
  status: "active" | "inactive" | "archived";
  contact_person: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type JsonObject = Record<string, unknown>;

type ClientRow = {
  id: string;
  reference: string;
  display_name: string;
  nif: string;
  email: string | null;
  status: "active" | "inactive" | "archived";
  metadata: JsonObject | null;
  created_at: string;
  updated_at: string;
};

const clientSelect =
  "id, reference, display_name, nif, email, status, metadata, created_at, updated_at";

function mapClient(row: ClientRow): ClientRecord {
  const metadata = row.metadata ?? {};

  return {
    id: row.id,
    reference: row.reference,
    display_name: row.display_name,
    nif: row.nif,
    email: row.email,
    status: row.status,
    contact_person: typeof metadata.contact_person === "string" ? metadata.contact_person : null,
    notes: typeof metadata.notes === "string" ? metadata.notes : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function listClientsCompat(supabase: SupabaseClient): Promise<ClientRecord[]> {
  const { data, error } = await supabase
    .from(dbTables.clients)
    .select(clientSelect)
    .order("display_name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => mapClient(row as ClientRow));
}

export async function findClientCompat(
  supabase: SupabaseClient,
  referenceOrId: string
): Promise<ClientRecord | null> {
  const trimmed = referenceOrId.trim();

  const { data, error } = await supabase
    .from(dbTables.clients)
    .select(clientSelect)
    .or(`id.eq.${trimmed},reference.eq.${trimmed}`)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapClient(data as ClientRow) : null;
}

export async function createClientCompat(
  supabase: SupabaseClient,
  input: {
    reference?: string;
    display_name: string;
    nif: string;
    email?: string | null;
    contact_person?: string | null;
    notes?: string | null;
  }
): Promise<ClientRecord> {
  const reference = slugifyClientReference(input.reference ?? input.display_name);

  const { data, error } = await supabase
    .from(dbTables.clients)
    .insert({
      id: toDeterministicClientUuid(reference),
      full_name: input.display_name,
      reference,
      display_name: input.display_name,
      nif: input.nif,
      email: input.email ?? null,
      status: "active",
      metadata: {
        contact_person: input.contact_person ?? null,
        notes: input.notes ?? null
      }
    })
    .select(clientSelect)
    .single();

  if (error) {
    throw error;
  }

  return mapClient(data as ClientRow);
}
