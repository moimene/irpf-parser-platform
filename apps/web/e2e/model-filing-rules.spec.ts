import { expect, test } from "@playwright/test";
import {
  assessModel714Requirement,
  assessModel720Requirement,
  normalizeForeignBlockTotals
} from "../lib/model-filing-rules";

test.describe("Reglas declarativas 714/720", () => {
  test("marca obligación fuerte de 714 cuando el patrimonio bruto supera 2M", async () => {
    const assessment = assessModel714Requirement({
      totalValuation: 2_350_000
    });

    expect(assessment.filingDecision).toBe("file");
    expect(assessment.detail).toContain("2.000.000");
  });

  test("evita nueva 720 si ya existe declaración previa y no hay incremento superior a 20k", async () => {
    const assessment = assessModel720Requirement({
      metrics: {
        foreignBlockTotals: normalizeForeignBlockTotals({
          accounts: 61_500,
          securities: 0,
          insurance_real_estate: 0,
          other: 0
        }),
        thresholdReachedBlocks: ["accounts"]
      },
      priorFiledYear: 2024,
      previousBlockTotals: {
        accounts: 50_000,
        securities: 0,
        insurance_real_estate: 0,
        other: 0
      },
      foreignTransmissionEvents: 0
    });

    expect(assessment.filingDecision).toBe("do_not_file");
    expect(assessment.increasedBlocks).toHaveLength(0);
  });

  test("reactiva 720 si un bloque aumenta más de 20k frente a la última declaración", async () => {
    const assessment = assessModel720Requirement({
      metrics: {
        foreignBlockTotals: normalizeForeignBlockTotals({
          accounts: 72_500,
          securities: 0,
          insurance_real_estate: 0,
          other: 0
        }),
        thresholdReachedBlocks: ["accounts"]
      },
      priorFiledYear: 2024,
      previousBlockTotals: {
        accounts: 50_000,
        securities: 0,
        insurance_real_estate: 0,
        other: 0
      },
      foreignTransmissionEvents: 0
    });

    expect(assessment.filingDecision).toBe("file");
    expect(assessment.increasedBlocks).toEqual(["accounts"]);
  });
});
