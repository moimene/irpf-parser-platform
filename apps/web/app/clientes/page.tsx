"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Expediente {
  id: string;
  fiscal_year: number;
  status: string;
  reference: string;
}

interface Client {
  id: string;
  full_name: string;
  nif: string;
  email?: string;
  phone?: string;
  notes?: string;
  created_at: string;
  num_expedientes: number;
  ejercicios: number[];
  irpf_expedientes?: Expediente[];
}

export default function ClientesPage() {
  const [clients, setClients]   = useState<Client[]>([]);
  const [loading, setLoading]   = useState(true);
  const [q, setQ]               = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [form, setForm]         = useState({
    full_name: "", nif: "", email: "", phone: "", notes: "",
  });

  const fetchClients = useCallback(async (search = "") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clientes?q=${encodeURIComponent(search)}`);
      const data = await res.json();
      setClients(data.clients ?? []);
    } catch {
      setError("Error al cargar los clientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // Búsqueda con debounce
  useEffect(() => {
    const t = setTimeout(() => fetchClients(q), 300);
    return () => clearTimeout(t);
  }, [q, fetchClients]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear el cliente");
      setShowForm(false);
      setForm({ full_name: "", nif: "", email: "", phone: "", notes: "" });
      fetchClients(q);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">
            {loading ? "Cargando..." : `${clients.length} cliente${clients.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          Nuevo cliente
        </button>
      </div>

      {/* Buscador */}
      <div className="search-bar">
        <input
          type="search"
          placeholder="Buscar por nombre o NIF..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="search-input"
        />
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Tabla de clientes */}
      {loading ? (
        <div className="loading-state">Cargando clientes...</div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <p>No se encontraron clientes{q ? ` para "${q}"` : ""}.</p>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            Crear el primer cliente
          </button>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>NIF</th>
              <th>Contacto</th>
              <th>Expedientes</th>
              <th>Ejercicios</th>
              <th>Alta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td className="cell-primary">{c.full_name}</td>
                <td className="cell-mono">{c.nif}</td>
                <td className="cell-muted">{c.email ?? "—"}</td>
                <td className="cell-center">{c.num_expedientes}</td>
                <td className="cell-tags">
                  {c.ejercicios.slice(0, 4).map((y) => (
                    <span key={y} className="tag">{y}</span>
                  ))}
                  {c.ejercicios.length > 4 && (
                    <span className="tag tag-more">+{c.ejercicios.length - 4}</span>
                  )}
                </td>
                <td className="cell-muted">
                  {new Date(c.created_at).toLocaleDateString("es-ES")}
                </td>
                <td className="cell-actions">
                  <Link href={`/clientes/${c.id}`} className="btn-link">
                    Ver expediente
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Modal de nuevo cliente */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nuevo cliente</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>
                Cerrar
              </button>
            </div>
            <form onSubmit={handleCreate} className="form-grid">
              <div className="field">
                <label>Nombre completo *</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                  placeholder="Apellido Apellido, Nombre"
                />
              </div>
              <div className="field">
                <label>NIF / NIE *</label>
                <input
                  type="text"
                  value={form.nif}
                  onChange={(e) => setForm({ ...form, nif: e.target.value.toUpperCase() })}
                  required
                  placeholder="12345678A"
                />
              </div>
              <div className="field">
                <label>Correo electrónico</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="cliente@email.com"
                />
              </div>
              <div className="field">
                <label>Teléfono</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+34 600 000 000"
                />
              </div>
              <div className="field field-full">
                <label>Notas internas</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  placeholder="Observaciones del expediente..."
                />
              </div>
              {error && <div className="alert-error field-full">{error}</div>}
              <div className="form-actions field-full">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? "Guardando..." : "Crear cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .page-container { padding: 2rem; max-width: 1200px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
        .page-title { font-size: 1.4rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0; }
        .page-subtitle { font-size: 0.85rem; color: var(--color-muted, #888); margin: 0.25rem 0 0; }
        .search-bar { margin-bottom: 1.25rem; }
        .search-input { width: 100%; max-width: 400px; padding: 0.5rem 0.75rem; border: 1px solid var(--color-border, #d8d4cc); font-size: 0.9rem; background: #fff; }
        .search-input:focus { outline: 2px solid var(--color-primary, #004438); outline-offset: -1px; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .data-table th { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--color-primary, #004438); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-primary, #004438); }
        .data-table td { padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--color-border, #d8d4cc); vertical-align: middle; }
        .data-table tr:hover td { background: #f9f8f5; }
        .cell-primary { font-weight: 600; color: var(--color-text, #1a1a1a); }
        .cell-mono { font-family: 'Courier New', monospace; font-size: 0.82rem; }
        .cell-muted { color: var(--color-muted, #888); }
        .cell-center { text-align: center; }
        .cell-tags { display: flex; gap: 0.3rem; flex-wrap: wrap; }
        .cell-actions { text-align: right; }
        .tag { font-size: 0.72rem; padding: 2px 6px; background: #f0ede6; border: 1px solid #d8d4cc; color: var(--color-text, #1a1a1a); }
        .tag-more { background: transparent; color: var(--color-muted, #888); border-color: transparent; }
        .btn-link { font-size: 0.82rem; color: var(--color-primary, #004438); text-decoration: underline; text-underline-offset: 3px; }
        .loading-state, .empty-state { padding: 3rem; text-align: center; color: var(--color-muted, #888); }
        .empty-state p { margin-bottom: 1rem; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 0.75rem 1rem; font-size: 0.85rem; margin-bottom: 1rem; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
        .modal-panel { background: #fff; width: 100%; max-width: 560px; padding: 2rem; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
        .modal-header h2 { font-size: 1.1rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0; }
        .modal-close { background: none; border: none; font-size: 0.85rem; color: var(--color-muted, #888); cursor: pointer; text-decoration: underline; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .field-full { grid-column: 1 / -1; }
        .form-actions { display: flex; justify-content: flex-end; gap: 0.75rem; }
        .btn-secondary { padding: 0.5rem 1.25rem; border: 1px solid var(--color-border, #d8d4cc); background: transparent; font-size: 0.875rem; cursor: pointer; }
      `}</style>
    </div>
  );
}
