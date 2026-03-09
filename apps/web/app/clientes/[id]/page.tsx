import { Suspense } from "react";
import { ClientWorkspaceLayout } from "@/components/workspace/client-workspace-layout";

export const dynamic = "force-dynamic";

export default function ClienteDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="page">
      <Suspense fallback={<section className="card"><p className="muted">Cargando workspace...</p></section>}>
        <ClientWorkspaceLayout clientId={params.id} />
      </Suspense>
    </div>
  );
}
