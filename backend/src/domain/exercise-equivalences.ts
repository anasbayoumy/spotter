import { DomainError } from "./core";

export interface DocumentedExerciseEquivalence {
  readonly id: string;
  readonly sourceFamily: string;
  readonly replacementFamily: string;
  readonly replacementName: string;
}

export const documentedExerciseEquivalences: readonly DocumentedExerciseEquivalence[] =
  Object.freeze([
    Object.freeze({
      id: "20000000-0000-4000-8000-000000000001",
      replacementFamily: "horizontal_pull",
      replacementName: "Seated cable row",
      sourceFamily: "horizontal_pull",
    }),
    Object.freeze({
      id: "20000000-0000-4000-8000-000000000002",
      replacementFamily: "squat",
      replacementName: "Goblet squat",
      sourceFamily: "squat",
    }),
  ]);

export function validateDocumentedExerciseSwap(input: {
  readonly equivalenceId: string;
  readonly sourceFamily: string;
  readonly replacementFamily: string;
  readonly replacementName: string;
}): DocumentedExerciseEquivalence {
  const equivalence = documentedExerciseEquivalences.find(
    (candidate) => candidate.id === input.equivalenceId,
  );
  if (equivalence === undefined) {
    throw new DomainError(
      "unsupported_adjustment",
      "Adjustment references an unknown exercise equivalence.",
    );
  }
  if (equivalence.sourceFamily !== input.sourceFamily) {
    throw new DomainError(
      "unsupported_adjustment",
      "Adjustment equivalence does not match the source movement family.",
    );
  }
  if (equivalence.replacementName !== input.replacementName) {
    throw new DomainError(
      "unsupported_adjustment",
      "Adjustment equivalence does not match the replacement exercise name.",
    );
  }
  if (equivalence.replacementFamily !== input.replacementFamily) {
    throw new DomainError(
      "unsupported_adjustment",
      "Adjustment equivalence does not match the replacement movement family.",
    );
  }
  return equivalence;
}
