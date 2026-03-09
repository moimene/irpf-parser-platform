import { expect, test } from "@playwright/test";
import { evaluateModelPreparation } from "../lib/model-preparation";

test.describe("Preparación declarativa", () => {
  test("bloquea un IRPF sin unidad fiscal cerrada ni ventas cuadradas", async () => {
    const result = evaluateModelPreparation({
      model_type: "IRPF",
      has_client: true,
      client_nif: "12345678A",
      fiscal_unit: {
        primary_taxpayer_name: "Ana Pérez",
        primary_taxpayer_nif: "12345678A",
        spouse_name: null,
        spouse_nif: null,
        filing_scope: "pending",
        declarant_condition: "pending",
        spouse_condition: "pending",
        fiscal_link_type: "pending",
        notes: null
      },
      counts: {
        documents: 3,
        pending_review: 0,
        open_alerts: 1,
        operations: 6,
        assets: 2,
        foreign_assets: 0,
        missing_asset_values: 0,
        missing_foreign_values: 0,
        missing_ownership_assets: 0,
        missing_foreign_country_assets: 0,
        missing_foreign_block_assets: 0,
        missing_foreign_q4_assets: 0,
        threshold_reached_blocks: 0,
        sales_pending: 2,
        exports: 0
      },
      canonical_runtime_mode: "derived",
      canonical_approval_status: "draft"
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers).toBeGreaterThan(0);
    expect(result.next_target).toBe("client");
    expect(result.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "fiscal_unit",
          status: "blocked"
        }),
        expect.objectContaining({
          code: "irpf_sales",
          status: "blocked"
        })
      ])
    );
  });

  test("deja listo un 720 con unidad fiscal cerrada y activos extranjeros", async () => {
    const result = evaluateModelPreparation({
      model_type: "720",
      has_client: true,
      client_nif: "12345678A",
      fiscal_unit: {
        primary_taxpayer_name: "Ana Pérez",
        primary_taxpayer_nif: "12345678A",
        spouse_name: null,
        spouse_nif: null,
        filing_scope: "individual",
        declarant_condition: "titular",
        spouse_condition: "sin_conyuge",
        fiscal_link_type: "sin_conyuge",
        notes: null
      },
      counts: {
        documents: 2,
        pending_review: 0,
        open_alerts: 0,
        operations: 1,
        assets: 3,
        foreign_assets: 2,
        missing_asset_values: 0,
        missing_foreign_values: 0,
        missing_ownership_assets: 0,
        missing_foreign_country_assets: 0,
        missing_foreign_block_assets: 0,
        missing_foreign_q4_assets: 0,
        threshold_reached_blocks: 1,
        sales_pending: 0,
        exports: 1
      },
      canonical_runtime_mode: "persisted",
      canonical_approval_status: "approved"
    });

    expect(result.status).toBe("ready");
    expect(result.blockers).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.export_model).toBe("720");
    expect(result.next_target).toBe("modelos");
  });
});
