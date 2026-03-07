import type { DocumentSourceType } from "@/lib/contracts";

const excelMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
]);

export function inferDocumentSourceType(
  filename: string,
  contentType?: string | null
): DocumentSourceType {
  const normalizedType = contentType?.toLowerCase().trim() ?? "";
  const normalizedFilename = filename.toLowerCase();

  if (
    normalizedType === "application/pdf" ||
    normalizedFilename.endsWith(".pdf")
  ) {
    return "PDF";
  }

  if (
    normalizedType.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif", ".webp"].some((ext) =>
      normalizedFilename.endsWith(ext)
    )
  ) {
    return "IMAGE";
  }

  if (normalizedType === "text/csv" || normalizedFilename.endsWith(".csv")) {
    return "CSV";
  }

  if (excelMimeTypes.has(normalizedType) || normalizedFilename.endsWith(".xlsx") || normalizedFilename.endsWith(".xls")) {
    return "XLSX";
  }

  if (
    normalizedType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    normalizedFilename.endsWith(".docx")
  ) {
    return "DOCX";
  }

  return "PDF";
}

export function mimeTypeForDocumentSourceType(sourceType: DocumentSourceType, fallback?: string | null): string {
  if (fallback?.trim()) {
    return fallback;
  }

  switch (sourceType) {
    case "CSV":
      return "text/csv";
    case "XLSX":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "DOCX":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "IMAGE":
      return "image/*";
    case "PDF":
    default:
      return "application/pdf";
  }
}
