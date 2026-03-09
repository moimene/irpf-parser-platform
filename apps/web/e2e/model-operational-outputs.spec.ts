import { expect, test } from "@playwright/test";
import {
  buildOperationalRowsForModel714,
  buildOperationalRowsForModel720,
  summarizeCanonicalAssets
} from "../lib/canonical-exports";
import { buildOperationalReport, buildOperationalSpreadsheet } from "../lib/export-operational";
import type { CanonicalAssetSummary } from "../lib/fiscal-canonical";
import { assessModel720Requirement } from "../lib/model-filing-rules";
import { validateModel714, validateModel720 } from "../lib/rules/validation";

const baseAsset: Omit<
  CanonicalAssetSummary,
  | "canonical_id"
  | "asset_key"
  | "isin"
  | "label"
  | "currencies"
  | "quantity_open"
  | "open_cost_basis"
  | "gross_amount_total"
  | "latest_event_date"
  | "country"
  | "year_end_value"
  | "foreign_block"
> = {
  notes: null,
  expedientes: ["CLI-2025-IP"],
  fiscal_years: [2025],
  events_total: 1,
  dividends: 0,
  interests: 0,
  acquisitions: 1,
  transmissions: 0,
  retentions: 0,
  gains_losses: 0,
  open_lots: 1,
  closed_lots: 0,
  realized_gain_total: null,
  pending_transmissions: 0,
  last_source: "MANUAL",
  asset_type: "security",
  holder_role: "titular",
  ownership_pct: 100,
  q4_avg_balance: null,
  valuation_method: "market_value"
};

test.describe("Salidas operativas por modelo", () => {
  test("mantiene informe operativo 714 aunque falten valoraciones", async () => {
    const assets: CanonicalAssetSummary[] = [
      {
        ...baseAsset,
        canonical_id: "asset-es",
        asset_key: "ES0000000001",
        isin: "ES0000000001",
        label: "Valor nacional sin valorar",
        currencies: ["EUR"],
        quantity_open: 10,
        open_cost_basis: null,
        gross_amount_total: null,
        latest_event_date: "2025-12-31",
        country: "ES",
        year_end_value: null,
        foreign_block: null
      },
      {
        ...baseAsset,
        canonical_id: "asset-us",
        asset_key: "US1234567890",
        isin: "US1234567890",
        label: "Valor extranjero valorado",
        currencies: ["USD"],
        quantity_open: 7,
        open_cost_basis: 2100,
        gross_amount_total: 2100,
        latest_event_date: "2025-12-31",
        country: "US",
        year_end_value: 2100,
        foreign_block: "securities"
      }
    ];

    const metrics = summarizeCanonicalAssets({ assets });
    const validation = validateModel714({
      totalAssets: metrics.totalAssets,
      missingValuationAssets: metrics.missingValuationAssets,
      missingOwnershipAssets: metrics.missingOwnershipAssets
    });
    const rows = buildOperationalRowsForModel714({ assets });
    const report = buildOperationalReport({
      model: "714",
      expediente_reference: "CLI-2025-IP",
      fiscal_year: 2025,
      client_name: "Ana Perez",
      nif: "12345678A",
      summary_lines: [
        `Activos patrimoniales: ${metrics.totalAssets}`,
        `Activos sin valoración declarable: ${metrics.missingValuationAssets}`
      ],
      validation,
      rows
    });

    expect(metrics.totalAssets).toBe(2);
    expect(metrics.missingValuationAssets).toBe(1);
    expect(validation.validationState).toBe("errors");
    expect(rows).toHaveLength(2);
    expect(report).toContain("Activos sin valoración declarable: 1");
    expect(report).toContain("Valor nacional sin valorar");
  });

  test("genera hoja XLS operativa 720 solo con activos extranjeros", async () => {
    const assets: CanonicalAssetSummary[] = [
      {
        ...baseAsset,
        canonical_id: "asset-es",
        asset_key: "ES0000000001",
        isin: "ES0000000001",
        label: "Valor nacional",
        currencies: ["EUR"],
        quantity_open: 3,
        open_cost_basis: 900,
        gross_amount_total: 900,
        latest_event_date: "2025-12-31",
        country: "ES",
        year_end_value: 900,
        foreign_block: null
      },
      {
        ...baseAsset,
        canonical_id: "asset-us",
        asset_key: "US1234567890",
        isin: "US1234567890",
        label: "Cuenta extranjera",
        asset_type: "account",
        currencies: ["USD"],
        quantity_open: 2,
        open_cost_basis: 60000,
        gross_amount_total: 60000,
        latest_event_date: "2025-12-31",
        country: "US",
        year_end_value: 60000,
        q4_avg_balance: 60000,
        valuation_method: "q4_average",
        foreign_block: "accounts"
      }
    ];

    const metrics = summarizeCanonicalAssets({ assets });
    const validation = validateModel720({
      foreignAssets: metrics.foreignAssets,
      missingForeignValuationAssets: metrics.missingForeignValuationAssets,
      missingForeignCountryAssets: metrics.missingForeignCountryAssets,
      missingForeignBlockAssets: metrics.missingForeignBlockAssets,
      missingForeignOwnershipAssets: metrics.missingOwnershipAssets,
      missingForeignQ4BalanceAssets: metrics.missingForeignQ4BalanceAssets,
      thresholdReachedBlocks: metrics.thresholdReachedBlocks.length,
      requirementAssessment: assessModel720Requirement({
        metrics
      })
    });
    const rows = buildOperationalRowsForModel720({ assets });
    const spreadsheet = buildOperationalSpreadsheet({ rows });

    expect(validation.validationState).toBe("ok");
    expect(rows).toEqual([
      expect.objectContaining({
        activo: "Cuenta extranjera",
        isin: "US1234567890",
        valor_extranjero: 60000,
        bloque_720: "accounts"
      })
    ]);
    expect(spreadsheet).toContain("activo\tbloque_720");
    expect(spreadsheet).toContain("Cuenta extranjera");
    expect(spreadsheet).not.toContain("Valor nacional");
  });
});
