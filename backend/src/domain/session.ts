import { DomainError, EntityId, assertExpectedVersion } from "./core";

export interface ActualSet {
  readonly setIndex: number;
  readonly reps: number;
  readonly loadKg: number | null;
  readonly completed: boolean;
}

export interface ActualExercise {
  readonly exerciseId: string;
  readonly sets: readonly ActualSet[];
}

export interface SessionState {
  readonly id: string;
  readonly clientId: string;
  readonly programmeId: string;
  readonly plannedSetCount: number;
  readonly actual: readonly ActualExercise[] | null;
  readonly performedAt: Date | null;
  readonly rpe: number | null;
  readonly version: number;
}

function validateActual(actual: readonly ActualExercise[]): readonly ActualExercise[] {
  if (actual.length === 0 || actual.length > 20) {
    throw new DomainError("invalid_value", "Actual work requires one to twenty exercises");
  }
  return actual.map((exercise) => {
    new EntityId(exercise.exerciseId);
    if (
      exercise.sets.length > 20 ||
      new Set(exercise.sets.map((set) => set.setIndex)).size !== exercise.sets.length
    ) {
      throw new DomainError(
        "invalid_value",
        "Actual sets contain duplicate indexes or exceed the limit",
      );
    }
    return {
      exerciseId: exercise.exerciseId,
      sets: exercise.sets.map((set) => {
        if (
          !Number.isInteger(set.setIndex) ||
          set.setIndex < 1 ||
          !Number.isInteger(set.reps) ||
          set.reps < 0 ||
          set.reps > 500 ||
          (set.loadKg !== null &&
            (!Number.isFinite(set.loadKg) || set.loadKg < 0 || set.loadKg > 2_000))
        ) {
          throw new DomainError("invalid_value", "Invalid actual set");
        }
        return { ...set };
      }),
    };
  });
}

export class TrainingSession {
  readonly #state: SessionState;

  public constructor(state: SessionState) {
    new EntityId(state.id);
    new EntityId(state.clientId);
    new EntityId(state.programmeId);
    if (
      !Number.isInteger(state.plannedSetCount) ||
      state.plannedSetCount < 1 ||
      !Number.isInteger(state.version) ||
      state.version < 1
    ) {
      throw new DomainError("invalid_value", "Invalid planned set count or session version");
    }
    if ((state.performedAt === null) !== (state.rpe === null)) {
      throw new DomainError("invalid_value", "Completion timestamp and RPE must be set together");
    }
    if (state.performedAt !== null && state.actual === null) {
      throw new DomainError("invalid_value", "Completed sessions require actual work");
    }
    this.#state = {
      ...state,
      actual: state.actual === null ? null : validateActual(state.actual),
      performedAt: state.performedAt === null ? null : new Date(state.performedAt.valueOf()),
    };
    Object.freeze(this);
  }

  public snapshot(): SessionState {
    return {
      ...this.#state,
      actual: this.#state.actual === null ? null : validateActual(this.#state.actual),
      performedAt:
        this.#state.performedAt === null ? null : new Date(this.#state.performedAt.valueOf()),
    };
  }

  public log(actual: readonly ActualExercise[], expectedVersion: number): TrainingSession {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.performedAt !== null) {
      throw new DomainError("invalid_state_transition", "A completed session cannot be edited");
    }
    return new TrainingSession({
      ...this.#state,
      actual: validateActual(actual),
      version: this.#state.version + 1,
    });
  }

  public complete(rpe: number, performedAt: Date, expectedVersion: number): TrainingSession {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.performedAt !== null || this.#state.actual === null) {
      throw new DomainError(
        "invalid_state_transition",
        "Session must have uncompleted actual work before completion",
      );
    }
    if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10 || Number.isNaN(performedAt.valueOf())) {
      throw new DomainError("invalid_value", "Invalid RPE or completion time");
    }
    return new TrainingSession({
      ...this.#state,
      rpe,
      performedAt,
      version: this.#state.version + 1,
    });
  }

  public completionRatio(): number {
    if (this.#state.actual === null) return 0;
    const completed = this.#state.actual.reduce(
      (sum, exercise) => sum + exercise.sets.filter((set) => set.completed).length,
      0,
    );
    return Math.min(1, completed / this.#state.plannedSetCount);
  }
}

export class ReadinessCheckIn {
  public readonly readiness: number;
  public readonly body: string;
  public readonly respondedAt: Date;

  public constructor(readiness: number, body: string, respondedAt: Date) {
    const normalized = body.trim();
    if (
      !Number.isInteger(readiness) ||
      readiness < 1 ||
      readiness > 5 ||
      normalized.length === 0 ||
      normalized.length > 4_000 ||
      Number.isNaN(respondedAt.valueOf())
    ) {
      throw new DomainError("invalid_value", "Invalid readiness check-in");
    }
    this.readiness = readiness;
    this.body = normalized;
    this.respondedAt = new Date(respondedAt.valueOf());
    Object.freeze(this);
  }
}

export type AdjustmentTriggerReason = "low_readiness" | "high_rpe" | "low_completion";

export function adjustmentTriggers(
  checkIn: ReadinessCheckIn | null,
  session: TrainingSession | null,
): readonly AdjustmentTriggerReason[] {
  const triggers: AdjustmentTriggerReason[] = [];
  if (checkIn !== null && checkIn.readiness <= 2) triggers.push("low_readiness");
  if (session !== null) {
    const state = session.snapshot();
    if (state.performedAt !== null) {
      if (state.rpe !== null && state.rpe >= 9) triggers.push("high_rpe");
      if (session.completionRatio() <= 0.7) triggers.push("low_completion");
    }
  }
  return triggers;
}
