#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SHARED_PASSWORD = "Prototipo2026!";
const STORAGE_BUCKET = "irpf-documents";
const DEFAULT_ENV_FILE = ".vercel/.env.presentation";

function bytesToUuid(bytes) {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toDeterministicExpedienteUuid(seed) {
  const digest = createHash("sha256").update(`irpf-expediente:${seed}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

const FIXED_USERS = [
  {
    id: "b5f7a6da-f8b4-4515-8d19-b8c8ba4e17e0",
    reference: "demo-admin",
    display_name: "Demo Admin",
    email: "demo@irpf-parser.dev",
    role: "admin",
    metadata: { team: "Presentacion", scope: "all", presentation_seed: true }
  },
  {
    id: "d4d33a11-93e3-4623-912c-a0d28f0b6d87",
    reference: "demo-senior",
    display_name: "Fiscalista Senior",
    email: "senior@irpf-parser.dev",
    role: "fiscal_senior",
    metadata: { team: "Presentacion", scope: "assigned", presentation_seed: true }
  },
  {
    id: "7e015f5a-48c1-46fd-8d34-d6d5c91fc75f",
    reference: "demo-junior",
    display_name: "Fiscalista Junior",
    email: "junior@irpf-parser.dev",
    role: "fiscal_junior",
    metadata: { team: "Presentacion", scope: "assigned", presentation_seed: true }
  },
  {
    id: "456f6aa0-9308-4891-8cdb-8c9c9f0d5105",
    reference: "demo-readonly",
    display_name: "Solo Lectura",
    email: "readonly@irpf-parser.dev",
    role: "solo_lectura",
    metadata: { team: "Presentacion", scope: "assigned", presentation_seed: true }
  }
];

const CLIENTS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    reference: "ana-perez-lopez",
    full_name: "Ana Perez Lopez",
    display_name: "Ana Perez Lopez",
    nif: "12345678Z",
    email: "ana@clientes-demo.es",
    status: "active",
    metadata: {
      contact_person: "Ana Perez Lopez",
      notes: "Cliente IRPF individual con patrimonio financiero listo para presentacion.",
      presentation_seed: true,
      fiscal_unit: {
        primary_taxpayer_name: "Ana Perez Lopez",
        primary_taxpayer_nif: "12345678Z",
        spouse_name: null,
        spouse_nif: null,
        filing_scope: "individual",
        declarant_condition: "titular",
        spouse_condition: "sin_conyuge",
        fiscal_link_type: "sin_conyuge",
        notes: "Caso base individual listo para Modelo 100."
      }
    }
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    reference: "javier-ruiz-marta-serra",
    full_name: "Javier Ruiz y Marta Serra",
    display_name: "Javier Ruiz y Marta Serra",
    nif: "23456789D",
    email: "javier.marta@clientes-demo.es",
    status: "active",
    metadata: {
      contact_person: "Javier Ruiz",
      notes: "Unidad fiscal conjunta con patrimonio a revisar para Modelo 714.",
      presentation_seed: true,
      fiscal_unit: {
        primary_taxpayer_name: "Javier Ruiz",
        primary_taxpayer_nif: "23456789D",
        spouse_name: "Marta Serra",
        spouse_nif: "23456780P",
        filing_scope: "joint",
        declarant_condition: "titular",
        spouse_condition: "cotitular",
        fiscal_link_type: "gananciales",
        notes: "Unidad fiscal conjunta con revision de patrimonio entre minimo exento y umbral automatico."
      }
    }
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    reference: "carlos-vega-internacional",
    full_name: "Carlos Vega Internacional",
    display_name: "Carlos Vega Internacional",
    nif: "34567890V",
    email: "carlos@clientes-demo.es",
    status: "active",
    metadata: {
      contact_person: "Carlos Vega",
      notes: "Cliente con historial de activos en el extranjero para seguimiento de Modelo 720.",
      presentation_seed: true,
      fiscal_unit: {
        primary_taxpayer_name: "Carlos Vega",
        primary_taxpayer_nif: "34567890V",
        spouse_name: null,
        spouse_nif: null,
        filing_scope: "individual",
        declarant_condition: "titular",
        spouse_condition: "sin_conyuge",
        fiscal_link_type: "sin_conyuge",
        notes: "Caso 720 con historial previo y representacion internacional."
      }
    }
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    reference: "lucia-navarro",
    full_name: "Lucia Navarro",
    display_name: "Lucia Navarro",
    nif: "45678901G",
    email: "lucia@clientes-demo.es",
    status: "active",
    metadata: {
      contact_person: "Lucia Navarro",
      notes: "Cliente IRPF con documento pendiente de revision manual para mostrar bandeja de trabajo.",
      presentation_seed: true,
      fiscal_unit: {
        primary_taxpayer_name: "Lucia Navarro",
        primary_taxpayer_nif: "45678901G",
        spouse_name: null,
        spouse_nif: null,
        filing_scope: "individual",
        declarant_condition: "titular",
        spouse_condition: "sin_conyuge",
        fiscal_link_type: "sin_conyuge",
        notes: "Expediente bloqueado en revision manual."
      }
    }
  },
  {
    id: "55555555-6666-4555-8555-666666666666",
    reference: "teresa-gil-documental",
    full_name: "Teresa Gil Documental",
    display_name: "Teresa Gil Documental",
    nif: "56789012H",
    email: "teresa@clientes-demo.es",
    status: "active",
    metadata: {
      contact_person: "Teresa Gil",
      notes: "Cliente sembrado para probar alta de expediente vacío, carga documental e inicio de ingesta.",
      presentation_seed: true,
      fiscal_unit: {
        primary_taxpayer_name: "Teresa Gil",
        primary_taxpayer_nif: "56789012H",
        spouse_name: null,
        spouse_nif: null,
        filing_scope: "individual",
        declarant_condition: "titular",
        spouse_condition: "sin_conyuge",
        fiscal_link_type: "sin_conyuge",
        notes: "Caso documental limpio para pruebas de upload, parseo e inicio del flujo."
      }
    }
  }
];

const EXPEDIENTES = [
  {
    id: toDeterministicExpedienteUuid("ana-irpf-2025"),
    reference: "ana-irpf-2025",
    client_id: CLIENTS[0].id,
    fiscal_year: 2025,
    model_type: "IRPF",
    title: "IRPF 2025 · Ana Perez Lopez",
    status: "VALIDADO"
  },
  {
    id: toDeterministicExpedienteUuid("javier-marta-ip-2025"),
    reference: "javier-marta-ip-2025",
    client_id: CLIENTS[1].id,
    fiscal_year: 2025,
    model_type: "IP",
    title: "Patrimonio 2025 · Javier Ruiz y Marta Serra",
    status: "VALIDADO"
  },
  {
    id: toDeterministicExpedienteUuid("carlos-720-2024"),
    reference: "carlos-720-2024",
    client_id: CLIENTS[2].id,
    fiscal_year: 2024,
    model_type: "720",
    title: "Modelo 720 2024 · Carlos Vega",
    status: "PRESENTADO"
  },
  {
    id: toDeterministicExpedienteUuid("carlos-720-2025"),
    reference: "carlos-720-2025",
    client_id: CLIENTS[2].id,
    fiscal_year: 2025,
    model_type: "720",
    title: "Modelo 720 2025 · Carlos Vega",
    status: "VALIDADO"
  },
  {
    id: toDeterministicExpedienteUuid("lucia-irpf-2025"),
    reference: "lucia-irpf-2025",
    client_id: CLIENTS[3].id,
    fiscal_year: 2025,
    model_type: "IRPF",
    title: "IRPF 2025 · Lucia Navarro",
    status: "EN_REVISION"
  },
  {
    id: toDeterministicExpedienteUuid("teresa-irpf-2025"),
    reference: "teresa-irpf-2025",
    client_id: CLIENTS[4].id,
    fiscal_year: 2025,
    model_type: "IRPF",
    title: "IRPF 2025 · Teresa Gil Documental",
    status: "BORRADOR"
  }
];

const DOCUMENTS = [
  {
    id: "61111111-1111-4111-8111-111111111111",
    expediente_id: EXPEDIENTES[0].id,
    filename: "broker-ana-2025.pdf",
    storage_path: null,
    source_type: "PDF",
    entity: "Broker",
    detected_template: "broker_statement",
    processing_status: "completed",
    confidence: 0.97,
    manual_review_required: false,
    metadata: { presentation_seed: true },
    uploaded_at: "2026-03-08T08:00:00Z",
    processed_at: "2026-03-08T08:04:00Z",
    created_at: "2026-03-08T08:00:00Z",
    updated_at: "2026-03-08T08:04:00Z"
  },
  {
    id: "62222222-2222-4222-8222-222222222222",
    expediente_id: EXPEDIENTES[1].id,
    filename: "patrimonio-javier-marta-2025.xlsx",
    storage_path: null,
    source_type: "XLSX",
    entity: "Patrimonio",
    detected_template: "wealth_summary",
    processing_status: "completed",
    confidence: 0.95,
    manual_review_required: false,
    metadata: { presentation_seed: true },
    uploaded_at: "2026-03-08T08:15:00Z",
    processed_at: "2026-03-08T08:18:00Z",
    created_at: "2026-03-08T08:15:00Z",
    updated_at: "2026-03-08T08:18:00Z"
  },
  {
    id: "63333333-3333-4333-8333-333333333333",
    expediente_id: EXPEDIENTES[2].id,
    filename: "modelo-720-historico-2024.pdf",
    storage_path: null,
    source_type: "PDF",
    entity: "Custodia",
    detected_template: "foreign_assets_summary",
    processing_status: "completed",
    confidence: 0.94,
    manual_review_required: false,
    metadata: { presentation_seed: true },
    uploaded_at: "2026-03-08T08:30:00Z",
    processed_at: "2026-03-08T08:34:00Z",
    created_at: "2026-03-08T08:30:00Z",
    updated_at: "2026-03-08T08:34:00Z"
  },
  {
    id: "64444444-4444-4444-8444-444444444444",
    expediente_id: EXPEDIENTES[3].id,
    filename: "broker-foreign-assets-2025.pdf",
    storage_path: null,
    source_type: "PDF",
    entity: "Custodia",
    detected_template: "foreign_assets_summary",
    processing_status: "completed",
    confidence: 0.96,
    manual_review_required: false,
    metadata: { presentation_seed: true },
    uploaded_at: "2026-03-08T08:45:00Z",
    processed_at: "2026-03-08T08:50:00Z",
    created_at: "2026-03-08T08:45:00Z",
    updated_at: "2026-03-08T08:50:00Z"
  },
  {
    id: "65555555-5555-4555-8555-555555555555",
    expediente_id: EXPEDIENTES[4].id,
    filename: "broker-lucia-revision.pdf",
    storage_path: null,
    source_type: "PDF",
    entity: "Broker",
    detected_template: "broker_statement",
    processing_status: "manual_review",
    confidence: 0.62,
    manual_review_required: true,
    metadata: { presentation_seed: true },
    uploaded_at: "2026-03-08T09:00:00Z",
    processed_at: "2026-03-08T09:05:00Z",
    created_at: "2026-03-08T09:00:00Z",
    updated_at: "2026-03-08T09:05:00Z"
  }
];

const EXTRACTIONS = [
  {
    id: "71111111-1111-4111-8111-111111111111",
    document_id: DOCUMENTS[0].id,
    version: 1,
    raw_payload: { presentation_seed: true },
    normalized_payload: {
      records: [
        {
          record_type: "DIVIDENDO",
          confidence: 0.97,
          fields: {
            operation_date: "2025-06-20",
            isin: "US0378331005",
            description: "Apple Inc.",
            amount: 320,
            currency: "USD",
            quantity: 150,
            retention: 60
          },
          source_spans: [{ page: 1, start: 120, end: 180, snippet: "Dividend Apple Inc." }]
        },
        {
          record_type: "INTERES",
          confidence: 0.94,
          fields: {
            operation_date: "2025-12-31",
            description: "Cuenta Santander",
            amount: 45,
            currency: "EUR"
          },
          source_spans: [{ page: 2, start: 40, end: 86, snippet: "Intereses devengados" }]
        }
      ],
      presentation_seed: true
    },
    confidence: 0.97,
    requires_manual_review: false,
    review_status: "validated",
    reviewed_at: "2026-03-08T08:10:00Z",
    reviewed_by: "demo-senior",
    created_at: "2026-03-08T08:04:00Z"
  },
  {
    id: "72222222-2222-4222-8222-222222222222",
    document_id: DOCUMENTS[1].id,
    version: 1,
    raw_payload: { presentation_seed: true },
    normalized_payload: { records: [], presentation_seed: true },
    confidence: 0.95,
    requires_manual_review: false,
    review_status: "not_required",
    reviewed_at: "2026-03-08T08:19:00Z",
    reviewed_by: "demo-senior",
    created_at: "2026-03-08T08:18:00Z"
  },
  {
    id: "73333333-3333-4333-8333-333333333333",
    document_id: DOCUMENTS[2].id,
    version: 1,
    raw_payload: { presentation_seed: true },
    normalized_payload: { records: [], presentation_seed: true },
    confidence: 0.94,
    requires_manual_review: false,
    review_status: "not_required",
    reviewed_at: "2026-03-08T08:35:00Z",
    reviewed_by: "demo-senior",
    created_at: "2026-03-08T08:34:00Z"
  },
  {
    id: "74444444-4444-4444-8444-444444444444",
    document_id: DOCUMENTS[3].id,
    version: 1,
    raw_payload: { presentation_seed: true },
    normalized_payload: { records: [], presentation_seed: true },
    confidence: 0.96,
    requires_manual_review: false,
    review_status: "not_required",
    reviewed_at: "2026-03-08T08:52:00Z",
    reviewed_by: "demo-senior",
    created_at: "2026-03-08T08:50:00Z"
  },
  {
    id: "75555555-5555-4555-8555-555555555555",
    document_id: DOCUMENTS[4].id,
    version: 1,
    raw_payload: { presentation_seed: true },
    normalized_payload: {
      records: [
        {
          record_type: "DIVIDENDO",
          confidence: 0.62,
          fields: {
            operation_date: "2025-03-18",
            isin: "US5949181045",
            description: "Microsoft Corp.",
            amount: 250,
            currency: "USD",
            quantity: 85,
            retention: 47
          },
          source_spans: [{ page: 1, start: 88, end: 145, snippet: "Dividend payment Microsoft Corp." }]
        },
        {
          record_type: "INTERES",
          confidence: 0.58,
          fields: {
            operation_date: "2025-03-31",
            description: "Cuenta remunerada USD",
            amount: 12,
            currency: "USD"
          },
          source_spans: [{ page: 2, start: 22, end: 72, snippet: "Interest credit USD cash account" }]
        }
      ],
      presentation_seed: true
    },
    confidence: 0.62,
    requires_manual_review: true,
    review_status: "pending",
    reviewed_at: null,
    reviewed_by: null,
    created_at: "2026-03-08T09:05:00Z"
  }
];

const OPERATIONS = [
  {
    id: "a1111111-1111-4111-8111-111111111111",
    expediente_id: EXPEDIENTES[0].id,
    document_id: DOCUMENTS[0].id,
    operation_type: "DIVIDENDO",
    operation_date: "2025-06-20",
    isin: "US0378331005",
    quantity: 150,
    realized_gain: null,
    source: "MANUAL",
    confidence: 0.97,
    origin_trace: { presentation_seed: true },
    manual_notes: "Validado en presentacion",
    description: "Apple Inc.",
    amount: 320,
    currency: "USD",
    retention: 60
  },
  {
    id: "a2222222-2222-4222-8222-222222222222",
    expediente_id: EXPEDIENTES[0].id,
    document_id: DOCUMENTS[0].id,
    operation_type: "INTERES",
    operation_date: "2025-12-31",
    isin: null,
    quantity: null,
    realized_gain: null,
    source: "MANUAL",
    confidence: 0.94,
    origin_trace: { presentation_seed: true },
    manual_notes: "Interes anual de cuenta",
    description: "Cuenta Santander",
    amount: 45,
    currency: "EUR",
    retention: null
  },
  {
    id: "a3333333-3333-4333-8333-333333333333",
    expediente_id: EXPEDIENTES[0].id,
    document_id: DOCUMENTS[0].id,
    operation_type: "POSICION",
    operation_date: "2025-12-31",
    isin: "US0378331005",
    quantity: 150,
    realized_gain: null,
    source: "MANUAL",
    confidence: 0.96,
    origin_trace: { presentation_seed: true },
    manual_notes: "Posicion de cierre",
    description: "Apple Inc.",
    amount: 23000,
    currency: "USD",
    retention: null
  }
];

const ASSETS = [
  {
    id: "81111111-1111-4111-8111-111111111111",
    client_id: CLIENTS[0].id,
    asset_key: "US0378331005",
    isin: "US0378331005",
    label: "Apple Inc. (US0378331005)",
    currencies: ["USD"],
    expedientes: [EXPEDIENTES[0].reference],
    fiscal_years: [2025],
    events_total: 2,
    dividends: 1,
    interests: 0,
    acquisitions: 0,
    transmissions: 0,
    retentions: 1,
    gains_losses: 0,
    open_lots: 0,
    closed_lots: 0,
    quantity_open: 150,
    open_cost_basis: null,
    gross_amount_total: 23320,
    realized_gain_total: null,
    pending_transmissions: 0,
    latest_event_date: "2025-12-31",
    last_source: "MANUAL",
    metadata: {
      manual_asset_type: "security",
      manual_holder_role: "titular",
      manual_ownership_pct: 100,
      manual_country: "US",
      manual_year_end_value: 23000,
      manual_valuation_method: "year_end_value",
      manual_foreign_block: "securities",
      manual_updated_by: "demo-senior",
      presentation_seed: true
    }
  },
  {
    id: "82222222-2222-4222-8222-222222222222",
    client_id: CLIENTS[0].id,
    asset_key: "DESC:CUENTA SANTANDER",
    isin: null,
    label: "Cuenta Santander",
    currencies: ["EUR"],
    expedientes: [EXPEDIENTES[0].reference],
    fiscal_years: [2025],
    events_total: 1,
    dividends: 0,
    interests: 1,
    acquisitions: 0,
    transmissions: 0,
    retentions: 0,
    gains_losses: 0,
    open_lots: 0,
    closed_lots: 0,
    quantity_open: null,
    open_cost_basis: null,
    gross_amount_total: 45,
    realized_gain_total: null,
    pending_transmissions: 0,
    latest_event_date: "2025-12-31",
    last_source: "MANUAL",
    metadata: {
      manual_asset_type: "account",
      manual_holder_role: "titular",
      manual_ownership_pct: 100,
      manual_country: "ES",
      manual_year_end_value: 12500,
      manual_q4_avg_balance: 11800,
      manual_valuation_method: "year_end_value",
      manual_updated_by: "demo-senior",
      presentation_seed: true
    }
  },
  {
    id: "83333333-3333-4333-8333-333333333333",
    client_id: CLIENTS[1].id,
    asset_key: "DESC:VIVIENDA MADRID",
    isin: null,
    label: "Vivienda Madrid",
    currencies: ["EUR"],
    expedientes: [EXPEDIENTES[1].reference],
    fiscal_years: [2025],
    events_total: 1,
    dividends: 0,
    interests: 0,
    acquisitions: 0,
    transmissions: 0,
    retentions: 0,
    gains_losses: 0,
    open_lots: 0,
    closed_lots: 0,
    quantity_open: 1,
    open_cost_basis: 920000,
    gross_amount_total: 920000,
    realized_gain_total: null,
    pending_transmissions: 0,
    latest_event_date: "2025-12-31",
    last_source: "MANUAL",
    metadata: {
      manual_asset_type: "real_estate",
      manual_holder_role: "titular",
      manual_ownership_pct: 100,
      manual_country: "ES",
      manual_year_end_value: 920000,
      manual_valuation_method: "manual",
      manual_updated_by: "demo-senior",
      presentation_seed: true
    }
  },
  {
    id: "84444444-4444-4444-8444-444444444444",
    client_id: CLIENTS[1].id,
    asset_key: "ES0105066009",
    isin: "ES0105066009",
    label: "Fondo Mixto Nacional (ES0105066009)",
    currencies: ["EUR"],
    expedientes: [EXPEDIENTES[1].reference],
    fiscal_years: [2025],
    events_total: 1,
    dividends: 0,
    interests: 0,
    acquisitions: 0,
    transmissions: 0,
    retentions: 0,
    gains_losses: 0,
    open_lots: 0,
    closed_lots: 0,
    quantity_open: 430,
    open_cost_basis: 430000,
    gross_amount_total: 430000,
    realized_gain_total: null,
    pending_transmissions: 0,
    latest_event_date: "2025-12-31",
    last_source: "MANUAL",
    metadata: {
      manual_asset_type: "fund",
      manual_holder_role: "conyuge",
      manual_ownership_pct: 100,
      manual_country: "ES",
      manual_year_end_value: 430000,
      manual_valuation_method: "year_end_value",
      manual_updated_by: "demo-senior",
      presentation_seed: true
    }
  },
  {
    id: "85555555-5555-4555-8555-555555555555",
    client_id: CLIENTS[2].id,
    asset_key: "US78462F1030",
    isin: "US78462F1030",
    label: "ETF Global Index (US78462F1030)",
    currencies: ["USD"],
    expedientes: [EXPEDIENTES[3].reference],
    fiscal_years: [2025],
    events_total: 1,
    dividends: 0,
    interests: 0,
    acquisitions: 0,
    transmissions: 0,
    retentions: 0,
    gains_losses: 0,
    open_lots: 0,
    closed_lots: 0,
    quantity_open: 210,
    open_cost_basis: 78000,
    gross_amount_total: 78000,
    realized_gain_total: null,
    pending_transmissions: 0,
    latest_event_date: "2025-12-31",
    last_source: "MANUAL",
    metadata: {
      manual_asset_type: "security",
      manual_holder_role: "titular",
      manual_ownership_pct: 100,
      manual_country: "US",
      manual_year_end_value: 78000,
      manual_valuation_method: "year_end_value",
      manual_foreign_block: "securities",
      manual_updated_by: "demo-senior",
      presentation_seed: true
    }
  }
];

const FISCAL_EVENTS = [
  {
    id: "91111111-1111-4111-8111-111111111111",
    client_id: CLIENTS[0].id,
    expediente_id: EXPEDIENTES[0].id,
    asset_id: ASSETS[0].id,
    asset_key: ASSETS[0].asset_key,
    source_event_id: "presentation:ana:dividend",
    asset_label: ASSETS[0].label,
    isin: ASSETS[0].isin,
    event_kind: "dividendo",
    operation_type: "DIVIDENDO",
    operation_date: "2025-06-20",
    description: "Apple Inc.",
    amount: 320,
    currency: "USD",
    quantity: 150,
    retention: 60,
    realized_gain: null,
    source: "MANUAL",
    status: "MATCHED",
    metadata: {
      expediente_reference: EXPEDIENTES[0].reference,
      fiscal_year: 2025,
      model_type: "IRPF",
      presentation_seed: true
    }
  },
  {
    id: "92222222-2222-4222-8222-222222222222",
    client_id: CLIENTS[0].id,
    expediente_id: EXPEDIENTES[0].id,
    asset_id: ASSETS[0].id,
    asset_key: ASSETS[0].asset_key,
    source_event_id: "presentation:ana:position",
    asset_label: ASSETS[0].label,
    isin: ASSETS[0].isin,
    event_kind: "posicion",
    operation_type: "POSICION",
    operation_date: "2025-12-31",
    description: "Cierre de posicion Apple Inc.",
    amount: 23000,
    currency: "USD",
    quantity: 150,
    retention: null,
    realized_gain: null,
    source: "MANUAL",
    status: "RECORDED",
    metadata: {
      expediente_reference: EXPEDIENTES[0].reference,
      fiscal_year: 2025,
      model_type: "IRPF",
      presentation_seed: true
    }
  },
  {
    id: "93333333-3333-4333-8333-333333333333",
    client_id: CLIENTS[0].id,
    expediente_id: EXPEDIENTES[0].id,
    asset_id: ASSETS[1].id,
    asset_key: ASSETS[1].asset_key,
    source_event_id: "presentation:ana:interest",
    asset_label: ASSETS[1].label,
    isin: null,
    event_kind: "interes",
    operation_type: "INTERES",
    operation_date: "2025-12-31",
    description: "Intereses de cuenta",
    amount: 45,
    currency: "EUR",
    quantity: null,
    retention: null,
    realized_gain: null,
    source: "MANUAL",
    status: "RECORDED",
    metadata: {
      expediente_reference: EXPEDIENTES[0].reference,
      fiscal_year: 2025,
      model_type: "IRPF",
      presentation_seed: true
    }
  },
  {
    id: "94444444-4444-4444-8444-444444444444",
    client_id: CLIENTS[1].id,
    expediente_id: EXPEDIENTES[1].id,
    asset_id: ASSETS[2].id,
    asset_key: ASSETS[2].asset_key,
    source_event_id: "presentation:javier:home",
    asset_label: ASSETS[2].label,
    isin: null,
    event_kind: "posicion",
    operation_type: "POSICION",
    operation_date: "2025-12-31",
    description: "Valoracion vivienda Madrid",
    amount: 920000,
    currency: "EUR",
    quantity: 1,
    retention: null,
    realized_gain: null,
    source: "MANUAL",
    status: "RECORDED",
    metadata: {
      expediente_reference: EXPEDIENTES[1].reference,
      fiscal_year: 2025,
      model_type: "IP",
      presentation_seed: true
    }
  },
  {
    id: "95555555-5555-4555-8555-555555555555",
    client_id: CLIENTS[1].id,
    expediente_id: EXPEDIENTES[1].id,
    asset_id: ASSETS[3].id,
    asset_key: ASSETS[3].asset_key,
    source_event_id: "presentation:javier:fund",
    asset_label: ASSETS[3].label,
    isin: ASSETS[3].isin,
    event_kind: "posicion",
    operation_type: "POSICION",
    operation_date: "2025-12-31",
    description: "Valoracion fondo mixto",
    amount: 430000,
    currency: "EUR",
    quantity: 430,
    retention: null,
    realized_gain: null,
    source: "MANUAL",
    status: "RECORDED",
    metadata: {
      expediente_reference: EXPEDIENTES[1].reference,
      fiscal_year: 2025,
      model_type: "IP",
      presentation_seed: true
    }
  },
  {
    id: "96666666-6666-4666-8666-666666666666",
    client_id: CLIENTS[2].id,
    expediente_id: EXPEDIENTES[3].id,
    asset_id: ASSETS[4].id,
    asset_key: ASSETS[4].asset_key,
    source_event_id: "presentation:carlos:position2025",
    asset_label: ASSETS[4].label,
    isin: ASSETS[4].isin,
    event_kind: "posicion",
    operation_type: "POSICION",
    operation_date: "2025-12-31",
    description: "Valoracion cartera extranjera",
    amount: 78000,
    currency: "USD",
    quantity: 210,
    retention: null,
    realized_gain: null,
    source: "MANUAL",
    status: "RECORDED",
    metadata: {
      expediente_reference: EXPEDIENTES[3].reference,
      fiscal_year: 2025,
      model_type: "720",
      presentation_seed: true
    }
  }
];

const ALERTS = [
  {
    id: "c1111111-1111-4111-8111-111111111111",
    expediente_id: EXPEDIENTES[1].id,
    severity: "warning",
    category: "filing_assessment",
    message: "Patrimonio entre minimo exento y umbral automatico: revisar obligacion del Modelo 714.",
    entity_type: "expediente",
    entity_id: EXPEDIENTES[1].id,
    status: "open",
    metadata: { presentation_seed: true },
    created_at: "2026-03-08T10:00:00Z",
    resolved_at: null,
    resolved_by: null
  },
  {
    id: "c2222222-2222-4222-8222-222222222222",
    expediente_id: EXPEDIENTES[3].id,
    severity: "warning",
    category: "filing_assessment",
    message: "Incremento superior a 20.000 EUR en bloque de valores extranjeros: confirmar re-presentacion del Modelo 720.",
    entity_type: "expediente",
    entity_id: EXPEDIENTES[3].id,
    status: "open",
    metadata: { presentation_seed: true },
    created_at: "2026-03-08T10:05:00Z",
    resolved_at: null,
    resolved_by: null
  },
  {
    id: "c3333333-3333-4333-8333-333333333333",
    expediente_id: EXPEDIENTES[4].id,
    severity: "critical",
    category: "manual_review",
    message: "Documento con baja confianza pendiente de correccion manual antes de incorporar al canónico.",
    entity_type: "document",
    entity_id: DOCUMENTS[4].id,
    status: "open",
    metadata: { presentation_seed: true },
    created_at: "2026-03-08T10:10:00Z",
    resolved_at: null,
    resolved_by: null
  }
];

const EXPORTS = [
  {
    id: "d1111111-1111-4111-8111-111111111111",
    expediente_id: EXPEDIENTES[0].id,
    model: "100",
    status: "generated",
    validation_state: "ok",
    artifact_path: "presentation/ana-irpf-2025/modelo-100.json",
    artifact_hash: "presentation-ana-100",
    payload: {
      presentation_seed: true,
      filing_requirement: { filing_decision: "file" },
      summary: "Modelo 100 listo para presentacion"
    },
    generated_by: "demo-senior",
    generated_at: "2026-03-08T11:00:00Z",
    created_at: "2026-03-08T11:00:00Z",
    updated_at: "2026-03-08T11:00:00Z"
  },
  {
    id: "d2222222-2222-4222-8222-222222222222",
    expediente_id: EXPEDIENTES[2].id,
    model: "720",
    status: "generated",
    validation_state: "ok",
    artifact_path: "presentation/carlos-720-2024/modelo-720.txt",
    artifact_hash: "presentation-carlos-720-2024",
    payload: {
      presentation_seed: true,
      foreign_block_totals: {
        accounts: 0,
        securities: 55000,
        insurance_real_estate: 0,
        other: 0
      },
      filing_requirement: {
        filing_decision: "file",
        prior_filed_year: null
      }
    },
    generated_by: "demo-senior",
    generated_at: "2026-03-08T11:15:00Z",
    created_at: "2026-03-08T11:15:00Z",
    updated_at: "2026-03-08T11:15:00Z"
  }
];

const WORKFLOWS = [
  {
    expediente_id: EXPEDIENTES[0].id,
    documental_status: "ready",
    revision_status: "ready",
    canonical_status: "approved",
    declarative_status: "prepared",
    filing_status: "ready",
    canonical_approval_status: "approved",
    workflow_owner_ref: "demo-senior",
    workflow_owner_name: "Fiscalista Senior",
    pending_task: "Revisar salida final y preparar presentacion al cliente.",
    pending_reason: null,
    workflow_updated_at: "2026-03-08T11:05:00Z",
    created_at: "2026-03-08T11:05:00Z",
    updated_at: "2026-03-08T11:05:00Z"
  },
  {
    expediente_id: EXPEDIENTES[1].id,
    documental_status: "ready",
    revision_status: "ready",
    canonical_status: "approved",
    declarative_status: "ready",
    filing_status: "ready",
    canonical_approval_status: "approved",
    workflow_owner_ref: "demo-senior",
    workflow_owner_name: "Fiscalista Senior",
    pending_task: "Revisar obligacion 714 y documentar criterio de presentacion.",
    pending_reason: "Patrimonio entre minimo exento y umbral estatal de obligacion automatica.",
    workflow_updated_at: "2026-03-08T11:10:00Z",
    created_at: "2026-03-08T11:10:00Z",
    updated_at: "2026-03-08T11:10:00Z"
  },
  {
    expediente_id: EXPEDIENTES[2].id,
    documental_status: "ready",
    revision_status: "ready",
    canonical_status: "approved",
    declarative_status: "prepared",
    filing_status: "filed",
    canonical_approval_status: "approved",
    workflow_owner_ref: "demo-senior",
    workflow_owner_name: "Fiscalista Senior",
    pending_task: null,
    pending_reason: null,
    workflow_updated_at: "2026-03-08T11:20:00Z",
    created_at: "2026-03-08T11:20:00Z",
    updated_at: "2026-03-08T11:20:00Z"
  },
  {
    expediente_id: EXPEDIENTES[3].id,
    documental_status: "ready",
    revision_status: "ready",
    canonical_status: "approved",
    declarative_status: "ready",
    filing_status: "ready",
    canonical_approval_status: "approved",
    workflow_owner_ref: "demo-senior",
    workflow_owner_name: "Fiscalista Senior",
    pending_task: "Confirmar re-presentacion del Modelo 720 por incremento de cartera extranjera.",
    pending_reason: "El bloque de valores extranjeros aumenta mas de 20.000 EUR frente a la ultima declaracion.",
    workflow_updated_at: "2026-03-08T11:25:00Z",
    created_at: "2026-03-08T11:25:00Z",
    updated_at: "2026-03-08T11:25:00Z"
  },
  {
    expediente_id: EXPEDIENTES[4].id,
    documental_status: "blocked",
    revision_status: "pending",
    canonical_status: "not_started",
    declarative_status: "blocked",
    filing_status: "draft",
    canonical_approval_status: "draft",
    workflow_owner_ref: "demo-junior",
    workflow_owner_name: "Fiscalista Junior",
    pending_task: "Corregir documento en revision manual y aprobar extraccion.",
    pending_reason: "La extraccion tiene baja confianza y mantiene bloqueada la incorporacion canónica.",
    workflow_updated_at: "2026-03-08T11:30:00Z",
    created_at: "2026-03-08T11:30:00Z",
    updated_at: "2026-03-08T11:30:00Z"
  },
  {
    expediente_id: EXPEDIENTES[5].id,
    documental_status: "not_started",
    revision_status: "not_started",
    canonical_status: "not_started",
    declarative_status: "blocked",
    filing_status: "draft",
    canonical_approval_status: "draft",
    workflow_owner_ref: "demo-junior",
    workflow_owner_name: "Fiscalista Junior",
    pending_task: "Subir la primera documentación del cliente y verificar la ingesta.",
    pending_reason: "Expediente vacío preparado para probar la carga documental del prototipo.",
    workflow_updated_at: "2026-03-08T11:35:00Z",
    created_at: "2026-03-08T11:35:00Z",
    updated_at: "2026-03-08T11:35:00Z"
  }
];

const ASSIGNMENTS = [
  { user_id: FIXED_USERS[1].id, client_id: CLIENTS[0].id, assignment_role: "owner" },
  { user_id: FIXED_USERS[1].id, client_id: CLIENTS[1].id, assignment_role: "owner" },
  { user_id: FIXED_USERS[1].id, client_id: CLIENTS[2].id, assignment_role: "owner" },
  { user_id: FIXED_USERS[1].id, client_id: CLIENTS[3].id, assignment_role: "owner" },
  { user_id: FIXED_USERS[1].id, client_id: CLIENTS[4].id, assignment_role: "owner" },
  { user_id: FIXED_USERS[2].id, client_id: CLIENTS[0].id, assignment_role: "support" },
  { user_id: FIXED_USERS[2].id, client_id: CLIENTS[3].id, assignment_role: "support" },
  { user_id: FIXED_USERS[2].id, client_id: CLIENTS[4].id, assignment_role: "owner" },
  { user_id: FIXED_USERS[3].id, client_id: CLIENTS[0].id, assignment_role: "viewer" },
  { user_id: FIXED_USERS[3].id, client_id: CLIENTS[2].id, assignment_role: "viewer" }
];

const AUDITS = [
  {
    expediente_id: EXPEDIENTES[4].id,
    user_id: "demo-junior",
    action: "workflow.event.manual_review_requested",
    entity_type: "document",
    entity_id: DOCUMENTS[4].id,
    after_data: {
      document_id: DOCUMENTS[4].id,
      extraction_id: EXTRACTIONS[4].id,
      event_type: "manual_review_requested",
      presentation_seed: true
    },
    created_at: "2026-03-08T10:12:00Z"
  },
  {
    expediente_id: EXPEDIENTES[0].id,
    user_id: "demo-senior",
    action: "workflow.event.export_generated",
    entity_type: "export",
    entity_id: EXPORTS[0].id,
    after_data: {
      export_id: EXPORTS[0].id,
      event_type: "export_generated",
      presentation_seed: true
    },
    created_at: "2026-03-08T11:00:00Z"
  }
];

function parseArgs(argv) {
  const result = {
    envFile: DEFAULT_ENV_FILE,
    skipSqlReset: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--env-file" && argv[index + 1]) {
      result.envFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--skip-sql-reset") {
      result.skipSqlReset = true;
    }
  }

  return result;
}

function readEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }

  return trimmed;
}

function loadEnvFile(envFile) {
  if (!envFile || !existsSync(envFile)) {
    return;
  }

  const content = readFileSync(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = readEnvValue(trimmed.slice(separatorIndex + 1));
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta variable de entorno requerida: ${name}`);
  }

  return value;
}

