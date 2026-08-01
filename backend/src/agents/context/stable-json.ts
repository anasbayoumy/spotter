import type { ContextRecord } from "./types.js";

type JsonValue = ContextRecord["content"];

function normalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => normalize(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(normalize(value));
}
