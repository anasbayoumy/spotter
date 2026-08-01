export interface TokenEstimator {
  estimate(text: string): number;
}

export class Utf8TokenEstimator implements TokenEstimator {
  readonly #encoder = new TextEncoder();

  public estimate(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(this.#encoder.encode(text).byteLength / 4);
  }
}
