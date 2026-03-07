import { createHash } from "node:crypto";
import { isUuid } from "@/lib/expediente-id";

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function slugifyClientReference(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "cliente";
}

export function toDeterministicClientUuid(seed: string): string {
  const digest = createHash("sha256").update(`irpf-client:${seed}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

export function normalizeClientId(reference: string): {
  reference: string;
  id: string;
  normalized: boolean;
} {
  const cleaned = reference.trim();
  if (isUuid(cleaned)) {
    return {
      reference: cleaned,
      id: cleaned,
      normalized: false
    };
  }

  const normalizedReference = slugifyClientReference(cleaned);
  return {
    reference: normalizedReference,
    id: toDeterministicClientUuid(normalizedReference),
    normalized: true
  };
}
