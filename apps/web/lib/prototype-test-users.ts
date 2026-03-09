export type PrototypeTestUserRole = "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";

export type PrototypeTestUser = {
  reference: string;
  display_name: string;
  email: string;
  role: PrototypeTestUserRole;
  role_label: string;
  focus_label: string;
  summary: string;
};

export const PROTOTYPE_SHARED_PASSWORD = "Prototipo2026!";

export const PROTOTYPE_TEST_USERS: PrototypeTestUser[] = [
  {
    reference: "demo-admin",
    display_name: "Demo Admin",
    email: "demo@irpf-parser.dev",
    role: "admin",
    role_label: "Administrador",
    focus_label: "Vista global",
    summary: "Acceso completo para recorrer cartera, configuración, revisión y modelos AEAT."
  },
  {
    reference: "demo-senior",
    display_name: "Fiscalista Senior",
    email: "senior@irpf-parser.dev",
    role: "fiscal_senior",
    role_label: "Fiscal senior",
    focus_label: "Revisión y cierre",
    summary: "Pensado para validar unidad fiscal, aprobación canónica y cierre declarativo."
  },
  {
    reference: "demo-junior",
    display_name: "Fiscalista Junior",
    email: "junior@irpf-parser.dev",
    role: "fiscal_junior",
    role_label: "Fiscal junior",
    focus_label: "Documental y preparación",
    summary: "Recorre cartera asignada, prueba carga documental sobre expediente vacío y sigue expedientes en curso."
  },
  {
    reference: "demo-readonly",
    display_name: "Solo Lectura",
    email: "readonly@irpf-parser.dev",
    role: "solo_lectura",
    role_label: "Solo lectura",
    focus_label: "Demo ejecutiva",
    summary: "Perfecto para walkthroughs con acceso de lectura a cliente, expediente y modelos."
  }
];