function createAdminClient() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function listAllAuthUsers(supabase) {
  const users = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const batch = data?.users ?? [];
    users.push(...batch);

    if (batch.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
}

async function deleteAuthUsers(supabase) {
  const users = await listAllAuthUsers(supabase);
  for (const user of users) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      throw error;
    }
  }
}

async function deleteFixedAuthUsers(supabase) {
  const users = await listAllAuthUsers(supabase);
  const fixedEmails = new Set(FIXED_USERS.map((user) => user.email.toLowerCase()));

  for (const user of users) {
    const email = user.email?.trim().toLowerCase();
    if (!email || !fixedEmails.has(email)) {
      continue;
    }

    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      throw error;
    }
  }
}

async function createFixedAuthUsers(supabase) {
  const authUsersByEmail = new Map();

  for (const user of FIXED_USERS) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password: SHARED_PASSWORD,
      email_confirm: true,
      user_metadata: {
        presentation_seed: true,
        role: user.role,
        reference: user.reference
      }
    });

    if (error) {
      if (error.code === "email_exists") {
        authUsersByEmail.set(user.email.toLowerCase(), null);
        continue;
      }

      throw error;
    }

    authUsersByEmail.set(user.email.toLowerCase(), data.user);
  }

  return authUsersByEmail;
}

