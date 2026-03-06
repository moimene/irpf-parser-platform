"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Hoja {
  categoria_id: string;
  nombre: string;
  ejercicio: number | null;
  num_filas: number;
  columnas: string[];
  kpis: Record<string, { sum: number; count: number }>;
}

interface Client {
  id: string;
  full_name: string;
  nif: string;
  email?: string;
  irpf_expedientes?: Array<{ id: string; ejercicio: number; estado: string }>;
}

interface PatrimonioRow {
  id: string;
  hoja: string;
  ejercicio: number | null;
  fila: number;
  datos: Record<string, unknown>;
}

const CATEGORIAS: Record<string, string> = {
  inventario:     "Inventario / Posiciones",
  goldman:        "Goldman Sachs",
  citi:           "Citi Brokerage",
  jpmorgan:       "J.P. Morgan",
  pictet:         "Pictet",
  derivados:      "Derivados / Forwards",
  inmuebles:      "Inmuebles",
  obras_arte:     "Obras de Arte",
  private_equity: "Private Equity",
  tipos_cambio:   "Tipos de Cambio",
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>();

  const [client, setClient]           = useState<Client | null>(null);
  const [hojas, setHojas]             = useState<Hoja[]>([]);
  const [numPatrimonio, setNumPatrimonio] = useState(0);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState<"patrimonio" | "documentos" | "exportacion">("patrimonio");
  const [activeCategoria, setActiveCategoria] = useState<string>("");
  const [activeHoja, setActiveHoja]   = useState<string>("");
  const [rows, setRows]               = useState<PatrimonioRow[]>([]);
  const [columns, setColumns]         = useState<string[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loadingRows, setLoadingRows] = useState(false);
  const [q, setQ]                     = useState("");
  const LIMIT = 200;

  // ─── Cargar datos del cliente ───────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    fetch(`/api/clientes/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setClient(data.client);
        setHojas(data.patrimonio?.hojas ?? []);
        setNumPatrimonio(data.patrimonio?.num_registros ?? 0);

        // Seleccionar primera categoría disponible
        const primeraHoja = data.patrimonio?.hojas?.[0];
        if (primeraHoja) {
          setActiveCategoria(primeraHoja.categoria_id);
          setActiveHoja(primeraHoja.nombre);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  // ─── Cargar filas de la hoja activa ────────────────────────────────────────

  const fetchRows = useCallback(async () => {
    if (!id || !activeHoja) return;
    setLoadingRows(true);
    try {
      const params = new URLSearchParams({
        client_id:    id,
        categoria_id: activeCategoria,
        hoja:         activeHoja,
        page:         String(page),
        limit:        String(LIMIT),
        ...(q ? { q } : {}),
      });
      const res  = await fetch(`/api/patrimonio?${params}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);

      // Inferir columnas de la primera fila
      if (data.rows?.length > 0) {
        setColumns(Object.keys(data.rows[0].datos));
      }
    } finally {
      setLoadingRows(false);
    }
  }, [id, activeCategoria, activeHoja, page, q]);

  useEffect(() => {
    if (activeHoja) fetchRows();
  }, [fetchRows, activeHoja]);

  // ─── Categorías con hojas disponibles ──────────────────────────────────────

  const categoriasConHojas = [...new Set(hojas.map((h) => h.categoria_id))];
  const hojasDeCat = hojas.filter((h) => h.categoria_id === activeCategoria);

  // ─── KPIs de la hoja activa ─────────────────────────────────────────────────

  const hojaActiva = hojas.find((h) => h.nombre === activeHoja);
  const kpis = hojaActiva?.kpis ?? {};
  const kpiEntries = Object.entries(kpis).slice(0, 5);

  // ─── Formateo de valores ────────────────────────────────────────────────────

  function formatValue(v: unknown): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") {
      return v % 1 === 0
        ? v.toLocaleString("es-ES")
        : v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    return String(v);
  }

  function formatKpi(v: { sum: number; count: number }): string {
    if (!v) return "—";
    return v.sum.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ─── Exportar hoja a CSV ────────────────────────────────────────────────────

  function exportCSV() {
    if (!rows.length) return;
    const cols = Object.keys(rows[0].datos);
    const header = cols.join(";");
    const body = rows.map((r) =>
      cols.map((c) => {
        const v = r.datos[c];
        if (v === null || v === undefined) return "";
        return typeof v === "string" && v.includes(";") ? `"${v}"` : String(v);
      }).join(";")
    ).join("\n");
    const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${activeHoja}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="loading-full">Cargando expediente...</div>;
  if (!client) return <div className="loading-full">Cliente no encontrado.</div>;

  return (
    <div className="cliente-layout">
      {/* ── Cabecera del cliente ── */}
      <div className="cliente-header">
        <div className="cliente-breadcrumb">
          <Link href="/clientes" className="breadcrumb-link">Clientes</Link>
          <span className="breadcrumb-sep">/</span>
          <span>{client.full_name}</span>
        </div>
        <div className="cliente-meta">
          <h1 className="cliente-nombre">{client.full_name}</h1>
          <div className="cliente-datos">
            <span className="dato-item"><span className="dato-label">NIF</span> <span className="dato-mono">{client.nif}</span></span>
            {client.email && <span className="dato-item"><span className="dato-label">Correo</span> {client.email}</span>}
            <span className="dato-item"><span className="dato-label">Registros patrimoniales</span> {numPatrimonio.toLocaleString("es-ES")}</span>
            <span className="dato-item"><span className="dato-label">Expedientes</span> {client.irpf_expedientes?.length ?? 0}</span>
          </div>
        </div>

        {/* Tabs principales */}
        <div className="main-tabs">
          {(["patrimonio", "documentos", "exportacion"] as const).map((tab) => (
            <button
              key={tab}
              className={`main-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "patrimonio"  ? "Patrimonio" :
               tab === "documentos" ? "Documentos" : "Exportacion AEAT"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Contenido de la tab activa ── */}
      {activeTab === "patrimonio" && (
        <div className="patrimonio-layout">
          {/* Sidebar de categorías */}
          <nav className="cat-sidebar">
            <p className="cat-sidebar-title">Categorias</p>
            {categoriasConHojas.length === 0 ? (
              <p className="cat-empty">Sin datos patrimoniales.<br />Suba el Excel del cliente para importarlos.</p>
            ) : (
              categoriasConHojas.map((cat) => (
                <button
                  key={cat}
                  className={`cat-item ${activeCategoria === cat ? "active" : ""}`}
                  onClick={() => {
                    setActiveCategoria(cat);
                    const primera = hojas.find((h) => h.categoria_id === cat);
                    if (primera) setActiveHoja(primera.nombre);
                    setPage(1);
                  }}
                >
                  <span className="cat-label">{CATEGORIAS[cat] ?? cat}</span>
                  <span className="cat-count">{hojas.filter((h) => h.categoria_id === cat).length}</span>
                </button>
              ))
            )}
          </nav>

          {/* Panel principal */}
          <div className="patrimonio-main">
            {/* Tabs de hojas */}
            {hojasDeCat.length > 0 && (
              <div className="hoja-tabs">
                {hojasDeCat.map((h) => (
                  <button
                    key={h.nombre}
                    className={`hoja-tab ${activeHoja === h.nombre ? "active" : ""}`}
                    onClick={() => { setActiveHoja(h.nombre); setPage(1); }}
                  >
                    {h.nombre}
                    <span className="hoja-count">{h.num_filas.toLocaleString("es-ES")}</span>
                  </button>
                ))}
              </div>
            )}

            {/* KPIs de la hoja */}
            {kpiEntries.length > 0 && (
              <div className="kpi-bar">
                {kpiEntries.map(([col, v]) => (
                  <div key={col} className="kpi-item">
                    <span className="kpi-label">{col}</span>
                    <span className="kpi-value">{formatKpi(v)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Barra de herramientas */}
            <div className="table-toolbar">
              <input
                type="search"
                placeholder="Buscar en esta hoja..."
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="table-search"
              />
              <div className="toolbar-right">
                <span className="row-count">
                  {loadingRows ? "Cargando..." : `${total.toLocaleString("es-ES")} registros`}
                </span>
                <button className="btn-secondary" onClick={exportCSV} disabled={!rows.length}>
                  Descargar CSV
                </button>
              </div>
            </div>

            {/* Tabla de datos */}
            <div className="table-scroll">
              {loadingRows ? (
                <div className="table-loading">Cargando datos...</div>
              ) : rows.length === 0 ? (
                <div className="table-empty">Sin registros en esta hoja.</div>
              ) : (
                <table className="patrimonio-table">
                  <thead>
                    <tr>
                      {columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        {columns.map((col) => (
                          <td key={col} className={typeof row.datos[col] === "number" ? "cell-num" : ""}>
                            {formatValue(row.datos[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginación */}
            {total > LIMIT && (
              <div className="pagination">
                <button
                  className="btn-secondary"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </button>
                <span className="page-info">
                  Pagina {page} de {Math.ceil(total / LIMIT)}
                </span>
                <button
                  className="btn-secondary"
                  disabled={page >= Math.ceil(total / LIMIT)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "documentos" && (
        <div className="tab-content">
          <div className="tab-redirect">
            <p>Gestion de documentos e ingesta de PDFs bancarios.</p>
            <Link href={`/expedientes/${client.irpf_expedientes?.[0]?.id ?? ""}`} className="btn-primary">
              Ir al expediente activo
            </Link>
          </div>
        </div>
      )}

      {activeTab === "exportacion" && (
        <div className="tab-content">
          <div className="tab-redirect">
            <p>Generacion de modelos AEAT (100, 714, 720) para este cliente.</p>
            <Link href={`/expedientes/${client.irpf_expedientes?.[0]?.id ?? ""}`} className="btn-primary">
              Ir al expediente activo
            </Link>
          </div>
        </div>
      )}

      <style>{`
        .cliente-layout { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        .cliente-header { padding: 1.25rem 1.5rem 0; border-bottom: 1px solid var(--color-border, #d8d4cc); background: #fff; flex-shrink: 0; }
        .cliente-breadcrumb { font-size: 0.8rem; color: var(--color-muted, #888); margin-bottom: 0.75rem; display: flex; gap: 0.4rem; align-items: center; }
        .breadcrumb-link { color: var(--color-primary, #004438); text-decoration: underline; text-underline-offset: 3px; }
        .breadcrumb-sep { color: var(--color-border, #d8d4cc); }
        .cliente-nombre { font-size: 1.3rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0 0 0.5rem; }
        .cliente-datos { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .dato-item { font-size: 0.82rem; color: var(--color-muted, #888); }
        .dato-label { font-weight: 600; color: var(--color-text, #1a1a1a); margin-right: 0.3rem; }
        .dato-mono { font-family: 'Courier New', monospace; }
        .main-tabs { display: flex; gap: 0; border-bottom: none; }
        .main-tab { padding: 0.6rem 1.25rem; font-size: 0.85rem; font-weight: 500; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--color-muted, #888); }
        .main-tab.active { color: var(--color-primary, #004438); border-bottom-color: var(--color-primary, #004438); font-weight: 600; }
        .patrimonio-layout { display: flex; flex: 1; overflow: hidden; }
        .cat-sidebar { width: 200px; flex-shrink: 0; border-right: 1px solid var(--color-border, #d8d4cc); padding: 1rem 0; overflow-y: auto; background: #faf9f6; }
        .cat-sidebar-title { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted, #888); padding: 0 1rem; margin: 0 0 0.5rem; }
        .cat-item { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 0.5rem 1rem; background: none; border: none; cursor: pointer; font-size: 0.82rem; text-align: left; color: var(--color-text, #1a1a1a); }
        .cat-item:hover { background: #f0ede6; }
        .cat-item.active { background: var(--color-primary, #004438); color: #fff; }
        .cat-item.active .cat-count { background: rgba(255,255,255,0.2); color: #fff; }
        .cat-label { flex: 1; }
        .cat-count { font-size: 0.7rem; background: #e8e4dc; padding: 1px 5px; min-width: 18px; text-align: center; }
        .cat-empty { font-size: 0.8rem; color: var(--color-muted, #888); padding: 1rem; line-height: 1.5; }
        .patrimonio-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .hoja-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--color-border, #d8d4cc); padding: 0 1rem; overflow-x: auto; flex-shrink: 0; background: #fff; }
        .hoja-tab { padding: 0.5rem 0.9rem; font-size: 0.8rem; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; color: var(--color-muted, #888); display: flex; align-items: center; gap: 0.4rem; }
        .hoja-tab.active { color: var(--color-primary, #004438); border-bottom-color: var(--color-primary, #004438); font-weight: 600; }
        .hoja-count { font-size: 0.7rem; background: #e8e4dc; padding: 1px 4px; }
        .hoja-tab.active .hoja-count { background: var(--color-primary, #004438); color: #fff; }
        .kpi-bar { display: flex; gap: 0; border-bottom: 1px solid var(--color-border, #d8d4cc); flex-shrink: 0; overflow-x: auto; }
        .kpi-item { padding: 0.6rem 1.25rem; border-right: 1px solid var(--color-border, #d8d4cc); min-width: 140px; }
        .kpi-label { display: block; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-muted, #888); margin-bottom: 0.2rem; }
        .kpi-value { font-size: 0.95rem; font-weight: 700; font-family: 'Courier New', monospace; color: var(--color-primary, #004438); }
        .table-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 1rem; border-bottom: 1px solid var(--color-border, #d8d4cc); flex-shrink: 0; background: #fff; }
        .table-search { padding: 0.35rem 0.65rem; border: 1px solid var(--color-border, #d8d4cc); font-size: 0.82rem; width: 260px; }
        .table-search:focus { outline: 2px solid var(--color-primary, #004438); outline-offset: -1px; }
        .toolbar-right { display: flex; align-items: center; gap: 1rem; }
        .row-count { font-size: 0.8rem; color: var(--color-muted, #888); }
        .table-scroll { flex: 1; overflow: auto; }
        .patrimonio-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
        .patrimonio-table th { position: sticky; top: 0; background: #f5f4f0; padding: 0.45rem 0.65rem; text-align: left; border-bottom: 2px solid var(--color-border, #d8d4cc); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; color: var(--color-primary, #004438); }
        .patrimonio-table td { padding: 0.35rem 0.65rem; border-bottom: 1px solid #f0ede6; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
        .patrimonio-table tr:hover td { background: #faf9f6; }
        .cell-num { text-align: right; font-family: 'Courier New', monospace; }
        .table-loading, .table-empty { padding: 3rem; text-align: center; color: var(--color-muted, #888); font-size: 0.875rem; }
        .pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 0.75rem; border-top: 1px solid var(--color-border, #d8d4cc); flex-shrink: 0; }
        .page-info { font-size: 0.82rem; color: var(--color-muted, #888); }
        .tab-content { padding: 2rem; }
        .tab-redirect { max-width: 400px; }
        .tab-redirect p { margin-bottom: 1rem; color: var(--color-muted, #888); }
        .loading-full { display: flex; align-items: center; justify-content: center; height: 100vh; color: var(--color-muted, #888); }
        .btn-secondary { padding: 0.4rem 1rem; border: 1px solid var(--color-border, #d8d4cc); background: transparent; font-size: 0.82rem; cursor: pointer; }
        .btn-secondary:hover { background: #f5f4f0; }
        .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { display: inline-block; padding: 0.5rem 1.25rem; background: var(--color-primary, #004438); color: #fff; font-size: 0.875rem; font-weight: 600; border: none; cursor: pointer; text-decoration: none; }
      `}</style>
    </div>
  );
}
