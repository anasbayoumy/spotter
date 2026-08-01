import type {
  Adjustment,
  ClientSummary,
  Programme,
  ProgrammeReview,
  ReviewBand,
} from "@spotter/contracts";

import { formatLabel } from "../../lib/format";

export interface QueueItem {
  readonly band: ReviewBand;
  readonly clientHandle: string;
  readonly clientId: string;
  readonly createdAt: string;
  readonly finding: string;
  readonly href: string;
  readonly id: string;
  readonly kind: "adjustment" | "programme";
  readonly title: string;
}

export type QueueGroups = Readonly<Record<ReviewBand, readonly QueueItem[]>>;

const bandOrder: Readonly<Record<ReviewBand, number>> = { blocked: 0, attention: 1, clear: 2 };

function programmeFinding(review: ProgrammeReview): string {
  const failedGate = review.gates.find((gate) => !gate.passed);
  if (failedGate !== undefined) return `${formatLabel(failedGate.name)}: ${failedGate.rationale}`;
  const weakJudge = [...review.judges].sort((left, right) => left.score - right.score)[0];
  if (weakJudge !== undefined && weakJudge.score < 4)
    return `${formatLabel(weakJudge.name)} scored ${String(weakJudge.score)}/5: ${weakJudge.rationale}`;
  return "All deterministic gates passed and required judge scores are clear.";
}

function adjustmentFinding(adjustment: Adjustment): string {
  const operation = adjustment.operations[0];
  const trigger = formatLabel(adjustment.trigger.type);
  return operation === undefined
    ? `${trigger} triggered coach review.`
    : `${trigger}: ${operation.rationale}`;
}

function clientHandle(clientId: string, clients: readonly ClientSummary[]): string {
  return clients.find((client) => client.id === clientId)?.handle ?? "Unknown synthetic client";
}

export function buildQueueItems(
  programmes: readonly Programme[],
  reviews: ReadonlyMap<string, ProgrammeReview>,
  adjustments: readonly Adjustment[],
  clients: readonly ClientSummary[],
): readonly QueueItem[] {
  const programmeItems = programmes.flatMap((programme): readonly QueueItem[] => {
    const review = reviews.get(programme.id);
    if (programme.reviewBand === null || review === undefined) return [];
    return [
      {
        band: programme.reviewBand,
        clientHandle: clientHandle(programme.clientId, clients),
        clientId: programme.clientId,
        createdAt: programme.createdAt,
        finding: programmeFinding(review),
        href: `/programmes/${programme.id}`,
        id: programme.id,
        kind: "programme",
        title: `Week ${String(programme.week)} programme · v${String(programme.version)}`,
      },
    ];
  });
  const adjustmentItems = adjustments.map(
    (adjustment): QueueItem => ({
      band: adjustment.reviewBand,
      clientHandle: clientHandle(adjustment.clientId, clients),
      clientId: adjustment.clientId,
      createdAt: adjustment.createdAt,
      finding: adjustmentFinding(adjustment),
      href: `/clients/${adjustment.clientId}`,
      id: adjustment.id,
      kind: "adjustment",
      title: `Adjustment · v${String(adjustment.version)}`,
    }),
  );
  return [...programmeItems, ...adjustmentItems].sort(
    (left, right) =>
      bandOrder[left.band] - bandOrder[right.band] ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function groupQueue(items: readonly QueueItem[]): QueueGroups {
  return {
    blocked: items.filter((item) => item.band === "blocked"),
    attention: items.filter((item) => item.band === "attention"),
    clear: items.filter((item) => item.band === "clear"),
  };
}
