import { expect, test } from "@playwright/test";
import { buildExpedienteWorkflowSnapshot } from "../lib/expediente-workflow";

test.describe("Workflow de expediente", () => {
  test("bloquea salida declarativa mientras el canónico no esté aprobado", async () => {
    const workflow = buildExpedienteWorkflowSnapshot({
      expediente_id: "exp-1",
      expediente_status: "EN_REVISION",
      has_client: true,
      counts: {
        documents: 4,
        queued: 0,
        processing: 0,
        manual_review: 0,
        failed: 0,
        operations: 8,
        assets: 3,
        fiscal_events: 6,
        exports: 0,
        sales_pending: 0
      },
      persisted: {
        expediente_id: "exp-1",
        documental_status: "ready",
        revision_status: "ready",
        canonical_status: "ready",
        declarative_status: "blocked",
        filing_status: "draft",
        canonical_approval_status: "reviewed",
        workflow_owner_ref: "fiscal-1",
        workflow_owner_name: "Fiscal Senior",
        pending_task: "Aprobar canónico",
        pending_reason: null,
        workflow_updated_at: null
      }
    });

    expect(workflow.documental_status).toBe("ready");
    expect(workflow.revision_status).toBe("ready");
    expect(workflow.canonical_status).toBe("ready");
    expect(workflow.canonical_approval_status).toBe("reviewed");
    expect(workflow.declarative_status).toBe("blocked");
    expect(workflow.expediente_status).toBe("EN_REVISION");
  });

  test("marca expediente validado y preparado cuando el canónico está aprobado", async () => {
    const workflow = buildExpedienteWorkflowSnapshot({
      expediente_id: "exp-2",
      expediente_status: "EN_REVISION",
      has_client: true,
      counts: {
        documents: 5,
        queued: 0,
        processing: 0,
        manual_review: 0,
        failed: 0,
        operations: 10,
        assets: 4,
        fiscal_events: 9,
        exports: 1,
        sales_pending: 0
      },
      persisted: {
        expediente_id: "exp-2",
        documental_status: "ready",
        revision_status: "ready",
        canonical_status: "approved",
        declarative_status: "prepared",
        filing_status: "ready",
        canonical_approval_status: "approved",
        workflow_owner_ref: "fiscal-2",
        workflow_owner_name: "Fiscal Manager",
        pending_task: null,
        pending_reason: null,
        workflow_updated_at: null
      }
    });

    expect(workflow.canonical_status).toBe("approved");
    expect(workflow.declarative_status).toBe("prepared");
    expect(workflow.filing_status).toBe("ready");
    expect(workflow.expediente_status).toBe("VALIDADO");
  });
});
