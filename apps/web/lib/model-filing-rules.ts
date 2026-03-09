import type { CanonicalAssetMetrics } from "@/lib/canonical-exports";
import type { CanonicalForeignAssetBlock } from "@/lib/fiscal-canonical";

export const MODEL_714_GENERAL_EXEMPTION_EUR = 700000;
export const MODEL_714_MANDATORY_GROSS_THRESHOLD_EUR = 2000000;
export const MODEL_720_INITIAL_THRESHOLD_EUR = 50000;
export const MODEL_720_REDECLARE_INCREMENT_EUR = 20000;

export type FilingDecision = "file" | "review" | "do_not_file";

export type ForeignBlockTotals = Record<CanonicalForeignAssetBlock, number>;

export type Model714RequirementAssessment = {
  filingDecision: FilingDecision;
  totalValuation: number;
  estimatedTaxableBase: number;
  generalExemption: number;
  mandatoryGrossThreshold: number;
  detail: string;
  reasons: string[];
};

export type Model720RequirementAssessment = {
  filingDecision: FilingDecision;
  priorFiledYear: number | null;
  initialThreshold: number;
  redeclareIncreaseThreshold: number;
  currentBlockTotals: ForeignBlockTotals;
  previousBlockTotals: ForeignBlockTotals | null;
  thresholdBlocks: CanonicalForeignAssetBlock[];
  increasedBlocks: CanonicalForeignAssetBlock[];
  extinguishmentBlocks: CanonicalForeignAssetBlock[];
  foreignTransmissionEvents: number;
  detail: string;
  reasons: string[];
};

const foreignBlocks: CanonicalForeignAssetBlock[] = ["accounts", "securities", "insurance_real_estate", "other"];

export function emptyForeignBlockTotals(): ForeignBlockTotals {
  return {
    accounts: 0,
    securities: 0,
    insurance_real_estate: 0,
    other: 0
  };
}

function toRoundedAmount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(2));
}

export function normalizeForeignBlockTotals(
  value?: Partial<Record<CanonicalForeignAssetBlock, number>> | null
): ForeignBlockTotals {
  const base = emptyForeignBlockTotals();
  if (!value) {
    return base;
  }

  for (const block of foreignBlocks) {
    base[block] = toRoundedAmount(value[block]);
  }

  return base;
}

export function foreignBlockTotalsFromPayload(
  payload: unknown
): ForeignBlockTotals | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = (payload as Record<string, unknown>).foreign_block_totals;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const totals = normalizeForeignBlockTotals(candidate as Partial<Record<CanonicalForeignAssetBlock, number>>);
  const hasData = foreignBlocks.some((block) => totals[block] > 0);
  return hasData ? totals : null;
}

export function assessModel714Requirement(input: {
  totalValuation: number;
  generalExemption?: number;
  mandatoryGrossThreshold?: number;
}): Model714RequirementAssessment {
  const generalExemption = input.generalExemption ?? MODEL_714_GENERAL_EXEMPTION_EUR;
  const mandatoryGrossThreshold = input.mandatoryGrossThreshold ?? MODEL_714_MANDATORY_GROSS_THRESHOLD_EUR;
  const totalValuation = toRoundedAmount(input.totalValuation);
  const estimatedTaxableBase = toRoundedAmount(Math.max(totalValuation - generalExemption, 0));

  if (totalValuation > mandatoryGrossThreshold) {
    return {
      filingDecision: "file",
      totalValuation,
      estimatedTaxableBase,
      generalExemption,
      mandatoryGrossThreshold,
      detail:
        `El patrimonio bruto consolidado supera ${mandatoryGrossThreshold.toLocaleString("es-ES")} EUR y activa obligación estatal de presentar Modelo 714.`,
      reasons: [
        `Patrimonio bruto estimado: ${totalValuation.toLocaleString("es-ES")} EUR.`,
        `Umbral estatal de obligación por patrimonio bruto: ${mandatoryGrossThreshold.toLocaleString("es-ES")} EUR.`
      ]
    };
  }

  if (totalValuation <= generalExemption) {
    return {
      filingDecision: "do_not_file",
      totalValuation,
      estimatedTaxableBase,
      generalExemption,
      mandatoryGrossThreshold,
      detail:
        `El patrimonio consolidado no supera el mínimo exento estatal general de ${generalExemption.toLocaleString("es-ES")} EUR. Revisa solo si aplica norma autonómica distinta.`,
      reasons: [
        `Patrimonio bruto estimado: ${totalValuation.toLocaleString("es-ES")} EUR.`,
        `Mínimo exento estatal general: ${generalExemption.toLocaleString("es-ES")} EUR.`
      ]
    };
  }

  return {
    filingDecision: "review",
    totalValuation,
    estimatedTaxableBase,
    generalExemption,
    mandatoryGrossThreshold,
    detail:
      `El patrimonio consolidado supera ${generalExemption.toLocaleString("es-ES")} EUR pero no rebasa ${mandatoryGrossThreshold.toLocaleString("es-ES")} EUR. Debe revisarse cuota resultante, deudas y normativa autonómica antes de decidir la presentación del Modelo 714.`,
    reasons: [
      `Patrimonio bruto estimado: ${totalValuation.toLocaleString("es-ES")} EUR.`,
      `Base estimada sobre mínimo estatal: ${estimatedTaxableBase.toLocaleString("es-ES")} EUR.`
    ]
  };
}

