"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
    type ClientPayload,
    type WorkspaceTab,
    WORKSPACE_TABS,
    emptyClientPayload,
    fetchClientPayload,
    toFiscalUnitForm,
    badgeVariant,
    resolveExpedientePhase,
    priorityScore,
} from "@/lib/client-types";
import { TabResumen } from "@/components/workspace/tabs/tab-resumen";
import { TabExpedientes } from "@/components/workspace/tabs/tab-expedientes";
import { TabDocumentos } from "@/components/workspace/tabs/tab-documentos";
import { TabPortfolio } from "@/components/workspace/tabs/tab-portfolio";
import { TabIrpf } from "@/components/workspace/tabs/tab-irpf";
import { TabPatrimonio } from "@/components/workspace/tabs/tab-patrimonio";

export function ClientWorkspaceLayout({ clientId }: { clientId: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const initialTab = (searchParams.get("tab") as WorkspaceTab) || "resumen";

    const [payload, setPayload] = useState<ClientPayload>(emptyClientPayload);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);

    useEffect(() => {
        let mounted = true;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const data = await fetchClientPayload(clientId);
                if (!mounted) return;
                setPayload(data);
            } catch (err) {
                if (!mounted) return;
                setError(err instanceof Error ? err.message : "No se pudo cargar el cliente");
            } finally {
                if (mounted) setLoading(false);
            }
        }
        void load();
        return () => { mounted = false; };
    }, [clientId]);

    function handleTabChange(tab: string) {
        setActiveTab(tab as WorkspaceTab);
        const params = new URLSearchParams(searchParams.toString());
        if (tab === "resumen") {
            params.delete("tab");
        } else {
            params.set("tab", tab);
        }
        const qs = params.toString();
        router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    }

    async function reloadClient() {
        const data = await fetchClientPayload(clientId);
        setPayload(data);
        setError(null);
    }

    if (loading) {
        return (
            <section className="card">
                <p className="muted">Cargando workspace del cliente...</p>
            </section>
        );
    }

    const { client, stats } = payload;
    const statusVariant = badgeVariant(client.status);

    // Resolve priority expediente
    const sortedExpedientes = [...payload.expedientes].sort(
        (a, b) => priorityScore(b) - priorityScore(a)
    );
    const priorityExp = sortedExpedientes[0] ?? null;
    const priorityStep = priorityExp ? resolveExpedientePhase(priorityExp) : null;

    return (
        <>
            {/* ─── Header fijo ─── */}
            <section className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                            Cliente
                        </span>
                        <h2 className="text-xl font-bold mt-1">
                            {client.display_name || "Cliente"}
                        </h2>
                        <p className="text-sm text-text-secondary mt-0.5">
                            {client.nif || "Sin NIF"} · ref. {client.reference || clientId}
                            {client.contact_person && ` · ${client.contact_person}`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant={statusVariant}>
                            {client.status === "active" ? "Activo" : client.status === "inactive" ? "Inactivo" : "Archivado"}
                        </Badge>
                    </div>
                </div>

                {error && <p className="badge danger mt-2">{error}</p>}

                {/* KPIs compactos */}
                <div className="kpi-grid mt-4">
                    <article className="kpi">
                        <span>Expedientes</span>
                        <strong>{stats.expedientes}</strong>
                    </article>
                    <article className="kpi">
                        <span>Documentos</span>
                        <strong>{stats.documents}</strong>
                    </article>
                    <article className="kpi">
                        <span>En revisión</span>
                        <strong>{stats.pending_review}</strong>
                    </article>
                    <article className="kpi">
                        <span>Activos</span>
                        <strong>{stats.assets}</strong>
                    </article>
                    <article className="kpi">
                        <span>Eventos fiscales</span>
                        <strong>{stats.fiscal_events}</strong>
                    </article>
                    <article className="kpi">
                        <span>Exportaciones</span>
                        <strong>{stats.exports}</strong>
                    </article>
                </div>

                {/* Siguiente paso */}
                {priorityExp && priorityStep && (
                    <div className="mt-4 p-3 rounded-md border border-border-default bg-surface-alt">
                        <p className="text-xs font-medium uppercase tracking-wider text-text-secondary mb-1">
                            Siguiente paso
                        </p>
                        <p className="text-sm font-medium">
                            {priorityExp.title} · {priorityExp.model_type} · {priorityExp.fiscal_year}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5">{priorityStep.detail}</p>
                        <Link
                            href={`/expedientes/${priorityExp.reference}${priorityStep.phase === "resumen" ? "" : `?fase=${priorityStep.phase}`
                                }`}
                            className="button-link text-sm mt-2 inline-block"
                        >
                            {priorityStep.label}
                        </Link>
                    </div>
                )}
            </section>

            {/* ─── Tabs del workspace ─── */}
            <section className="card mt-4">
                <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TabsList>
                        {WORKSPACE_TABS.map((tab) => (
                            <TabsTrigger key={tab.id} value={tab.id}>
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <TabsContent value="resumen">
                        <TabResumen payload={payload} onReload={reloadClient} clientId={clientId} />
                    </TabsContent>

                    <TabsContent value="portfolio">
                        <TabPortfolio payload={payload} />
                    </TabsContent>

                    <TabsContent value="irpf">
                        <TabIrpf payload={payload} />
                    </TabsContent>

                    <TabsContent value="patrimonio">
                        <TabPatrimonio payload={payload} />
                    </TabsContent>

                    <TabsContent value="expedientes">
                        <TabExpedientes payload={payload} />
                    </TabsContent>

                    <TabsContent value="documentos">
                        <TabDocumentos payload={payload} />
                    </TabsContent>
                </Tabs>
            </section>
        </>
    );
}
