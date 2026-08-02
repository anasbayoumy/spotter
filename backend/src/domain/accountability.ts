import { DomainError } from "./core";

export type AccountabilityTier = 0 | 1 | 2 | 3 | 4;
export type AccountabilityOwner = "none" | "automation" | "coach";

export interface EngagementInputs {
  readonly plannedDue14d: number;
  readonly completedDue14d: number;
  readonly missedDue7d: number;
  readonly missedDue14d: number;
  readonly currentCheckInLatencyHours: number | null;
  readonly baselineCheckInLatencyHours: number | null;
  readonly baselineCheckInCount: number;
  readonly daysSinceOpen: number | null;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function calculateAdherence(completed: number, planned: number): number | null {
  if (!nonNegativeInteger(completed) || !nonNegativeInteger(planned) || completed > planned) {
    throw new DomainError("invalid_value", "Invalid adherence counts");
  }
  return planned === 0 ? null : completed / planned;
}

export function calculateAccountabilityTier(inputs: EngagementInputs): AccountabilityTier {
  if (
    ![
      inputs.plannedDue14d,
      inputs.completedDue14d,
      inputs.missedDue7d,
      inputs.missedDue14d,
      inputs.baselineCheckInCount,
    ].every(nonNegativeInteger)
  ) {
    throw new DomainError("invalid_value", "Engagement counts must be non-negative integers");
  }
  if (
    (inputs.daysSinceOpen !== null && !nonNegativeInteger(inputs.daysSinceOpen)) ||
    (inputs.currentCheckInLatencyHours !== null &&
      (!Number.isFinite(inputs.currentCheckInLatencyHours) ||
        inputs.currentCheckInLatencyHours < 0)) ||
    (inputs.baselineCheckInLatencyHours !== null &&
      (!Number.isFinite(inputs.baselineCheckInLatencyHours) ||
        inputs.baselineCheckInLatencyHours <= 0))
  ) {
    throw new DomainError("invalid_value", "Invalid engagement recency or latency");
  }
  const adherence14d = calculateAdherence(inputs.completedDue14d, inputs.plannedDue14d) ?? 1;
  const daysSinceOpen = inputs.daysSinceOpen ?? 0;
  if (daysSinceOpen >= 21) return 4;
  if (daysSinceOpen >= 7 || (inputs.plannedDue14d >= 2 && adherence14d < 0.5)) return 3;
  const doubledLatency =
    inputs.baselineCheckInCount >= 2 &&
    inputs.currentCheckInLatencyHours !== null &&
    inputs.baselineCheckInLatencyHours !== null &&
    inputs.currentCheckInLatencyHours >= inputs.baselineCheckInLatencyHours * 2;
  if (inputs.missedDue14d >= 2 || doubledLatency) return 2;
  if (inputs.missedDue7d === 1) return 1;
  return 0;
}

export interface AccountabilityStateValue {
  readonly tier: AccountabilityTier;
  readonly owner: AccountabilityOwner;
  readonly automationPaused: boolean;
  readonly churnFlagged: boolean;
  readonly version: number;
}

export class AccountabilityState {
  readonly #value: AccountabilityStateValue;

  public constructor(value: AccountabilityStateValue) {
    if (
      !Number.isInteger(value.version) ||
      value.version < 1 ||
      (value.tier >= 3 && (value.owner !== "coach" || !value.automationPaused)) ||
      (value.tier === 4 && !value.churnFlagged)
    ) {
      throw new DomainError("invalid_value", "Invalid accountability state");
    }
    this.#value = { ...value };
    Object.freeze(this);
  }

  public snapshot(): AccountabilityStateValue {
    return { ...this.#value };
  }

  public transition(computedTier: AccountabilityTier): AccountabilityState {
    if (computedTier === this.#value.tier) return this;
    if (this.#value.owner === "coach" && computedTier < this.#value.tier) return this;
    const owner: AccountabilityOwner =
      computedTier >= 3 ? "coach" : computedTier === 0 ? "none" : "automation";
    return new AccountabilityState({
      tier: computedTier,
      owner,
      automationPaused: computedTier >= 3,
      churnFlagged: computedTier === 4,
      version: this.#value.version + 1,
    });
  }

  public releaseByCoach(targetTier: 0 | 1 | 2, coachActionId: string): AccountabilityState {
    if (this.#value.owner !== "coach" || coachActionId.trim().length === 0) {
      throw new DomainError(
        "invalid_state_transition",
        "Coach-owned state requires a recorded coach release",
      );
    }
    const owner: AccountabilityOwner = targetTier === 0 ? "none" : "automation";
    return new AccountabilityState({
      tier: targetTier,
      owner,
      automationPaused: false,
      churnFlagged: false,
      version: this.#value.version + 1,
    });
  }
}

export const AUTOMATED_MESSAGE_WINDOW_MS = 48 * 60 * 60 * 1_000;

export function canSendAutomatedMessage(lastSentAt: Date | null, effectiveAt: Date): boolean {
  if (
    Number.isNaN(effectiveAt.valueOf()) ||
    (lastSentAt !== null && Number.isNaN(lastSentAt.valueOf()))
  ) {
    throw new DomainError("invalid_value", "Invalid message instant");
  }
  return (
    lastSentAt === null ||
    effectiveAt.valueOf() - lastSentAt.valueOf() >= AUTOMATED_MESSAGE_WINDOW_MS
  );
}
