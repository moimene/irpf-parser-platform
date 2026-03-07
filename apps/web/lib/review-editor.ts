import type { ParsedRecord, SourceSpan, StructuredDocument, StructuredPage } from "@/lib/contracts";

type JsonObject = Record<string, unknown>;
type ParsedFieldValue = ParsedRecord["fields"][string];

const recordTypes: ParsedRecord["record_type"][] = [
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
];

const fieldPriority = [
  "operation_date",
  "event_date",
  "description",
  "entity_name",
  "isin",
  "security_identifier",
  "account_code",
  "country_code",
  "location_key",
  "tax_territory_code",
  "condition_key",
  "asset_key",
  "asset_subkey",
  "incorporation_date",
  "origin_key",
  "extinction_date",
  "quantity",
  "amount",
  "valuation_1_eur",
  "valuation_2_eur",
  "currency",
  "retention",
  "ownership_percentage",
  "realized_gain"
];

export type ReviewFieldKind = "text" | "number" | "date" | "boolean";

export type ReviewCorrectionPayload = {
  records: Array<{
    record_index: number;
    record_type: ParsedRecord["record_type"];
    confidence: number;
    source_spans: SourceSpan[];
    fields: Record<string, ParsedFieldValue>;
  }>;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isParsedFieldValue(value: unknown): value is ParsedFieldValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeFields(value: unknown): Record<string, ParsedFieldValue> {
  if (!isObject(value)) {
    return {};
  }

  const fields: Record<string, ParsedFieldValue> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (isParsedFieldValue(fieldValue)) {
      fields[key] = fieldValue;
    }
  }

  return fields;
}

export function normalizeSourceSpans(value: unknown): SourceSpan[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isObject(item)) {
      return [];
    }

    const page = toNullableNumber(item.page);
    const start = toNullableNumber(item.start);
    const end = toNullableNumber(item.end);

    if (page === null || start === null || end === null) {
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

export function normalizeParsedRecords(value: unknown): ParsedRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isObject(item)) {
      return [];
    }

    const recordType =
      typeof item.record_type === "string" && recordTypes.includes(item.record_type as ParsedRecord["record_type"])
        ? (item.record_type as ParsedRecord["record_type"])
        : "DESCONOCIDO";
    const confidence = toNullableNumber(item.confidence) ?? 0;

    return [
      {
        record_type: recordType,
        fields: normalizeFields(item.fields),
        confidence,
        source_spans: normalizeSourceSpans(item.source_spans)
      }
    ];
  });
}

function normalizeStructuredRows(value: unknown): Array<Array<string | null>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (!Array.isArray(row)) {
      return [];
    }

    return [
      row.map((cell) => {
        if (cell === null) {
          return null;
        }

        return typeof cell === "string" ? cell : String(cell);
      })
    ];
  });
}

export function normalizeStructuredDocument(value: unknown): StructuredDocument | null {
  if (!isObject(value)) {
    return null;
  }

  const sourceType =
    typeof value.source_type === "string" ? value.source_type : "UNKNOWN";
  const backend =
    typeof value.backend === "string" ? value.backend : "unknown";
  const metadata: StructuredDocument["metadata"] = {};
  if (isObject(value.metadata)) {
    for (const [key, item] of Object.entries(value.metadata)) {
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        metadata[key] = item;
      }
    }
  }

  const pages = Array.isArray(value.pages)
    ? value.pages.flatMap((page) => {
        if (!isObject(page)) {
          return [];
        }

        const pageNumber = toNullableNumber(page.page);
        if (pageNumber === null) {
          return [];
        }

        const tables = Array.isArray(page.tables)
          ? page.tables.flatMap((table) => {
              if (!isObject(table) || typeof table.table_id !== "string") {
                return [];
              }

              return [
                {
                  table_id: table.table_id,
                  page: toNullableNumber(table.page) ?? pageNumber,
                  source: typeof table.source === "string" ? table.source : `page:${pageNumber}`,
                  header: normalizeStructuredRows([table.header])[0] ?? [],
                  rows: normalizeStructuredRows(table.rows)
                }
              ];
            })
          : [];

        return [
          {
            page: pageNumber,
            text: typeof page.text === "string" ? page.text : "",
            tables
          } satisfies StructuredPage
        ];
      })
    : [];

  return {
    source_type: sourceType as StructuredDocument["source_type"],
    backend: backend as StructuredDocument["backend"],
    pages,
    metadata
  };
}

export function listRecordFieldKeys(fields: ParsedRecord["fields"]): string[] {
  const keys = Object.keys(fields);
  return [...keys].sort((left, right) => {
    const leftPriority = fieldPriority.indexOf(left);
    const rightPriority = fieldPriority.indexOf(right);

    if (leftPriority !== -1 || rightPriority !== -1) {
      if (leftPriority === -1) return 1;
      if (rightPriority === -1) return -1;
      return leftPriority - rightPriority;
    }

    return left.localeCompare(right);
  });
}

export function inferReviewFieldKind(
  key: string,
  value: ParsedFieldValue
): ReviewFieldKind {
  if (typeof value === "boolean") {
    return "boolean";
  }

  if (
    [
      "amount",
      "quantity",
      "retention",
      "realized_gain",
      "confidence",
      "valuation_1_eur",
      "valuation_2_eur",
      "ownership_percentage"
    ].includes(key) ||
    typeof value === "number"
  ) {
    return "number";
  }

  if (["operation_date", "event_date", "incorporation_date", "extinction_date"].includes(key)) {
    return "date";
  }

  return "text";
}

export function normalizeReviewFieldValue(
  key: string,
  rawValue: string | boolean,
  previousValue?: ParsedFieldValue
): ParsedFieldValue {
  const kind = inferReviewFieldKind(key, previousValue ?? null);

  if (kind === "boolean") {
    return Boolean(rawValue);
  }

  if (typeof rawValue !== "string") {
    return rawValue;
  }

  if (!rawValue.trim()) {
    return null;
  }

  if (kind === "number") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : previousValue ?? null;
  }

  return rawValue;
}

export function buildReviewCorrectionPayload(records: ParsedRecord[]): ReviewCorrectionPayload {
  return {
    records: records.map((record, index) => ({
      record_index: index,
      record_type: record.record_type,
      confidence: record.confidence,
      source_spans: record.source_spans,
      fields: { ...record.fields }
    }))
  };
}

export function collectRelevantStructuredPages(
  record: ParsedRecord | null,
  structuredDocument: StructuredDocument | null
): number[] {
  if (!record || !structuredDocument) {
    return structuredDocument?.pages.map((page) => page.page) ?? [];
  }

  const pages = Array.from(
    new Set(
      record.source_spans
        .map((span) => span.page)
        .filter((page) => structuredDocument.pages.some((item) => item.page === page))
    )
  );

  return pages.length > 0 ? pages : structuredDocument.pages.map((page) => page.page);
}

export function doesStructuredRowMatchRecord(
  row: Array<string | null>,
  record: ParsedRecord
): boolean {
  const haystack = row
    .filter((cell): cell is string => typeof cell === "string" && cell.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (!haystack) {
    return false;
  }

  const needles = [
    record.fields.isin,
    record.fields.description,
    ...record.source_spans.map((span) => span.snippet ?? null)
  ]
    .flatMap((value) => {
      if (typeof value !== "string") {
        return [];
      }

      const trimmed = value.trim().toLowerCase();
      return trimmed ? [trimmed] : [];
    });

  return needles.some((needle) => haystack.includes(needle));
}
