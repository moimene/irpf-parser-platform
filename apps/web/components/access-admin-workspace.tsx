"use client";

import { useEffect, useState } from "react";

type UserRole = "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
type UserStatus = "active" | "inactive";
type AssignmentRole = "owner" | "manager" | "support" | "viewer";
type AccessLinkMode = "onboarding" | "recovery";
type AccessLinkDelivery = "invite" | "recovery";
type AccessOnboardingState = "no_auth_user" | "pending_onboarding" | "ready_no_login" | "active";

type AccessPayload = {
  current_user: {
    id: string;
    reference: string;
    display_name: string;
    email: string;
    role: UserRole;
    status: UserStatus;
  };
  users: Array<{
    id: string;
    reference: string;
    display_name: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    auth: {
      auth_user_id: string | null;
      invited_at: string | null;
      email_confirmed_at: string | null;
      last_sign_in_at: string | null;
      recovery_sent_at: string | null;
      onboarding_state: AccessOnboardingState;
    };
    assignment_count: number;
    assigned_clients: Array<{
      id: string;
      assignment_role: AssignmentRole;
      client_id: string;
      client_reference: string;
      client_display_name: string;
    }>;
  }>;
  clients: Array<{
    id: string;
    reference: string;
    display_name: string;
    status: "active" | "inactive" | "archived";
    assignment_count: number;
    assigned_users: Array<{
      id: string;
      assignment_role: AssignmentRole;
      user_id: string;
      user_reference: string;
      user_display_name: string;
      user_role: UserRole;
    }>;
  }>;
  assignments: Array<{
    id: string;
    assignment_role: AssignmentRole;
    created_at: string;
    user: {
      id: string;
      reference: string;
      display_name: string;
      email: string;
      role: UserRole;
      status: UserStatus;
    };
    client: {
      id: string;
      reference: string;
      display_name: string;
      status: "active" | "inactive" | "archived";
    };
  }>;
  audits: Array<{
    id: number;
    action:
      | "access.user.created"
      | "access.user.updated"
      | "access.user.onboarding_link.generated"
      | "access.user.recovery_link.generated"
      | "access.assignment.created"
      | "access.assignment.updated"
      | "access.assignment.deleted";
    created_at: string;
    actor: {
      id: string;
      reference: string;
      display_name: string;
      email: string;
      role: UserRole;
      status: UserStatus;
    } | null;
    target: {
      user: {
        id: string;
        reference: string;
        display_name: string;
      } | null;
      client: {
        id: string;
        reference: string;
        display_name: string;
      } | null;
      assignment_role: AssignmentRole | null;
    };
  }>;
};

const roleLabel: Record<UserRole, string> = {
  admin: "Administrador",
  fiscal_senior: "Fiscal senior",
  fiscal_junior: "Fiscal junior",
  solo_lectura: "Solo lectura"
};

const assignmentRoleLabel: Record<AssignmentRole, string> = {
  owner: "Owner",
  manager: "Manager",
  support: "Support",
  viewer: "Viewer"
};

const auditActionLabel: Record<AccessPayload["audits"][number]["action"], string> = {
  "access.user.created": "Alta de usuario",
  "access.user.updated": "Actualización de usuario",
  "access.user.onboarding_link.generated": "Enlace de onboarding",
  "access.user.recovery_link.generated": "Reset de contraseña",
  "access.assignment.created": "Alta de asignación",
  "access.assignment.updated": "Actualización de asignación",
  "access.assignment.deleted": "Eliminación de asignación"
};

const onboardingStateLabel: Record<AccessOnboardingState, string> = {
  no_auth_user: "Sin Auth",
  pending_onboarding: "Pendiente",
  ready_no_login: "Verificado",
  active: "Operativo"
};

const accessLinkLabel: Record<AccessLinkMode, string> = {
  onboarding: "Onboarding",
  recovery: "Reset password"
};

const accessLinkDeliveryLabel: Record<AccessLinkDelivery, string> = {
  invite: "invitación",
  recovery: "recuperación"
};

function describeAuditEntry(audit: AccessPayload["audits"][number]) {
  if (
    audit.action === "access.user.created" ||
    audit.action === "access.user.updated" ||
    audit.action === "access.user.onboarding_link.generated" ||
    audit.action === "access.user.recovery_link.generated"
  ) {
    return audit.target.user
      ? `${audit.target.user.display_name} · ${audit.target.user.reference}`
      : "Usuario";
  }

  const assignmentRole = audit.target.assignment_role
    ? assignmentRoleLabel[audit.target.assignment_role]
    : "Asignación";

  if (audit.target.user && audit.target.client) {
    return `${audit.target.user.display_name} -> ${audit.target.client.display_name} (${assignmentRole})`;
  }

  return assignmentRole;
}

