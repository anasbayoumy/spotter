import { describe, expect, it } from "vitest";

import { documentedExerciseEquivalences } from "../../domain/exercise-equivalences.js";
import { PromptRegistry } from "./registry.js";

describe("prompt registry", () => {
  it("renders only exact code-owned exercise equivalences into adjustment generation", () => {
    const prompt = new PromptRegistry().get("adjustment");
    for (const equivalence of documentedExerciseEquivalences) {
      expect(prompt.system).toContain(
        `${equivalence.id} | source=${equivalence.sourceFamily} | replacement=${equivalence.replacementName} | family=${equivalence.replacementFamily}`,
      );
    }
    const renderedEquivalenceIds = [
      ...prompt.system.matchAll(/2\d{7}-\d{4}-4\d{3}-8\d{3}-\d{12}/gu),
    ].map((match) => match[0]);
    expect(renderedEquivalenceIds).toEqual(
      documentedExerciseEquivalences.map((equivalence) => equivalence.id),
    );
    expect(prompt.system).toContain("never invent or alter an equivalence");
  });

  it("keeps non-adjustment prompts free of the swap catalogue", () => {
    const registry = new PromptRegistry();
    for (const intent of ["programme", "accountability"] as const) {
      const prompt = registry.get(intent);
      expect(prompt.system).not.toContain(documentedExerciseEquivalences[0]?.id);
      expect(prompt.version).toMatch(/^sha256:[a-f0-9]{64}$/u);
    }
  });
});
