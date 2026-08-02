import { DomainError, EntityId, assertExpectedVersion } from "./core";

export type ProgrammeStatus = "draft" | "queued" | "published" | "rejected" | "superseded";
export type ReviewBand = "blocked" | "attention" | "clear";

export interface ProgrammeExercise {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly sets: number;
  readonly loadKg?: number | null;
  readonly rpe: number;
}

export interface ProgrammeDay {
  readonly dayIndex: number;
  readonly scheduledDate: string;
  readonly exercises: readonly ProgrammeExercise[];
}

export interface ProgrammePayload {
  readonly summary: string;
  readonly days: readonly ProgrammeDay[];
}

export interface ProgrammeState {
  readonly id: string;
  readonly clientId: string;
  readonly slotKey: string;
  readonly payload: ProgrammePayload;
  readonly status: ProgrammeStatus;
  readonly reviewBand: ReviewBand | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly supersededBy: string | null;
  readonly sourceProgrammeId: string | null;
  readonly version: number;
}

function copyPayload(payload: ProgrammePayload): ProgrammePayload {
  const summary = payload.summary.trim();
  if (summary.length === 0 || payload.days.length === 0) {
    throw new DomainError("invalid_value", "Programme requires a summary and one to fourteen days");
  }
  const indexes = new Set<number>();
  const dates = new Set<string>();
  const days = payload.days.map((day) => {
    if (
      !Number.isInteger(day.dayIndex) ||
      day.dayIndex < 1 ||
      day.dayIndex > 14 ||
      indexes.has(day.dayIndex) ||
      dates.has(day.scheduledDate)
    ) {
      throw new DomainError(
        "invalid_value",
        "Programme days require unique valid indexes and dates",
      );
    }
    indexes.add(day.dayIndex);
    dates.add(day.scheduledDate);
    if (day.exercises.length === 0 || day.exercises.length > 20) {
      throw new DomainError("invalid_value", "Programme days require one to twenty exercises");
    }
    return {
      dayIndex: day.dayIndex,
      scheduledDate: day.scheduledDate,
      exercises: day.exercises.map((exercise) => {
        if (
          exercise.name.trim().length === 0 ||
          exercise.family.trim().length === 0 ||
          !Number.isInteger(exercise.sets) ||
          exercise.sets < 1 ||
          exercise.sets > 20 ||
          (exercise.loadKg !== undefined &&
            exercise.loadKg !== null &&
            (!Number.isFinite(exercise.loadKg) ||
              exercise.loadKg < 0 ||
              exercise.loadKg > 2_000)) ||
          exercise.rpe < 1 ||
          exercise.rpe > 10
        ) {
          throw new DomainError("invalid_value", "Invalid prescribed exercise");
        }
        return { ...exercise, name: exercise.name.trim(), family: exercise.family.trim() };
      }),
    };
  });
  return { summary, days };
}

function copyState(state: ProgrammeState): ProgrammeState {
  new EntityId(state.id);
  new EntityId(state.clientId);
  if (!Number.isInteger(state.version) || state.version < 1 || state.slotKey.trim().length === 0) {
    throw new DomainError("invalid_value", "Invalid programme identity or version");
  }
  if (state.status === "published" && (state.approvedBy === null || state.approvedAt === null)) {
    throw new DomainError("invalid_value", "Published programmes require coach approval");
  }
  if (state.status === "superseded" && state.supersededBy === null) {
    throw new DomainError("invalid_value", "Superseded programmes require a successor");
  }
  return {
    ...state,
    slotKey: state.slotKey.trim(),
    payload: copyPayload(state.payload),
    approvedAt: state.approvedAt === null ? null : new Date(state.approvedAt.valueOf()),
  };
}

export class Programme {
  readonly #state: ProgrammeState;

  public constructor(state: ProgrammeState) {
    this.#state = copyState(state);
    Object.freeze(this);
  }

  public snapshot(): ProgrammeState {
    return copyState(this.#state);
  }

  public queue(reviewBand: ReviewBand, expectedVersion: number): Programme {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "draft") {
      throw new DomainError("invalid_state_transition", "Only a draft can be queued");
    }
    return this.with({ status: "queued", reviewBand, version: this.#state.version + 1 });
  }

  public revise(newId: string, payload: ProgrammePayload, expectedVersion: number): Programme {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status === "rejected" || this.#state.status === "superseded") {
      throw new DomainError(
        "invalid_state_transition",
        "Rejected or superseded programmes cannot be edited",
      );
    }
    return new Programme({
      ...this.#state,
      id: newId,
      payload,
      status: "draft",
      reviewBand: null,
      approvedBy: null,
      approvedAt: null,
      supersededBy: null,
      sourceProgrammeId: this.#state.id,
      version: this.#state.version + 1,
    });
  }

  public approve(coachId: string, approvedAt: Date, expectedVersion: number): Programme {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "queued") {
      throw new DomainError("invalid_state_transition", "Only a queued programme can be approved");
    }
    if (this.#state.reviewBand === "blocked") {
      throw new DomainError("blocked_requires_override", "Blocked programmes require an override");
    }
    new EntityId(coachId);
    return this.with({
      status: "published",
      approvedBy: coachId,
      approvedAt,
      version: this.#state.version + 1,
    });
  }

  public override(
    coachId: string,
    approvedAt: Date,
    reason: string,
    expectedVersion: number,
  ): Programme {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "queued" || this.#state.reviewBand !== "blocked") {
      throw new DomainError(
        "invalid_state_transition",
        "Only a queued blocked programme can be overridden",
      );
    }
    if (reason.trim().length === 0) {
      throw new DomainError("override_reason_required", "Override requires a written reason");
    }
    new EntityId(coachId);
    return this.with({
      status: "published",
      approvedBy: coachId,
      approvedAt,
      version: this.#state.version + 1,
    });
  }

  public reject(expectedVersion: number): Programme {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "draft" && this.#state.status !== "queued") {
      throw new DomainError(
        "invalid_state_transition",
        "Only draft or queued programmes can be rejected",
      );
    }
    return this.with({ status: "rejected", version: this.#state.version + 1 });
  }

  public supersede(successorId: string, expectedVersion: number): Programme {
    assertExpectedVersion(this.#state.version, expectedVersion);
    if (this.#state.status !== "published") {
      throw new DomainError(
        "invalid_state_transition",
        "Only a published programme can be superseded",
      );
    }
    new EntityId(successorId);
    return this.with({
      status: "superseded",
      supersededBy: successorId,
      version: this.#state.version + 1,
    });
  }

  private with(changes: Partial<ProgrammeState>): Programme {
    return new Programme({ ...this.#state, ...changes });
  }
}
