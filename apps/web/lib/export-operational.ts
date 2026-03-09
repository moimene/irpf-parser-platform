import type { ExportValidationSummary } from "@/lib/rules/validation";

export type OperationalDownloadFormat = "aeat" | "report" | "xls";

export type OperationalReportInput = {
  model: "100" | "714" | "720";
  expediente_reference: string;
  fiscal_year: number;
  client_name: string | null;
  nif: string | null;
  summary_lines: string[];
  validation: ExportValidationSummary;
  rows: Array<Record<string, string | number | null>>;
};

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

export function buildOperationalSpreadsheet(input: {
  rows: Array<Record<string, string | number | null>>;
}): string {
  if (input.rows.length === 0) {
    return "sin_datos\r\n";
  }

  const headers = [...new Set(input.rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.join("\t"),
    ...input.rows.map((row) => headers.map((header) => escapeCell(row[header])).join("\t"))
  ];

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function buildOperationalReport(input: OperationalReportInput): string {
  const lines: string[] = [];
  lines.push(`MODELO ${input.model}`);
  lines.push(`Expediente: ${input.expediente_reference}`);
  lines.push(`Ejercicio: ${input.fiscal_year}`);
  lines.push(`Cliente: ${input.client_name ?? "Sin cliente"}`);
  if (input.nif) {
    lines.push(`NIF: ${input.nif}`);
  }
  lines.push("");
  lines.push("Resumen");
  lines.push(...input.summary_lines.map((line) => `- ${line}`));
  lines.push("");
  lines.push(`Estado de validación: ${input.validation.validationState}`);
  if (input.validation.messages.length > 0) {
    lines.push("Mensajes");
    lines.push(...input.validation.messages.map((message) => `- ${message}`));
  } else {
    lines.push("Mensajes");
    lines.push("- Sin observaciones.");
  }
  lines.push("");
  lines.push(`Registros operativos: ${input.rows.length}`);
  if (input.rows.length > 0) {
    lines.push("");
    lines.push("Detalle");
    for (const row of input.rows) {
      const detail = Object.entries(row)
        .map(([key, value]) => `${key}: ${escapeCell(value)}`)
        .join(" | ");
      lines.push(`- ${detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
