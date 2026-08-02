import { DomainError, EntityId, assertExpectedVersion } from "./core";

export type AdjustmentStatus = "draft" | "queued" | "approved" | "rejected" | "applied" | "stale";
export type AdjustmentOperation =
  | Readonly<{ type: "reduce_load"; exerciseId: string; percent: number }>
  | Readonly<{ type: "reduce_volume"; exerciseId: string; setsToRemove: number }>
  | Readonly<{
      type: "swap_exercise";
      exerciseId: string;
      replacementFamily: string;
      equivalenceId: string;
    }>;

export interface AdjustmentState {
  readonly id: string;
  readonly clientId: string;
  readonly baseProgrammeId: string;
  readonly sourceEventKey: string;
  readonly operations: readonly AdjustmentOperation[];
  readonly status: AdjustmentStatus;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly appliedProgrammeId: string | null;
  readonly version: number;
}

export function validateAdjustmentOperations(
  operations: readonly AdjustmentOperation[],
): readonly AdjustmentOperation[] {
  if (operations.length === 0 || operations.length > 100) {
    throw new DomainError(
      "unsupported_adjustment",
      "Adjustment requires one to one hundred operations",
    );
  }
  return operations.map((operation) => {
    new EntityId(operation.exerciseId);
    switch (operation.type) {
      case "reduce_load":
        if (
          !Number.isFinite(operation.percent) ||
          operation.percent <= 0 ||
          operation.percent > 100
        ) {
          throw new DomainError(
            "unsupported_adjustment",
            "Load reduction must be greater than zero and at most 100 percent",
          );
        }
        return { ...operation };
      case "reduce_volume":
        if (
          !Number.isInteger(operation.setsToRemove) ||
          operation.setsToRemove < 1 ||
          operation.setsToRemove > 20
        ) {
          throw new DomainError(
            "unsupported_adjustment",
            "Volume reduction must remove one to twenty sets",
          );
        }
        return { ...operation };
      case "swap_exercise":
        new EntityId(operation.equivalenceId);
        if (operation.replacementFamily.trim().length === 0) {
          throw new DomainError(
            "unsupported_adjustment",
            "A swap requires a documented replacement family",
          );
        }
        return { ...operation, replacementFamily: operation.replacementFamily.trim() };
    }
  });
}

export class Adjustment {
  readonly #state: AdjustmentState;

  public constructor(state: AdjustmentState) {
    new EntityId(state.id);
    new EntityId(state.clientId);
    new EntityId(state.baseProgrammeId);
    if (
      state.sourceEventKey.trim().length < 8 ||
      !Number.isInteger(state.version) ||
      state.version < 1
    ) {
      throw new DomainError("invalid_value", "Invalid adjustment event key or version");
    }
    const operations = validateAdjustmentOperations(state.operations);
    if (
      ["approved", "applied"].includes(state.status) &&
      (state.approvedBy === null || state.approvedAt === null)
    ) {
      throw new DomainError("invalid_value", "Approved adjustments require coach metadata");
    }
    if (state.status === "applied" && state.appliedProgrammeId === null) {
      throw new DomainError("invalid_value", "Applied adjustment requires its programme version");
    }
    this.#state = {
      ...state,
      sourceEventKey: state.sourceEventKey.trim(),
      operations,
      approvedAt: state.approvedAt === null ? null : new Date(state.approvedAt.valueOf()),
    };
    Object.freeze(this);
  }

  public snapshot(): AdjustmentState {
    return {
      ...this.#state,
      operations: validateAdjustmentOperations(this.#state.operations),
      approvedAt:
        this.#state.approvedAt === null ? null : new Date(this.#state.approvedAt.valueOf()),
    };
  }

  public queue(expectedVersion: number): Adjustment {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "draft") {
      throw new DomainError("invalid_state_transition", "Only a draft adjustment can be queued");
    }
    return this.with({ status: "queued", version: this.#state.version + 1 });
  }

  public approve(coachId: string, approvedAt: Date, expectedVersion: number): Adjustment {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "queued") {
      throw new DomainError("invalid_state_transition", "Only a queued adjustment can be approved");
    }
    new EntityId(coachId);
    return this.with({
      status: "approved",
      approvedBy: coachId,
      approvedAt,
      version: this.#state.version + 1,
    });
  }

  public reject(expectedVersion: number): Adjustment {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "draft" && this.#state.status !== "queued") {
      throw new DomainError(
        "invalid_state_transition",
        "Only a draft or queued adjustment can be rejected",
      );
    }
    return this.with({ status: "rejected", version: this.#state.version + 1 });
  }

  public markStale(expectedVersion: number): Adjustment {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "queued" && this.#state.status !== "approved") {
      throw new DomainError(
        "invalid_state_transition",
        "Only a pending adjustment can become stale",
      );
    }
    return this.with({ status: "stale", version: this.#state.version + 1 });
  }

  public apply(
    currentProgrammeId: string,
    newProgrammeId: string,
    expectedVersion: number,
  ): Adjustment {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "approved") {
      throw new DomainError(
        "invalid_state_transition",
        "Adjustment requires coach approval before application",
      );
    }
    if (currentProgrammeId !== this.#state.baseProgrammeId) {
      throw new DomainError("stale_adjustment", "Adjustment base programme is no longer current");
    }
    new EntityId(newProgrammeId);
    return this.with({
      status: "applied",
      appliedProgrammeId: newProgrammeId,
      version: this.#state.version + 1,
    });
  }

  private with(changes: Partial<AdjustmentState>): Adjustment {
    return new Adjustment({ ...this.#state, ...changes });
  }
}
