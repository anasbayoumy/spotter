export interface TestClock {
  now(): Date;
}

export class FixedClock implements TestClock {
  constructor(private current: Date) {}

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.current);
  }
}

export class SequenceIdGenerator {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  next(): string {
    const value = this.values[this.index];
    if (value === undefined) throw new Error("The deterministic ID sequence is exhausted");
    this.index += 1;
    return value;
  }
}
