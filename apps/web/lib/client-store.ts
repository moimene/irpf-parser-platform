import type { SupabaseClient } from "@supabase/supabase-js";
import { slugifyClientReference, toDeterministicClientUuid } from "@/lib/client-id";
import { isUuid } from "@/lib/expediente-id";
import { dbTables } from "@/lib/db-tables";

const filingScopes = ["individual", "joint", "pending"] as const;
const holderConditions = ["titular", "cotitular", "no_titular", "pending"] as const;
const spouseConditions = ["sin_conyuge", ...holderConditions] as const;
const fiscalLinkTypes = [
  "sin_conyuge",
  "gananciales",
  "separacion_bienes",
  "pareja_hecho",
  "otro",
  "pending"
] as const;

export type FiscalFilingScope = (typeof filingScopes)[number];
export type FiscalHolderCondition = (typeof holderConditions)[number];
export type FiscalSpouseCondition = (typeof spouseConditions)[number];
export type FiscalLinkType = (typeof fiscalLinkTypes)[number];

export type FiscalUnitRecord = {
  primary_taxpayer_name: string | null;
  primary_taxpayer_nif: string | null;
  spouse_name: string | null;
  spouse_nif: string | null;
  filing_scope: FiscalFilingScope;
  declarant_condition: FiscalHolderCondition;
  spouse_condition: FiscalSpouseCondition;
  fiscal_link_type: FiscalLinkType;
  notes: string | null;
};

export type ClientRecord = {
  id: string;
  reference: string;
  display_name: string;
  nif: string;
  email: string | null;
  status: "active" | "inactive" | "archived";
  contact_person: string | null;
  notes: string | null;
  fiscal_unit: FiscalUnitRecord;
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

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readEnum<T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  fallback: T[number]
): T[number] {
  return typeof value === "string" && allowedValues.includes(value) ? (value as T[number]) : fallback;
}

function defaultFiscalUnit(displayName: string, nif: string): FiscalUnitRecord {
  return {
    primary_taxpayer_name: displayName,
    primary_taxpayer_nif: nif,
    spouse_name: null,
    spouse_nif: null,
    filing_scope: "pending",
    declarant_condition: "pending",
    spouse_condition: "pending",
    fiscal_link_type: "pending",
    notes: null
  };
}

function mapFiscalUnit(row: ClientRow): FiscalUnitRecord {
  const metadata = row.metadata ?? {};
  const rawUnit =
    typeof metadata.fiscal_unit === "object" && metadata.fiscal_unit !== null
      ? (metadata.fiscal_unit as JsonObject)
      : {};
  const fallback = defaultFiscalUnit(row.display_name, row.nif);

  return {
    primary_taxpayer_name: readString(rawUnit.primary_taxpayer_name) ?? fallback.primary_taxpayer_name,
    primary_taxpayer_nif: readString(rawUnit.primary_taxpayer_nif) ?? fallback.primary_taxpayer_nif,
    spouse_name: readString(rawUnit.spouse_name),
    spouse_nif: readString(rawUnit.spouse_nif),
    filing_scope: readEnum(rawUnit.filing_scope, filingScopes, fallback.filing_scope),
    declarant_condition: readEnum(rawUnit.declarant_condition, holderConditions, fallback.declarant_condition),
    spouse_condition: readEnum(rawUnit.spouse_condition, spouseConditions, fallback.spouse_condition),
    fiscal_link_type: readEnum(rawUnit.fiscal_link_type, fiscalLinkTypes, fallback.fiscal_link_type),
    notes: readString(rawUnit.notes)
  };
}

function mapClient(row: ClientRow): ClientRecord {
  const metadata = row.metadata ?? {};

  return {
    id: row.id,
    reference: row.reference,
    display_name: row.display_name,
    nif: row.nif,
    email: row.email,
    status: row.status,
    contact_person: readString(metadata.contact_person),
    notes: readString(metadata.notes),
    fiscal_unit: mapFiscalUnit(row),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeFiscalUnit(unit: FiscalUnitRecord): FiscalUnitRecord {
  const spouseCondition = unit.spouse_condition;
  const clearSpouse = spouseCondition === "sin_conyuge";
  const fiscalLinkType = clearSpouse ? "sin_conyuge" : unit.fiscal_link_type;

  return {
    primary_taxpayer_name: readString(unit.primary_taxpayer_name),
    primary_taxpayer_nif: readString(unit.primary_taxpayer_nif),
    spouse_name: clearSpouse ? null : readString(unit.spouse_name),
    spouse_nif: clearSpouse ? null : readString(unit.spouse_nif),
    filing_scope: readEnum(unit.filing_scope, filingScopes, "pending"),
    declarant_condition: readEnum(unit.declarant_condition, holderConditions, "pending"),
    spouse_condition: readEnum(spouseCondition, spouseConditions, "pending"),
    fiscal_link_type: readEnum(fiscalLinkType, fiscalLinkTypes, "pending"),
    notes: readString(unit.notes)
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
  const normalizedReference = slugifyClientReference(trimmed);

  const lookup = isUuid(trimmed)
    ? supabase
        .from(dbTables.clients)
        .select(clientSelect)
        .or(`id.eq.${trimmed},reference.eq.${normalizedReference}`)
    : supabase
        .from(dbTables.clients)
        .select(clientSelect)
        .eq("reference", normalizedReference);

  const { data, error } = await lookup.maybeSingle();

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
        notes: input.notes ?? null,
        fiscal_unit: defaultFiscalUnit(input.display_name, input.nif)
      }
    })
    .select(clientSelect)
    .single();

  if (error) {
    throw error;
  }

  return mapClient(data as ClientRow);
}

export async function updateClientFiscalUnitCompat(
  supabase: SupabaseClient,
  clientId: string,
  fiscalUnit: FiscalUnitRecord
): Promise<ClientRecord> {
  const { data: existing, error: existingError } = await supabase
    .from(dbTables.clients)
    .select(clientSelect)
    .eq("id", clientId)
    .single();

  if (existingError) {
    throw existingError;
  }

  const currentRow = existing as ClientRow;
  const currentMetadata = currentRow.metadata ?? {};
  const normalizedUnit = normalizeFiscalUnit(fiscalUnit);

  const { data, error } = await supabase
    .from(dbTables.clients)
    .update({
      metadata: {
        ...currentMetadata,
        fiscal_unit: normalizedUnit
      }
    })
    .eq("id", clientId)
    .select(clientSelect)
    .single();

  if (error) {
    throw error;
  }

  return mapClient(data as ClientRow);
}
