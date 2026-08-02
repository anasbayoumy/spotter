import { describe, expect, it } from "vitest";

import {
  documentedExerciseEquivalences,
  validateDocumentedExerciseSwap,
} from "./exercise-equivalences.js";

describe("documented exercise equivalences", () => {
  it("accepts only the exact code-owned source and replacement tuple", () => {
    expect(
      validateDocumentedExerciseSwap({
        equivalenceId: "20000000-0000-4000-8000-000000000001",
        replacementFamily: "horizontal_pull",
        replacementName: "Seated cable row",
        sourceFamily: "horizontal_pull",
      }),
    ).toEqual(documentedExerciseEquivalences[0]);
    expect(Object.isFrozen(documentedExerciseEquivalences)).toBe(true);
    expect(Object.isFrozen(documentedExerciseEquivalences[0])).toBe(true);
  });

  it.each([
    [
      {
        equivalenceId: "20000000-0000-4000-8000-000000009999",
        replacementFamily: "horizontal_pull",
        replacementName: "Seated cable row",
        sourceFamily: "horizontal_pull",
      },
      "unknown exercise equivalence",
    ],
    [
      {
        equivalenceId: "20000000-0000-4000-8000-000000000001",
        replacementFamily: "horizontal_pull",
        replacementName: "Seated cable row",
        sourceFamily: "squat",
      },
      "source movement family",
    ],
    [
      {
        equivalenceId: "20000000-0000-4000-8000-000000000001",
        replacementFamily: "horizontal_pull",
        replacementName: "Invented replacement",
        sourceFamily: "horizontal_pull",
      },
      "replacement exercise name",
    ],
    [
      {
        equivalenceId: "20000000-0000-4000-8000-000000000001",
        replacementFamily: "squat",
        replacementName: "Seated cable row",
        sourceFamily: "horizontal_pull",
      },
      "replacement movement family",
    ],
  ])("rejects an unproven equivalence tuple", (input, message) => {
    expect(() => validateDocumentedExerciseSwap(input)).toThrow(message);
  });
});