function chunk(items, size) {
  const parts = [];
  for (let index = 0; index < items.length; index += size) {
    parts.push(items.slice(index, index + size));
  }
  return parts;
}

async function insertInChunks(queryBuilderFactory, rows) {
  for (const batch of chunk(rows, 100)) {
    const { error } = await queryBuilderFactory().insert(batch);
    if (error) {
      throw error;
    }
  }
}

async function clearBucketViaApi(supabase, bucketId) {
  async function listPaths(prefix = "") {
    const { data, error } = await supabase.storage.from(bucketId).list(prefix, {
      limit: 100,
      offset: 0
    });

    if (error) {
      throw error;
    }

    const paths = [];
    for (const item of data ?? []) {
      const currentPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) {
        paths.push(...(await listPaths(currentPath)));
      } else {
        paths.push(currentPath);
      }
    }

    return paths;
  }

  const paths = await listPaths("");
  for (const batch of chunk(paths, 100)) {
    const { error } = await supabase.storage.from(bucketId).remove(batch);
    if (error) {
      throw error;
    }
  }
}

function runSqlReset(databaseUrl) {
  const fixedEmails = FIXED_USERS.map((user) => `'${user.email.toLowerCase()}'`).join(", ");
  const sql = `
do $$
declare
  table_list text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename)
    into table_list
  from pg_tables
  where schemaname = 'public'
    and tablename like 'irpf_%';

  if table_list is not null then
    execute 'truncate table ' || table_list || ' restart identity cascade';
  end if;
end $$;

delete from auth.users
where lower(email) in (${fixedEmails});
`;

  const directory = mkdtempSync(path.join(tmpdir(), "irpf-presentation-reset-"));
  const sqlFile = path.join(directory, "reset.sql");
  const psqlBin = process.env.PSQL_BIN || "/opt/homebrew/opt/libpq/bin/psql";
  writeFileSync(sqlFile, sql, "utf8");

  try {
    execFileSync(psqlBin, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
      stdio: "inherit"
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function cleanupViaApi(supabase) {
  const tables = [
    { name: "irpf_audit_log", filterColumn: "id" },
    { name: "irpf_expediente_workflow", filterColumn: "expediente_id" },
    { name: "irpf_exports", filterColumn: "id" },
    { name: "irpf_alerts", filterColumn: "id" },
    { name: "irpf_fiscal_events", filterColumn: "id" },
    { name: "irpf_assets", filterColumn: "id" },
    { name: "irpf_sale_allocations", filterColumn: "id" },
    { name: "irpf_lots", filterColumn: "id" },
    { name: "irpf_operations", filterColumn: "id" },
    { name: "irpf_extractions", filterColumn: "id" },
    { name: "irpf_documents", filterColumn: "id" },
    { name: "irpf_user_client_assignments", filterColumn: "id" },
    { name: "irpf_expedientes", filterColumn: "id" },
    { name: "irpf_clients", filterColumn: "id" },
    { name: "irpf_users", filterColumn: "id" }
  ];

  for (const table of tables) {
    const { error } = await supabase.from(table.name).delete().not(table.filterColumn, "is", null);
    if (error && !String(error.message).includes("does not exist")) {
      throw error;
    }
  }

  await clearBucketViaApi(supabase, STORAGE_BUCKET);
}

async function seedRuntimeData(supabase, authUsersByEmail) {
  await insertInChunks(
    () => supabase.from("irpf_users"),
    FIXED_USERS.map((user) => ({
      id: user.id,
      reference: user.reference,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
      status: "active",
      auth_user_id: authUsersByEmail.get(user.email.toLowerCase())?.id ?? null,
      metadata: user.metadata
    }))
  );

  await insertInChunks(() => supabase.from("irpf_clients"), CLIENTS);
  await insertInChunks(() => supabase.from("irpf_user_client_assignments"), ASSIGNMENTS);
  await insertInChunks(() => supabase.from("irpf_expedientes"), EXPEDIENTES);
  await insertInChunks(() => supabase.from("irpf_documents"), DOCUMENTS);
  await insertInChunks(() => supabase.from("irpf_extractions"), EXTRACTIONS);
  await insertInChunks(() => supabase.from("irpf_operations"), OPERATIONS);
  await insertInChunks(() => supabase.from("irpf_assets"), ASSETS);
  await insertInChunks(() => supabase.from("irpf_fiscal_events"), FISCAL_EVENTS);
  await insertInChunks(() => supabase.from("irpf_alerts"), ALERTS);
  await insertInChunks(() => supabase.from("irpf_exports"), EXPORTS);
  await insertInChunks(() => supabase.from("irpf_expediente_workflow"), WORKFLOWS);
  await insertInChunks(() => supabase.from("irpf_audit_log"), AUDITS);
}

async function countRows(supabase, table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(args.envFile);

  const supabase = createAdminClient();
  const usingSqlReset = !args.skipSqlReset && Boolean(process.env.DATABASE_URL);

  if (usingSqlReset) {
    console.log("Aplicando limpieza profunda por SQL...");
    runSqlReset(process.env.DATABASE_URL);
    await clearBucketViaApi(supabase, STORAGE_BUCKET);
  } else {
    console.log("Aplicando limpieza por API...");
    await cleanupViaApi(supabase);
  }

  console.log("Creando usuarios fijos de presentacion...");
  const authUsersByEmail = await createFixedAuthUsers(supabase);

  console.log("Sembrando dataset curado...");
  await seedRuntimeData(supabase, authUsersByEmail);

  const [userCount, clientCount, expedienteCount, documentCount, exportCount] = await Promise.all([
    countRows(supabase, "irpf_users"),
    countRows(supabase, "irpf_clients"),
    countRows(supabase, "irpf_expedientes"),
    countRows(supabase, "irpf_documents"),
    countRows(supabase, "irpf_exports")
  ]);

  console.log("Reset de presentacion completado.");
  console.log(
    JSON.stringify(
      {
        password: SHARED_PASSWORD,
        users: FIXED_USERS.map((user) => ({ email: user.email, role: user.role })),
        counts: {
          users: userCount,
          clients: clientCount,
          expedientes: expedienteCount,
          documents: documentCount,
          exports: exportCount
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