export function assessModel720Requirement(input: {
  metrics: Pick<CanonicalAssetMetrics, "foreignBlockTotals" | "thresholdReachedBlocks">;
  priorFiledYear?: number | null;
  previousBlockTotals?: Partial<Record<CanonicalForeignAssetBlock, number>> | null;
  foreignTransmissionEvents?: number;
  initialThreshold?: number;
  redeclareIncreaseThreshold?: number;
}): Model720RequirementAssessment {
  const initialThreshold = input.initialThreshold ?? MODEL_720_INITIAL_THRESHOLD_EUR;
  const redeclareIncreaseThreshold = input.redeclareIncreaseThreshold ?? MODEL_720_REDECLARE_INCREMENT_EUR;
  const currentBlockTotals = normalizeForeignBlockTotals(input.metrics.foreignBlockTotals);
  const previousBlockTotals = input.priorFiledYear
    ? normalizeForeignBlockTotals(input.previousBlockTotals)
    : null;
  const thresholdBlocks = [...input.metrics.thresholdReachedBlocks];
  const foreignTransmissionEvents = Math.max(0, input.foreignTransmissionEvents ?? 0);

  if (!input.priorFiledYear) {
    if (thresholdBlocks.length > 0) {
      return {
        filingDecision: "file",
        priorFiledYear: null,
        initialThreshold,
        redeclareIncreaseThreshold,
        currentBlockTotals,
        previousBlockTotals: null,
        thresholdBlocks,
        increasedBlocks: [],
        extinguishmentBlocks: [],
        foreignTransmissionEvents,
        detail:
          `Primera valoración 720 con ${thresholdBlocks.length} bloque(s) que superan ${initialThreshold.toLocaleString("es-ES")} EUR.`,
        reasons: thresholdBlocks.map((block) =>
          `Bloque ${block}: ${currentBlockTotals[block].toLocaleString("es-ES")} EUR.`
        )
      };
    }

    return {
      filingDecision: "do_not_file",
      priorFiledYear: null,
      initialThreshold,
      redeclareIncreaseThreshold,
      currentBlockTotals,
      previousBlockTotals: null,
      thresholdBlocks,
      increasedBlocks: [],
      extinguishmentBlocks: [],
      foreignTransmissionEvents,
      detail:
        `Primera valoración 720 sin bloques que alcancen ${initialThreshold.toLocaleString("es-ES")} EUR. No procede nueva presentación con la información consolidada.`,
      reasons: ["No se supera el umbral operativo inicial por bloque."]
    };
  }

  const increasedBlocks = foreignBlocks.filter((block) => {
    return currentBlockTotals[block] - (previousBlockTotals?.[block] ?? 0) > redeclareIncreaseThreshold;
  });
  const extinguishmentBlocks = foreignBlocks.filter((block) => {
    return (previousBlockTotals?.[block] ?? 0) > 0 && currentBlockTotals[block] === 0;
  });

  if (increasedBlocks.length > 0 || extinguishmentBlocks.length > 0) {
    const reasons: string[] = [];

    for (const block of increasedBlocks) {
      reasons.push(
        `Bloque ${block}: incremento de ${(
          currentBlockTotals[block] - (previousBlockTotals?.[block] ?? 0)
        ).toLocaleString("es-ES")} EUR frente a la última declaración.`
      );
    }

    for (const block of extinguishmentBlocks) {
      reasons.push(`Bloque ${block}: existía saldo declarado previo y ahora queda a cero.`);
    }

    return {
      filingDecision: "file",
      priorFiledYear: input.priorFiledYear,
      initialThreshold,
      redeclareIncreaseThreshold,
      currentBlockTotals,
      previousBlockTotals,
      thresholdBlocks,
      increasedBlocks,
      extinguishmentBlocks,
      foreignTransmissionEvents,
      detail:
        `Existe 720 previa del ejercicio ${input.priorFiledYear} y se detectan variaciones materiales que vuelven a activar presentación.`,
      reasons
    };
  }

  if (foreignTransmissionEvents > 0) {
    return {
      filingDecision: "review",
      priorFiledYear: input.priorFiledYear,
      initialThreshold,
      redeclareIncreaseThreshold,
      currentBlockTotals,
      previousBlockTotals,
      thresholdBlocks,
      increasedBlocks,
      extinguishmentBlocks,
      foreignTransmissionEvents,
      detail:
        `Existe 720 previa del ejercicio ${input.priorFiledYear} y hay transmisiones/extinciones extranjeras en el ejercicio. Revisa si procede nueva presentación aunque no se observe incremento superior a ${redeclareIncreaseThreshold.toLocaleString("es-ES")} EUR por bloque.`,
      reasons: [`Eventos de transmisión/extinción extranjera detectados: ${foreignTransmissionEvents}.`]
    };
  }

  return {
    filingDecision: "do_not_file",
    priorFiledYear: input.priorFiledYear,
    initialThreshold,
    redeclareIncreaseThreshold,
    currentBlockTotals,
    previousBlockTotals,
    thresholdBlocks,
    increasedBlocks,
    extinguishmentBlocks,
    foreignTransmissionEvents,
    detail:
      `Existe 720 previa del ejercicio ${input.priorFiledYear} y ningún bloque aumenta más de ${redeclareIncreaseThreshold.toLocaleString("es-ES")} EUR ni queda extinguido a nivel de bloque.`,
    reasons: ["No se detecta obligación recurrente de nueva presentación con el canónico consolidado."]
  };
}
