import { DomainError } from "./core";

function copyDate(value: Date): Date {
  const copy = new Date(value.valueOf());
  if (Number.isNaN(copy.valueOf())) {
    throw new DomainError("invalid_value", "Invalid instant");
  }
  return copy;
}

export class TemporalWindow {
  readonly #validFrom: Date;
  readonly #validUntil: Date | null;

  public constructor(validFrom: Date, validUntil: Date | null) {
    this.#validFrom = copyDate(validFrom);
    this.#validUntil = validUntil === null ? null : copyDate(validUntil);
    if (this.#validUntil !== null && this.#validUntil.valueOf() <= this.#validFrom.valueOf()) {
      throw new DomainError("invalid_value", "validUntil must be after validFrom");
    }
    Object.freeze(this);
  }

  public get validFrom(): Date {
    return copyDate(this.#validFrom);
  }

  public get validUntil(): Date | null {
    return this.#validUntil === null ? null : copyDate(this.#validUntil);
  }

  public isActiveAt(effectiveAt: Date): boolean {
    const instant = copyDate(effectiveAt).valueOf();
    return (
      this.#validFrom.valueOf() <= instant &&
      (this.#validUntil === null || instant < this.#validUntil.valueOf())
    );
  }
}

export interface TemporalRecord {
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly supersededBy: string | null;
}

export function isCurrentAt(record: TemporalRecord, effectiveAt: Date): boolean {
  return (
    record.supersededBy === null &&
    new TemporalWindow(record.validFrom, record.validUntil).isActiveAt(effectiveAt)
  );
}

export function selectCurrentAt<T extends TemporalRecord>(
  records: readonly T[],
  effectiveAt: Date,
): readonly T[] {
  return records.filter((record) => isCurrentAt(record, effectiveAt));
}
