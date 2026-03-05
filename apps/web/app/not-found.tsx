import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <section className="card">
        <h1>Página no encontrada</h1>
        <p className="muted">
          La ruta solicitada no existe en esta consola. Verifique la URL o regrese al panel principal.
        </p>
        <p>
          <Link href="/">
            <strong>Volver al panel de control</strong>
          </Link>
        </p>
      </section>
    </div>
  );
}
