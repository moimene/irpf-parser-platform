import { createHash } from "node:crypto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function toDeterministicUuid(seed: string): string {
  const digest = createHash("sha256").update(`irpf-expediente:${seed}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

export function normalizeExpedienteId(reference: string): {
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

  return {
    reference: cleaned,
    id: toDeterministicUuid(cleaned),
    normalized: true
  };
}
