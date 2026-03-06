"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useCallback } from "react";

interface Template {
  id: string;
  nombre: string;
  codigo: string;
  keywords: string[];
  field_mappings: Record<string, string>;
  nivel: number;
  activa: boolean;
  notas?: string;
  creado_por?: string;
  created_at: string;
}

const NIVEL_LABELS: Record<number, string> = {
  1: "Nivel 1 — Plantilla",
  2: "Nivel 2 — LLM",
  3: "Nivel 3 — Manual",
};

// Plantillas predefinidas del sistema
const SYSTEM_TEMPLATES = [
  { codigo: "PICTET",   nombre: "Pictet & Cie",         nivel: 1 },
  { codigo: "GS",       nombre: "Goldman Sachs",         nivel: 1 },
  { codigo: "CITI",     nombre: "Citi Brokerage",        nivel: 1 },
  { codigo: "JPMORGAN", nombre: "J.P. Morgan",           nivel: 1 },
  { codigo: "UNKNOWN",  nombre: "Entidad desconocida",   nivel: 2 },
];

export default function ConfiguracionPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<Template | null>(null);
  const [form, setForm]           = useState({
    nombre: "", codigo: "", keywords: "", field_mappings: "", nivel: 1, notas: "",
  });

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/entity-templates");
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch {
      setError("Error al cargar las plantillas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  function openNew() {
    setSelected(null);
    setForm({ nombre: "", codigo: "", keywords: "", field_mappings: "", nivel: 1, notas: "" });
    setError(null);
    setShowForm(true);
  }

  function openEdit(t: Template) {
    setSelected(t);
    setForm({
      nombre:         t.nombre,
      codigo:         t.codigo,
      keywords:       t.keywords.join(", "),
      field_mappings: JSON.stringify(t.field_mappings, null, 2),
      nivel:          t.nivel,
      notas:          t.notas ?? "",
    });
    setError(null);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    let fieldMappings: Record<string, string> = {};
    try {
      if (form.field_mappings.trim()) {
        fieldMappings = JSON.parse(form.field_mappings);
      }
    } catch {
      setError("El campo Mapeo de campos no es JSON valido");
      setSaving(false);
      return;
    }

    const payload = {
      nombre:         form.nombre,
      codigo:         form.codigo,
      keywords:       form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      field_mappings: fieldMappings,
      nivel:          form.nivel,
      notas:          form.notas,
    };

    try {
      const url    = selected ? `/api/entity-templates/${selected.id}` : "/api/entity-templates";
      const method = selected ? "PATCH" : "POST";
      const res    = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setShowForm(false);
      fetchTemplates();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm("Desactivar esta plantilla. El parser usara el fallback LLM para esta entidad.")) return;
    await fetch(`/api/entity-templates/${id}`, { method: "DELETE" });
    fetchTemplates();
  }

  return (
    <div className="config-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuracion</h1>
          <p className="page-subtitle">Plantillas de entidades bancarias para el parser</p>
        </div>
        <button className="btn-primary" onClick={openNew}>
          Nueva plantilla
        </button>
      </div>

      {/* Plantillas del sistema */}
      <section className="config-section">
        <h2 className="section-title">Extractores del sistema</h2>
        <p className="section-desc">
          Estos extractores estan compilados en el parser service (Railway). No requieren configuracion adicional.
          Para modificar su logica, actualice el codigo en <code>services/parser/app/extractors/</code>.
        </p>
        <table className="data-table">
          <thead>
            <tr><th>Entidad</th><th>Codigo</th><th>Nivel</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {SYSTEM_TEMPLATES.map((t) => (
              <tr key={t.codigo}>
                <td className="cell-primary">{t.nombre}</td>
                <td className="cell-mono">{t.codigo}</td>
                <td>{NIVEL_LABELS[t.nivel]}</td>
                <td><span className="status-ok-badge">Activo</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Plantillas personalizadas */}
      <section className="config-section">
        <h2 className="section-title">Plantillas personalizadas</h2>
        <p className="section-desc">
          Defina nuevas entidades bancarias sin necesidad de modificar el codigo del parser.
          El sistema detectara automaticamente la entidad por las palabras clave y aplicara el mapeo de campos.
        </p>

        {error && !showForm && <div className="alert-error">{error}</div>}

        {loading ? (
          <div className="loading-state">Cargando plantillas...</div>
        ) : templates.length === 0 ? (
          <div className="empty-state">
            <p>No hay plantillas personalizadas. Cree la primera para extender el parser a nuevas entidades.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Entidad</th><th>Codigo</th><th>Keywords</th><th>Nivel</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="cell-primary">{t.nombre}</td>
                  <td className="cell-mono">{t.codigo}</td>
                  <td className="cell-keywords">
                    {t.keywords.slice(0, 3).map((k) => (
                      <span key={k} className="keyword-tag">{k}</span>
                    ))}
                    {t.keywords.length > 3 && <span className="keyword-more">+{t.keywords.length - 3}</span>}
                  </td>
                  <td className="cell-muted">{NIVEL_LABELS[t.nivel] ?? `Nivel ${t.nivel}`}</td>
                  <td>
                    {t.activa
                      ? <span className="status-ok-badge">Activa</span>
                      : <span className="status-off-badge">Inactiva</span>
                    }
                  </td>
                  <td className="cell-actions">
                    <button className="btn-link" onClick={() => openEdit(t)}>Editar</button>
                    {t.activa && (
                      <button className="btn-link btn-danger" onClick={() => handleDeactivate(t.id)}>
                        Desactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Modal de creacion/edicion */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selected ? `Editar: ${selected.nombre}` : "Nueva plantilla de entidad"}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>Cerrar</button>
            </div>
            <form onSubmit={handleSave} className="form-grid">
              <div className="field">
                <label>Nombre de la entidad *</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  required
                  placeholder="Banco Santander Private Banking"
                />
              </div>
              <div className="field">
                <label>Codigo identificador *</label>
                <input
                  type="text"
                  value={form.codigo}
                  onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
                  required
                  placeholder="SANTANDER"
                  disabled={!!selected}
                />
                {!selected && <span className="field-hint">Identificador unico en mayusculas. No se puede cambiar.</span>}
              </div>
              <div className="field field-full">
                <label>Palabras clave de deteccion</label>
                <input
                  type="text"
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                  placeholder="Santander, SAN Private, Banca Privada Santander"
                />
                <span className="field-hint">Separadas por comas. El parser buscara estas palabras en el nombre del archivo y en el texto del PDF.</span>
              </div>
              <div className="field">
                <label>Nivel de extraccion</label>
                <select
                  value={form.nivel}
                  onChange={(e) => setForm({ ...form, nivel: parseInt(e.target.value) })}
                >
                  <option value={1}>Nivel 1 — Plantilla (reglas)</option>
                  <option value={2}>Nivel 2 — LLM (GPT-4o-mini)</option>
                </select>
              </div>
              <div className="field">
                <label>Notas internas</label>
                <input
                  type="text"
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  placeholder="Formato de extracto mensual desde 2020..."
                />
              </div>
              <div className="field field-full">
                <label>Mapeo de campos (JSON)</label>
                <textarea
                  value={form.field_mappings}
                  onChange={(e) => setForm({ ...form, field_mappings: e.target.value })}
                  rows={6}
                  placeholder={'{\n  "Fecha Operacion": "fecha",\n  "ISIN": "isin",\n  "Importe": "importe"\n}'}
                  className="code-textarea"
                />
                <span className="field-hint">Mapeo de nombres de columna del PDF a los campos del modelo de datos.</span>
              </div>
              {error && <div className="alert-error field-full">{error}</div>}
              <div className="form-actions field-full">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Guardando..." : selected ? "Guardar cambios" : "Crear plantilla"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .config-page { padding: 2rem; max-width: 1100px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
        .page-title { font-size: 1.4rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0; }
        .page-subtitle { font-size: 0.85rem; color: var(--color-muted, #888); margin: 0.25rem 0 0; }
        .config-section { background: #fff; border: 1px solid var(--color-border, #d8d4cc); padding: 1.5rem; margin-bottom: 1.5rem; }
        .section-title { font-size: 0.9rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0 0 0.5rem; }
        .section-desc { font-size: 0.82rem; color: var(--color-muted, #888); margin: 0 0 1.25rem; line-height: 1.5; }
        .section-desc code { font-family: 'Courier New', monospace; background: #f0ede6; padding: 1px 4px; font-size: 0.78rem; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .data-table th { text-align: left; padding: 0.5rem 0.65rem; border-bottom: 2px solid var(--color-primary, #004438); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-primary, #004438); }
        .data-table td { padding: 0.55rem 0.65rem; border-bottom: 1px solid var(--color-border, #d8d4cc); vertical-align: middle; }
        .data-table tr:hover td { background: #faf9f6; }
        .cell-primary { font-weight: 600; }
        .cell-mono { font-family: 'Courier New', monospace; font-size: 0.82rem; }
        .cell-muted { color: var(--color-muted, #888); font-size: 0.82rem; }
        .cell-keywords { display: flex; gap: 0.3rem; flex-wrap: wrap; }
        .cell-actions { display: flex; gap: 0.75rem; }
        .keyword-tag { font-size: 0.7rem; padding: 2px 6px; background: #f0ede6; border: 1px solid #d8d4cc; }
        .keyword-more { font-size: 0.7rem; color: var(--color-muted, #888); }
        .status-ok-badge  { font-size: 0.7rem; padding: 2px 7px; background: #d1fae5; color: #065f46; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .status-off-badge { font-size: 0.7rem; padding: 2px 7px; background: #f0ede6; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .btn-link { background: none; border: none; font-size: 0.82rem; color: var(--color-primary, #004438); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 0; }
        .btn-danger { color: #991b1b; }
        .loading-state, .empty-state { padding: 2rem; text-align: center; color: var(--color-muted, #888); font-size: 0.875rem; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 0.75rem 1rem; font-size: 0.85rem; margin-bottom: 1rem; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
        .modal-panel { background: #fff; width: 100%; max-width: 640px; padding: 2rem; max-height: 90vh; overflow-y: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
        .modal-header h2 { font-size: 1rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0; }
        .modal-close { background: none; border: none; font-size: 0.85rem; color: var(--color-muted, #888); cursor: pointer; text-decoration: underline; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .field { display: flex; flex-direction: column; gap: 0.3rem; }
        .field-full { grid-column: 1 / -1; }
        .field label { font-size: 0.78rem; font-weight: 600; color: var(--color-text, #1a1a1a); }
        .field input, .field select, .field textarea { padding: 0.45rem 0.65rem; border: 1px solid var(--color-border, #d8d4cc); font-size: 0.875rem; background: #fff; }
        .field input:focus, .field select:focus, .field textarea:focus { outline: 2px solid var(--color-primary, #004438); outline-offset: -1px; }
        .field input:disabled { background: #f5f4f0; color: var(--color-muted, #888); }
        .field-hint { font-size: 0.72rem; color: var(--color-muted, #888); line-height: 1.4; }
        .code-textarea { font-family: 'Courier New', monospace; font-size: 0.8rem; }
        .form-actions { display: flex; justify-content: flex-end; gap: 0.75rem; }
        .btn-primary { padding: 0.5rem 1.25rem; background: var(--color-primary, #004438); color: #fff; font-size: 0.875rem; font-weight: 600; border: none; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary { padding: 0.5rem 1.25rem; border: 1px solid var(--color-border, #d8d4cc); background: transparent; font-size: 0.875rem; cursor: pointer; }
      `}</style>
    </div>
  );
}
