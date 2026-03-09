import { ExpedienteStepperLayout } from "@/components/stepper/expediente-stepper-layout";

export const dynamic = "force-dynamic";

export default function ExpedientePage({ params }: { params: { id: string } }) {
  return <ExpedienteStepperLayout expedienteId={params.id} />;
}
