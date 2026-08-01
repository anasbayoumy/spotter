"use client";

import {
  adjustmentSchema,
  clientSummarySchema,
  programmeReviewSchema,
  programmeSchema,
  type ProgrammeReview,
  type ReviewBand,
} from "@spotter/contracts";
import { ChevronRight, Clock3, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

import { BandBadge } from "../../components/ui/band-badge";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/states";
import { PageHeader } from "../../components/ui/page-header";
import { requestApi, type ApiResult } from "../../lib/api/client";
import { useResource } from "../../lib/api/use-resource";
import { formatDateTime, formatLabel } from "../../lib/format";
import { buildQueueItems, groupQueue, type QueueGroups, type QueueItem } from "./queue-model";

const programmeListSchema = z.array(programmeSchema);
const adjustmentListSchema = z.array(adjustmentSchema);
const clientListSchema = z.array(clientSummarySchema);
const groupMeta: Readonly<
  Record<ReviewBand, { readonly description: string; readonly title: string }>
> = {
  blocked: {
    description: "A deterministic safety finding prevents standard approval.",
    title: "Blocked",
  },
  attention: {
    description: "Valid proposals where judgement or context needs a closer look.",
    title: "Needs attention",
  },
  clear: {
    description: "All required checks passed; still requires coach approval.",
    title: "Clear",
  },
};

async function loadQueue(signal: AbortSignal): Promise<ApiResult<QueueGroups>> {
  const [programmes, adjustments, clients] = await Promise.all([
    requestApi("/api/v1/programmes?status=queued&limit=100", programmeListSchema, { signal }),
    requestApi("/api/v1/adjustments?status=queued&limit=100", adjustmentListSchema, { signal }),
    requestApi("/api/v1/clients?status=active&limit=100", clientListSchema, { signal }),
  ]);
  const detailEntries = await Promise.all(
    programmes.data.map(async (programme): Promise<readonly [string, ProgrammeReview]> => {
      const detail = await requestApi(`/api/v1/programmes/${programme.id}`, programmeReviewSchema, {
        signal,
      });
      return [programme.id, detail.data];
    }),
  );
  const items = buildQueueItems(
    programmes.data,
    new Map(detailEntries),
    adjustments.data,
    clients.data,
  );
  return { data: groupQueue(items), meta: programmes.meta };
}

function QueueRow({ item }: { readonly item: QueueItem }): React.JSX.Element {
  return (
    <li className="queue-row">
      <div className={`queue-row__marker queue-row__marker--${item.band}`} />
      <div className="queue-row__main">
        <div className="queue-row__topline">
          <BandBadge band={item.band} />
          <span className="queue-row__kind">{formatLabel(item.kind)}</span>
        </div>
        <Link className="queue-row__title" href={item.href}>
          {item.title}
        </Link>
        <p className="queue-row__finding">{item.finding}</p>
        <div className="queue-row__meta">
          <Link className="text-link" href={`/clients/${item.clientId}`}>
            {item.clientHandle}
          </Link>
          <span>
            <Clock3 aria-hidden="true" size={13} /> Queued {formatDateTime(item.createdAt)}
          </span>
          <code>{item.id.slice(0, 8)}</code>
        </div>
      </div>
      <Link
        aria-label={`Review ${item.title} for ${item.clientHandle}`}
        className="queue-row__open"
        href={item.href}
      >
        <ChevronRight aria-hidden="true" size={18} />
      </Link>
    </li>
  );
}

function QueueGroup({
  band,
  items,
}: {
  readonly band: ReviewBand;
  readonly items: readonly QueueItem[];
}): React.JSX.Element {
  const heading = (
    <div className="queue-group__heading">
      <div>
        <h2>{groupMeta[band].title}</h2>
        <p>{groupMeta[band].description}</p>
      </div>
      <span aria-label={`${String(items.length)} items`} className="queue-count">
        {items.length}
      </span>
    </div>
  );
  const list =
    items.length === 0 ? (
      <p className="queue-group__empty">
        No {groupMeta[band].title.toLowerCase()} work is waiting.
      </p>
    ) : (
      <ul className="queue-list">
        {items.map((item) => (
          <QueueRow item={item} key={`${item.kind}:${item.id}`} />
        ))}
      </ul>
    );
  return band === "clear" ? (
    <details className={`queue-group queue-group--${band}`}>
      <summary>{heading}</summary>
      {list}
    </details>
  ) : (
    <section className={`queue-group queue-group--${band}`}>
      {heading}
      {list}
    </section>
  );
}

export function ReviewQueuePage(): React.JSX.Element {
  const resource = useResource("review-queue", loadQueue);
  const total =
    resource.data === null
      ? 0
      : resource.data.blocked.length + resource.data.attention.length + resource.data.clear.length;
  return (
    <>
      <PageHeader
        actions={
          <span className="queue-total">
            <SlidersHorizontal aria-hidden="true" size={15} /> {total} actionable
          </span>
        }
        description="Risk-ordered proposals waiting for a human decision. Safety findings remain visible before any client-facing change."
        eyebrow="Coach workspace"
        title="Review queue"
      />
      {resource.loading ? <LoadingState label="Loading the review queue" /> : null}
      {!resource.loading && resource.error !== null ? (
        <ErrorState error={resource.error} onRetry={resource.reload} />
      ) : null}
      {!resource.loading && resource.error === null && resource.data !== null && total === 0 ? (
        <EmptyState
          action={
            <Link
              className="button button--secondary"
              href="/clients/00000000-0000-0000-0000-000000000101"
            >
              Open client c_001
            </Link>
          }
          body="There are no queued programmes or adjustments. You can inspect a synthetic client or generate the next weekly proposal."
          title="Nothing needs review"
        />
      ) : null}
      {!resource.loading && resource.error === null && resource.data !== null && total > 0 ? (
        <div className="queue-groups">
          <QueueGroup band="blocked" items={resource.data.blocked} />
          <QueueGroup band="attention" items={resource.data.attention} />
          <QueueGroup band="clear" items={resource.data.clear} />
        </div>
      ) : null}
    </>
  );
}
