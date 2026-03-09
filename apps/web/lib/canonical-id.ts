import { createHash } from "node:crypto";

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toDeterministicCanonicalUuid(seed: string): string {
  const digest = createHash("sha256").update(`irpf-canonical:${seed}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

export function toDeterministicCanonicalAssetId(clientId: string, assetKey: string): string {
  return toDeterministicCanonicalUuid(`asset:${clientId}:${assetKey}`);
}

export function toDeterministicCanonicalFiscalEventId(
  expedienteId: string,
  sourceEventId: string
): string {
  return toDeterministicCanonicalUuid(`event:${expedienteId}:${sourceEventId}`);
}