export function AccessAdminWorkspace() {
  const [payload, setPayload] = useState<AccessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [savingAssignmentId, setSavingAssignmentId] = useState<string | null>(null);
  const [removingAssignmentId, setRemovingAssignmentId] = useState<string | null>(null);
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [userDrafts, setUserDrafts] = useState<Record<string, { role: UserRole; status: UserStatus }>>({});
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, AssignmentRole>>({});
  const [newAssignmentUserId, setNewAssignmentUserId] = useState("");
  const [newAssignmentClientId, setNewAssignmentClientId] = useState("");
  const [newAssignmentRole, setNewAssignmentRole] = useState<AssignmentRole>("manager");
  const [newUserDisplayName, setNewUserDisplayName] = useState("");
  const [newUserReference, setNewUserReference] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("fiscal_senior");
  const [newUserStatus, setNewUserStatus] = useState<UserStatus>("active");
  const [generatingAccessLinkUserId, setGeneratingAccessLinkUserId] = useState<string | null>(null);
  const [latestAccessLink, setLatestAccessLink] = useState<{
    userId: string;
    requested_mode: AccessLinkMode;
    delivery: AccessLinkDelivery;
    url: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/access", { cache: "no-store" });
      const body = (await response.json()) as AccessPayload | { error: string };

      if (!response.ok) {
        setError((body as { error: string }).error ?? "No se pudo cargar la administración de accesos");
        setPayload(null);
        return;
      }

      const nextPayload = body as AccessPayload;
      setPayload(nextPayload);
      setUserDrafts(
        Object.fromEntries(
          nextPayload.users.map((user) => [user.id, { role: user.role, status: user.status }])
        )
      );
      setAssignmentDrafts(
        Object.fromEntries(nextPayload.assignments.map((assignment) => [assignment.id, assignment.assignment_role]))
      );
      setNewAssignmentUserId(
        nextPayload.users.find((user) => user.role !== "admin" && user.status === "active")?.id ?? ""
      );
      setNewAssignmentClientId(nextPayload.clients[0]?.id ?? "");
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la administración de accesos"
      );
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSaveUser(userId: string) {
    const draft = userDrafts[userId];
    if (!draft) {
      return;
    }

    setSavingUserId(userId);
    setError(null);

    try {
      const response = await fetch(`/api/access/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "No se pudo actualizar el usuario");
        return;
      }

      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo actualizar el usuario");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleCreateAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newAssignmentUserId || !newAssignmentClientId) {
      setError("Debes seleccionar usuario y cliente para crear la asignación.");
      return;
    }

    setCreatingAssignment(true);
    setError(null);

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: newAssignmentUserId,
          client_id: newAssignmentClientId,
          assignment_role: newAssignmentRole
        })
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "No se pudo guardar la asignación");
        return;
      }

      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar la asignación");
    } finally {
      setCreatingAssignment(false);
    }
  }

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingUser(true);
    setError(null);

    try {
      const response = await fetch("/api/access/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: newUserDisplayName.trim(),
          reference: newUserReference.trim() || undefined,
          email: newUserEmail.trim(),
          role: newUserRole,
          status: newUserStatus
        })
      });
      const body = (await response.json()) as {
        error?: string;
        user?: { id: string };
        access_link?: {
          requested_mode: AccessLinkMode;
          delivery: AccessLinkDelivery;
          url: string;
        };
      };

      if (!response.ok) {
        setError(body.error ?? "No se pudo crear el usuario");
        return;
      }

      setNewUserDisplayName("");
      setNewUserReference("");
      setNewUserEmail("");
      setNewUserRole("fiscal_senior");
      setNewUserStatus("active");
      if (body.user?.id && body.access_link?.url) {
        setLatestAccessLink({
          userId: body.user.id,
          requested_mode: body.access_link.requested_mode,
          delivery: body.access_link.delivery,
          url: body.access_link.url
        });
      } else {
        setLatestAccessLink(null);
      }
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo crear el usuario");
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleGenerateAccessLink(userId: string, mode: AccessLinkMode) {
    setGeneratingAccessLinkUserId(userId);
    setError(null);

    try {
      const response = await fetch(`/api/access/users/${userId}/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const body = (await response.json()) as {
        error?: string;
        access_link?: {
          requested_mode: AccessLinkMode;
          delivery: AccessLinkDelivery;
          url: string;
        };
      };

      if (!response.ok || !body.access_link) {
        setError(body.error ?? "No se pudo generar el enlace seguro del usuario");
        return;
      }

      setLatestAccessLink({
        userId,
        requested_mode: body.access_link.requested_mode,
        delivery: body.access_link.delivery,
        url: body.access_link.url
      });
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo generar el enlace seguro del usuario"
      );
    } finally {
      setGeneratingAccessLinkUserId(null);
    }
  }

  async function handleCopyLink() {
    if (!latestAccessLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(latestAccessLink.url);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "No se pudo copiar el enlace");
    }
  }

  async function handleSaveAssignment(assignmentId: string) {
    const assignmentRole = assignmentDrafts[assignmentId];
    if (!assignmentRole) {
      return;
    }

    setSavingAssignmentId(assignmentId);
    setError(null);

    try {
      const response = await fetch(`/api/access/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignment_role: assignmentRole })
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "No se pudo actualizar la asignación");
        return;
      }

      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "No se pudo actualizar la asignación"
      );
    } finally {
      setSavingAssignmentId(null);
    }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    setRemovingAssignmentId(assignmentId);
    setError(null);

    try {
      const response = await fetch(`/api/access/assignments/${assignmentId}`, {
        method: "DELETE"
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "No se pudo eliminar la asignación");
        return;
      }

      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo eliminar la asignación");
    } finally {
      setRemovingAssignmentId(null);
    }
  }

  const activeUsers = payload?.users.filter((user) => user.status === "active").length ?? 0;
  const coveredClients = payload?.clients.filter((client) => client.assignment_count > 0).length ?? 0;
  const adminAvailableUsers =
    payload?.users.filter((user) => user.role !== "admin" && user.status === "active") ?? [];

  return (
    <>
      <section className="card">
        <h2>Gobierno de acceso</h2>
        <p className="muted">
          Controla roles del equipo fiscal y asignaciones por cliente sin tocar la capa técnica. El
          administrador conserva acceso global; el resto opera por asignación.
        </p>
        {payload?.current_user ? (
          <p className="muted">
            Sesión activa: <strong>{payload.current_user.display_name}</strong> ·{" "}
            {roleLabel[payload.current_user.role]}
          </p>
        ) : null}
        {error ? <p className="badge danger">{error}</p> : null}
        {loading ? <p className="muted">Cargando matriz de acceso...</p> : null}
        {!loading && payload ? (
          <div className="kpi-grid" style={{ marginTop: "12px" }}>
            <article className="kpi">
              <span>Usuarios activos</span>
              <strong>{activeUsers}</strong>
            </article>
            <article className="kpi">
              <span>Clientes cubiertos</span>
              <strong>{coveredClients}</strong>
            </article>
            <article className="kpi">
              <span>Asignaciones</span>
              <strong>{payload.assignments.length}</strong>
            </article>
            <article className="kpi">
              <span>Usuarios admin</span>
              <strong>{payload.users.filter((user) => user.role === "admin").length}</strong>
            </article>
            <article className="kpi">
              <span>Eventos auditados</span>
              <strong>{payload.audits.length}</strong>
            </article>
          </div>
        ) : null}
      </section>

      {payload ? (
        <>
          <section className="card">
            <h2>Alta de usuario del despacho</h2>
            <p className="muted">
              Crea el perfil persistente y emite un enlace seguro de onboarding para que cada usuario
              defina su propia contraseña sin compartir claves iniciales.
            </p>
            <form className="form" onSubmit={handleCreateUser}>
              <label htmlFor="new-user-display-name">Nombre visible</label>
              <input
                id="new-user-display-name"
                value={newUserDisplayName}
                onChange={(event) => setNewUserDisplayName(event.target.value)}
                placeholder="Ej: Marta Pérez"
                disabled={creatingUser}
                required
              />

              <label htmlFor="new-user-reference">Referencia interna (opcional)</label>
              <input
                id="new-user-reference"
                value={newUserReference}
                onChange={(event) => setNewUserReference(event.target.value)}
                placeholder="Ej: marta-perez"
                disabled={creatingUser}
              />

              <label htmlFor="new-user-email">Email</label>
              <input
                id="new-user-email"
                type="email"
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                placeholder="marta@despacho.com"
                disabled={creatingUser}
                required
              />

              <label htmlFor="new-user-role">Rol</label>
              <select
                id="new-user-role"
                value={newUserRole}
                onChange={(event) => setNewUserRole(event.target.value as UserRole)}
                disabled={creatingUser}
              >
                <option value="admin">Administrador</option>
                <option value="fiscal_senior">Fiscal senior</option>
                <option value="fiscal_junior">Fiscal junior</option>
                <option value="solo_lectura">Solo lectura</option>
              </select>

              <label htmlFor="new-user-status">Estado inicial</label>
              <select
                id="new-user-status"
                value={newUserStatus}
                onChange={(event) => setNewUserStatus(event.target.value as UserStatus)}
                disabled={creatingUser}
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
              {newUserStatus === "inactive" ? (
                <p className="muted">
                  Los usuarios inactivos se crean sin enlace de acceso hasta que vuelvan a activarse.
                </p>
              ) : null}

              <button type="submit" disabled={creatingUser}>
                {creatingUser ? "Creando usuario..." : "Crear usuario e invitar"}
              </button>
            </form>
            {latestAccessLink ? (
              <div style={{ marginTop: "12px" }}>
                <p className="muted">
                  Último enlace emitido: {accessLinkLabel[latestAccessLink.requested_mode]} vía{" "}
                  {accessLinkDeliveryLabel[latestAccessLink.delivery]}.
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <a href={latestAccessLink.url} target="_blank" rel="noreferrer">
                    Abrir enlace seguro
                  </a>
                  <button type="button" className="secondary" onClick={() => void handleCopyLink()}>
                    Copiar enlace
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="card">
            <h2>Usuarios y roles</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Clientes</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.display_name}</strong>
                        <br />
                        <span className="muted" style={{ fontSize: "0.75rem" }}>
                          {user.email} · {user.reference}
                        </span>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Onboarding: {onboardingStateLabel[user.auth.onboarding_state]}
                          {user.auth.last_sign_in_at
                            ? ` · último acceso ${new Date(user.auth.last_sign_in_at).toLocaleDateString("es-ES")}`
                            : user.auth.invited_at
                              ? ` · invitado ${new Date(user.auth.invited_at).toLocaleDateString("es-ES")}`
                              : ""}
                        </div>
                      </td>
                      <td>
                        <select
                          value={userDrafts[user.id]?.role ?? user.role}
                          onChange={(event) =>
                            setUserDrafts((current) => ({
                              ...current,
                              [user.id]: {
                                role: event.target.value as UserRole,
                                status: current[user.id]?.status ?? user.status
                              }
                            }))
                          }
                          disabled={savingUserId === user.id}
                        >
                          <option value="admin">Administrador</option>
                          <option value="fiscal_senior">Fiscal senior</option>
                          <option value="fiscal_junior">Fiscal junior</option>
                          <option value="solo_lectura">Solo lectura</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={userDrafts[user.id]?.status ?? user.status}
                          onChange={(event) =>
                            setUserDrafts((current) => ({
                              ...current,
                              [user.id]: {
                                role: current[user.id]?.role ?? user.role,
                                status: event.target.value as UserStatus
                              }
                            }))
                          }
                          disabled={savingUserId === user.id}
                        >
                          <option value="active">Activo</option>
                          <option value="inactive">Inactivo</option>
                        </select>
                      </td>
                      <td>
                        <strong>{user.assignment_count}</strong>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {user.assigned_clients.length > 0
                            ? user.assigned_clients
                                .map(
                                  (clientAssignment) =>
                                    `${clientAssignment.client_reference} (${assignmentRoleLabel[clientAssignment.assignment_role]})`
                                )
                                .join(", ")
                            : "Sin clientes asignados"}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="secondary"
                            disabled={savingUserId === user.id}
                            onClick={() => void handleSaveUser(user.id)}
                          >
                            {savingUserId === user.id ? "Guardando..." : "Guardar"}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={generatingAccessLinkUserId === user.id || user.status !== "active"}
                            onClick={() => void handleGenerateAccessLink(user.id, "onboarding")}
                          >
                            {generatingAccessLinkUserId === user.id ? "Emitiendo..." : "Onboarding"}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={generatingAccessLinkUserId === user.id || user.status !== "active"}
                            onClick={() => void handleGenerateAccessLink(user.id, "recovery")}
                          >
                            {generatingAccessLinkUserId === user.id ? "Emitiendo..." : "Reset"}
                          </button>
                        </div>
                        {latestAccessLink?.userId === user.id ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {accessLinkLabel[latestAccessLink.requested_mode]} vía{" "}
                            {accessLinkDeliveryLabel[latestAccessLink.delivery]}.{" "}
                            <a href={latestAccessLink.url} target="_blank" rel="noreferrer">
                              Abrir
                            </a>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Nueva asignación operativa</h2>
            <p className="muted">
              Asocia responsables a clientes para limitar su alcance en expedientes, intake, revisión y
              exportación.
            </p>
            <form className="form" onSubmit={handleCreateAssignment}>
              <label htmlFor="assignment-user">Usuario</label>
              <select
                id="assignment-user"
                value={newAssignmentUserId}
                onChange={(event) => setNewAssignmentUserId(event.target.value)}
                disabled={creatingAssignment}
              >
                {adminAvailableUsers.length === 0 ? (
                  <option value="">No hay usuarios operativos disponibles</option>
                ) : null}
                {adminAvailableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name} · {roleLabel[user.role]}
                  </option>
                ))}
              </select>

              <label htmlFor="assignment-client">Cliente</label>
              <select
                id="assignment-client"
                value={newAssignmentClientId}
                onChange={(event) => setNewAssignmentClientId(event.target.value)}
                disabled={creatingAssignment}
              >
                {payload.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.display_name} · {client.reference}
                  </option>
                ))}
              </select>

              <label htmlFor="assignment-role">Rol de asignación</label>
              <select
                id="assignment-role"
                value={newAssignmentRole}
                onChange={(event) => setNewAssignmentRole(event.target.value as AssignmentRole)}
                disabled={creatingAssignment}
              >
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="support">Support</option>
                <option value="viewer">Viewer</option>
              </select>

              <button
                type="submit"
                disabled={creatingAssignment || !newAssignmentUserId || !newAssignmentClientId}
              >
                {creatingAssignment ? "Guardando asignación..." : "Guardar asignación"}
              </button>
            </form>
          </section>

          <section className="card">
            <h2>Matriz de asignaciones</h2>
            {payload.assignments.length === 0 ? (
              <p className="muted">Todavía no hay asignaciones operativas cargadas.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Cliente</th>
                      <th>Rol</th>
                      <th>Creada</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.assignments.map((assignment) => (
                      <tr key={assignment.id}>
                        <td>
                          <strong>{assignment.user.display_name}</strong>
                          <br />
                          <span className="muted" style={{ fontSize: "0.75rem" }}>
                            {roleLabel[assignment.user.role]}
                          </span>
                        </td>
                        <td>
                          <strong>{assignment.client.display_name}</strong>
                          <br />
                          <span className="muted" style={{ fontSize: "0.75rem" }}>
                            {assignment.client.reference}
                          </span>
                        </td>
                        <td>
                          <select
                            value={assignmentDrafts[assignment.id] ?? assignment.assignment_role}
                            onChange={(event) =>
                              setAssignmentDrafts((current) => ({
                                ...current,
                                [assignment.id]: event.target.value as AssignmentRole
                              }))
                            }
                            disabled={savingAssignmentId === assignment.id || removingAssignmentId === assignment.id}
                          >
                            <option value="owner">Owner</option>
                            <option value="manager">Manager</option>
                            <option value="support">Support</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </td>
                        <td>{new Date(assignment.created_at).toLocaleString("es-ES")}</td>
                        <td>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="secondary"
                              disabled={
                                savingAssignmentId === assignment.id || removingAssignmentId === assignment.id
                              }
                              onClick={() => void handleSaveAssignment(assignment.id)}
                            >
                              {savingAssignmentId === assignment.id ? "Guardando..." : "Actualizar"}
                            </button>
                            <button
                              type="button"
                              disabled={
                                savingAssignmentId === assignment.id || removingAssignmentId === assignment.id
                              }
                              onClick={() => void handleRemoveAssignment(assignment.id)}
                            >
                              {removingAssignmentId === assignment.id ? "Eliminando..." : "Eliminar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Auditoría funcional de accesos</h2>
            <p className="muted">
              Últimos cambios de usuarios y asignaciones persistidos en `irpf_audit_log`.
            </p>
            {payload.audits.length === 0 ? (
              <p className="muted">Todavía no hay cambios auditados en el módulo de acceso.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Acción</th>
                      <th>Detalle</th>
                      <th>Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.audits.map((audit) => (
                      <tr key={audit.id}>
                        <td>{new Date(audit.created_at).toLocaleString("es-ES")}</td>
                        <td>{auditActionLabel[audit.action]}</td>
                        <td>{describeAuditEntry(audit)}</td>
                        <td>
                          {audit.actor ? (
                            <>
                              <strong>{audit.actor.display_name}</strong>
                              <br />
                              <span className="muted" style={{ fontSize: "0.75rem" }}>
                                {audit.actor.reference}
                              </span>
                            </>
                          ) : (
                            <span className="muted">Actor no resuelto</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
