import type { ParsedRecord, SourceSpan } from "@/lib/contracts";

type JsonObject = Record<string, unknown>;
type ParsedFieldValue = string | number | boolean | null;

const parsedRecordTypes = new Set<ParsedRecord["record_type"]>([
  "CUENTA",
  "VALOR",
  "IIC",
  "SEGURO",
  "INMUEBLE",
  "BIEN_MUEBLE",
  "DIVIDENDO",
  "INTERES",
  "RENTA",
  "RETENCION",
  "COMPRA",
  "VENTA",
  "POSICION",
  "CUENTA_BANCARIA",
  "MOVIMIENTO",
  "DESCONOCIDO"
]);

const correctionMetadataKeys = new Set([
  "index",
  "record_index",
  "fields",
  "record_type",
  "confidence",
  "source_spans",
  "records"
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isParsedFieldValue(value: unknown): value is ParsedFieldValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function sanitizeFields(value: unknown): Record<string, ParsedFieldValue> {
  if (!isObject(value)) {
    return {};
  }

  const sanitized: Record<string, ParsedFieldValue> = {};

  for (const [fieldKey, fieldValue] of Object.entries(value)) {
    if (isParsedFieldValue(fieldValue)) {
      sanitized[fieldKey] = fieldValue;
    }
  }

  return sanitized;
}

function cloneSourceSpans(value: unknown): SourceSpan[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isObject(item)) {
      return [];
    }

    const page = typeof item.page === "number" ? item.page : Number(item.page);
    const start = typeof item.start === "number" ? item.start : Number(item.start);
    const end = typeof item.end === "number" ? item.end : Number(item.end);
    if (!Number.isFinite(page) || !Number.isFinite(start) || !Number.isFinite(end)) {
      return [];
    }

    return [
      {
        page,
        start,
        end,
        snippet: typeof item.snippet === "string" ? item.snippet : undefined
      }
    ];
  });
}

function normalizeParsedRecord(record: ParsedRecord | Record<string, unknown>): ParsedRecord {
  const recordTypeCandidate =
    typeof record.record_type === "string" && parsedRecordTypes.has(record.record_type as ParsedRecord["record_type"])
      ? (record.record_type as ParsedRecord["record_type"])
      : "DESCONOCIDO";
  const confidenceCandidate =
    typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? record.confidence
      : 0;

  return {
    record_type: recordTypeCandidate,
    fields: sanitizeFields(record.fields),
    confidence: confidenceCandidate,
    source_spans: cloneSourceSpans(record.source_spans)
  };
}

function extractFieldPatch(correction: JsonObject): Record<string, ParsedFieldValue> {
  if (isObject(correction.fields)) {
    return sanitizeFields(correction.fields);
  }

  const patch: Record<string, ParsedFieldValue> = {};

  for (const [key, value] of Object.entries(correction)) {
    if (correctionMetadataKeys.has(key)) {
      continue;
    }

    if (isParsedFieldValue(value)) {
      patch[key] = value;
    }
  }

  return patch;
}

function normalizeCorrections(correctedFields: unknown): JsonObject[] {
  if (!isObject(correctedFields)) {
    return [];
  }

  if (Array.isArray(correctedFields.records)) {
    return correctedFields.records.filter(isObject);
  }

  return [correctedFields];
}

function resolveTargetIndex(correction: JsonObject, fallbackIndex: number, recordsCount: number): number {
  const rawCandidate = correction.record_index ?? correction.index ?? fallbackIndex;
  const candidate =
    typeof rawCandidate === "number" ? rawCandidate : typeof rawCandidate === "string" ? Number(rawCandidate) : fallbackIndex;
  if (!Number.isInteger(candidate) || candidate < 0 || candidate >= recordsCount) {
    return -1;
  }
  return candidate;
}

export function applyCorrectedFieldsToRecords(
  records: Array<ParsedRecord | Record<string, unknown>>,
  correctedFields: unknown
): ParsedRecord[] {
  const normalizedRecords = records.map((record) => normalizeParsedRecord(record));
  const corrections = normalizeCorrections(correctedFields);

  if (corrections.length === 0) {
    return normalizedRecords;
  }

  const patchedRecords = normalizedRecords.map((record) => ({
    ...record,
    fields: { ...record.fields },
    source_spans: [...record.source_spans]
  }));

  corrections.forEach((correction, fallbackIndex) => {
    const targetIndex = resolveTargetIndex(correction, fallbackIndex, patchedRecords.length);
    if (targetIndex < 0) {
      return;
    }

    const nextRecord = patchedRecords[targetIndex];
    const fieldPatch = extractFieldPatch(correction);

    if (Object.keys(fieldPatch).length > 0) {
      nextRecord.fields = {
        ...nextRecord.fields,
        ...fieldPatch
      };
    }

    if (
      typeof correction.record_type === "string" &&
      parsedRecordTypes.has(correction.record_type as ParsedRecord["record_type"])
    ) {
      nextRecord.record_type = correction.record_type as ParsedRecord["record_type"];
    }

    if (typeof correction.confidence === "number" && Number.isFinite(correction.confidence)) {
      nextRecord.confidence = correction.confidence;
    }

    if (Array.isArray(correction.source_spans)) {
      nextRecord.source_spans = cloneSourceSpans(correction.source_spans);
    }
  });

  return patchedRecords;
}
