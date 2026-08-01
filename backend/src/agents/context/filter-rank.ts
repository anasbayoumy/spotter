import type { ContextEviction, ContextRecord, ContextSection } from "./types.js";

const millisecondsPerDay = 86_400_000;

export interface EligibleRecords {
  readonly records: readonly ContextRecord[];
  readonly evictions: readonly ContextEviction[];
}

function byCreatedAtThenId(left: ContextRecord, right: ContextRecord): number {
  const leftTime = left.createdAt === null ? 0 : new Date(left.createdAt).valueOf();
  const rightTime = right.createdAt === null ? 0 : new Date(right.createdAt).valueOf();
  return rightTime - leftTime || left.recordId.localeCompare(right.recordId);
}

export function filterCurrentRecords(
  records: readonly ContextRecord[],
  effectiveAt: string,
  sectionKind: ContextSection["kind"],
): EligibleRecords {
  const effectiveTime = new Date(effectiveAt).valueOf();
  const selected: ContextRecord[] = [];
  const evictions: ContextEviction[] = [];

  for (const record of records) {
    if (record.supersededBy !== null) {
      evictions.push({ recordId: record.recordId, sectionKind, reason: "superseded" });
      continue;
    }
    const startsAt =
      record.validFrom === null ? Number.NEGATIVE_INFINITY : new Date(record.validFrom).valueOf();
    const endsAt =
      record.validUntil === null ? Number.POSITIVE_INFINITY : new Date(record.validUntil).valueOf();
    if (startsAt > effectiveTime || effectiveTime >= endsAt) {
      evictions.push({
        recordId: record.recordId,
        sectionKind,
        reason: "not_active_at_effective_time",
      });
      continue;
    }
    selected.push(record);
  }

  return { records: selected.sort(byCreatedAtThenId), evictions };
}

export function rankEligibleNotes(
  records: readonly ContextRecord[],
  effectiveAt: string,
): readonly ContextRecord[] {
  const effectiveTime = new Date(effectiveAt).valueOf();
  return [...records].sort((left, right) => {
    const score = (record: ContextRecord): number => {
      const createdAt =
        record.createdAt === null ? effectiveTime : new Date(record.createdAt).valueOf();
      const ageDays = Math.max(0, (effectiveTime - createdAt) / millisecondsPerDay);
      return (record.similarity ?? 0.5) * Math.exp(-ageDays / 45);
    };
    return score(right) - score(left) || byCreatedAtThenId(left, right);
  });
}
