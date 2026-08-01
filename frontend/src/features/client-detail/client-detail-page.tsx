"use client";

import {
  accountabilityDetailSchema,
  clientDetailSchema,
  generateProgrammeRequestSchema,
  programmeReviewSchema,
  runAccountabilityRequestSchema,
  type ClientDetail,
  type ProgrammeReview,
} from "@spotter/contracts";
import {
  Activity,
  CalendarDays,
  CircleCheck,
  Dumbbell,
  MessageSquareText,
  Play,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { z } from "zod";

import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { DefinitionList } from "../../components/ui/definition-list";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState, ErrorState, InlineStatus, LoadingState } from "../../components/ui/states";
import {
  ApiClientError,
  createIdempotencyKey,
  requestApi,
  toApiClientError,
  type ApiResult,
} from "../../lib/api/client";
import { useResource } from "../../lib/api/use-resource";
import {
  formatDate,
  formatDateTime,
  formatLabel,
  formatPercent,
  nextMonday,
} from "../../lib/format";

interface ActionState<T> {
  readonly busy: boolean;
  readonly error: ApiClientError | null;
  readonly result: T | null;
}

const emptyActionState = { busy: false, error: null, result: null } as const;
type AccountabilityDetail = z.infer<typeof accountabilityDetailSchema>;

async function loadClient(clientId: string, signal: AbortSignal): Promise<ApiResult<ClientDetail>> {
  return requestApi(`/api/v1/clients/${clientId}`, clientDetailSchema, { signal });
}

function ClientOverview({ detail }: { readonly detail: ClientDetail }): React.JSX.Element {
  const { client } = detail;
  return (
    <Card>
      <div className="card__header">
        <h2>Coaching profile</h2>
        <span className="status-badge">{client.status}</span>
      </div>
      <div className="card__body">
        <DefinitionList
          items={[
            { label: "Primary goal", value: client.goals.primary },
            {
              label: "Target date",
              value: client.goals.targetDate ?? "Not set",
            },
            {
              label: "Schedule",
              value: `${String(client.profile.sessionsPerWeek)} sessions / week`,
            },
            { label: "Training age", value: `${String(client.profile.trainingAgeMonths)} months` },
            { label: "Age band", value: formatLabel(client.profile.ageBand) },
            { label: "Timezone", value: client.timezone },
          ]}
        />
        <hr className="divider" />
        <p className="field__label">Available equipment</p>
        {client.profile.equipment.length === 0 ? (
          <p className="muted caption">No equipment has been recorded.</p>
        ) : (
          <ul className="pill-list">
            {client.profile.equipment.map((item) => (
              <li className="pill" key={item}>
                {formatLabel(item)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Constraints({ detail }: { readonly detail: ClientDetail }): React.JSX.Element {
  return (
    <Card>
      <div className="card__header">
        <h2>Active constraints</h2>
        <ShieldAlert aria-hidden="true" className="muted" size={18} />
      </div>
      <div className="card__body">
        {detail.activeConstraints.length === 0 ? (
          <p className="muted caption">No active constraints at the current effective time.</p>
        ) : (
          <ul className="constraint-list">
            {detail.activeConstraints.map((constraint) => (
              <li key={constraint.id}>
                <div>
                  <strong>{formatLabel(constraint.kind)}</strong>
                  <span className={`severity severity--${constraint.severity}`}>
                    {constraint.severity}
                  </span>
                </div>
                <p>{constraint.detail.note ?? "No additional note recorded."}</p>
                <small>
                  Effective {formatDateTime(constraint.validFrom)} · until{" "}
                  {constraint.validUntil === null
                    ? "further notice"
                    : formatDateTime(constraint.validUntil)}
                </small>
                {constraint.detail.forbids.length === 0 ? null : (
                  <p className="constraint-list__rule">
                    Excludes: {constraint.detail.forbids.map(formatLabel).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ProgrammeCard({ detail }: { readonly detail: ClientDetail }): React.JSX.Element {
  const programme = detail.currentProgramme;
  return (
    <Card>
      <div className="card__header">
        <h2>Current published programme</h2>
        <Dumbbell aria-hidden="true" className="muted" size={18} />
      </div>
      <div className="card__body">
        {programme === null ? (
          <p className="muted caption">
            No published programme is currently visible to this client.
          </p>
        ) : (
          <div className="stack stack--sm">
            <div className="programme-summary-line">
              <strong>{programme.payload.summary}</strong>
              <span className="status-badge">v{programme.version}</span>
            </div>
            <p className="muted caption">
              Mesocycle {programme.mesocycle} · week {programme.week} ·{" "}
              {programme.payload.days.length} days
            </p>
            <Link className="text-link" href={`/programmes/${programme.id}`}>
              Inspect programme evidence →
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}

function ActivityHistory({ detail }: { readonly detail: ClientDetail }): React.JSX.Element {
  return (
    <Card>
      <div className="card__header">
        <h2>Recent sessions</h2>
        <CalendarDays aria-hidden="true" className="muted" size={18} />
      </div>
      <div className="card__body">
        {detail.sessions.length === 0 ? (
          <p className="muted caption">No due or completed sessions are available.</p>
        ) : (
          <ul className="timeline-list">
            {detail.sessions.map((session) => (
              <li key={session.id}>
                <span className={`timeline-list__dot timeline-list__dot--${session.status}`} />
                <div>
                  <strong>{formatDate(session.scheduledFor)}</strong>
                  <p>
                    {formatLabel(session.status)} · {session.planned.length} planned exercises
                    {session.rpe === null ? "" : ` · RPE ${String(session.rpe)}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Signals({ detail }: { readonly detail: ClientDetail }): React.JSX.Element {
  return (
    <Card>
      <div className="card__header">
        <h2>Adherence & check-ins</h2>
        <Activity aria-hidden="true" className="muted" size={18} />
      </div>
      <div className="card__body">
        <div className="mini-stats">
          <div>
            <span>7-day adherence</span>
            <strong>{formatPercent(detail.adherence7d)}</strong>
          </div>
          <div>
            <span>14-day adherence</span>
            <strong>{formatPercent(detail.adherence14d)}</strong>
          </div>
        </div>
        <hr className="divider" />
        {detail.checkIns.length === 0 ? (
          <p className="muted caption">No recent check-ins are available.</p>
        ) : (
          <ul className="compact-list">
            {detail.checkIns.map((checkIn) => (
              <li key={checkIn.id}>
                <div>
                  <strong>Readiness {checkIn.readiness}/5</strong>
                  <span>{formatDateTime(checkIn.respondedAt)}</span>
                </div>
                <p>{checkIn.body}</p>
                {checkIn.requiresHumanEscalation ? (
                  <span className="severity severity--hard">Human review required</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Messages({ detail }: { readonly detail: ClientDetail }): React.JSX.Element {
  return (
    <Card>
      <div className="card__header">
        <h2>In-app messages</h2>
        <MessageSquareText aria-hidden="true" className="muted" size={18} />
      </div>
      <div className="card__body">
        {detail.messages.length === 0 ? (
          <p className="muted caption">No in-app message history is available.</p>
        ) : (
          <ul className="compact-list">
            {detail.messages.map((message) => (
              <li key={message.id}>
                <div>
                  <strong>
                    Tier {message.tier} · {formatLabel(message.status)}
                  </strong>
                  <span>{formatDateTime(message.createdAt)}</span>
                </div>
                <p>{message.body}</p>
                {message.suppressionReason === null ? null : (
                  <small>Suppressed: {message.suppressionReason}</small>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function ClientDetailPage({ clientId }: { readonly clientId: string }): React.JSX.Element {
  const resource = useResource(`client:${clientId}`, (signal) => loadClient(clientId, signal));
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [generation, setGeneration] = useState<ActionState<ProgrammeReview>>(emptyActionState);
  const [accountability, setAccountability] =
    useState<ActionState<AccountabilityDetail>>(emptyActionState);
  const generationKey = useRef<string | null>(null);
  const accountabilityKey = useRef<string | null>(null);

  async function generateProgramme(): Promise<void> {
    const parsed = generateProgrammeRequestSchema.safeParse({
      clientId,
      targetWeekStart: weekStart,
    });
    if (!parsed.success) {
      setGeneration({
        busy: false,
        error: new ApiClientError(
          "validation_failed",
          "Choose a valid target week.",
          null,
          false,
          400,
        ),
        result: null,
      });
      return;
    }
    generationKey.current ??= createIdempotencyKey("programme.generate", clientId);
    setGeneration((state) => ({ ...state, busy: true, error: null }));
    try {
      const result = await requestApi("/api/v1/programmes/generate", programmeReviewSchema, {
        body: parsed.data,
        idempotencyKey: generationKey.current,
        method: "POST",
      });
      generationKey.current = null;
      setGeneration({ busy: false, error: null, result: result.data });
    } catch (error: unknown) {
      setGeneration({ busy: false, error: toApiClientError(error), result: null });
    }
  }

  async function runAccountability(): Promise<void> {
    const input = runAccountabilityRequestSchema.parse({ clientId });
    accountabilityKey.current ??= createIdempotencyKey("accountability.run", clientId);
    setAccountability((state) => ({ ...state, busy: true, error: null }));
    try {
      const result = await requestApi("/api/v1/accountability/run", accountabilityDetailSchema, {
        body: input,
        idempotencyKey: accountabilityKey.current,
        method: "POST",
      });
      accountabilityKey.current = null;
      setAccountability({ busy: false, error: null, result: result.data });
      resource.reload();
    } catch (error: unknown) {
      setAccountability({ busy: false, error: toApiClientError(error), result: null });
    }
  }

  if (resource.loading) return <LoadingState label="Loading synthetic client detail" />;
  if (resource.error !== null)
    return (
      <ErrorState
        error={resource.error}
        onRetry={resource.reload}
        title="Client detail unavailable"
      />
    );
  if (resource.data === null)
    return <EmptyState body="The client response contained no data." title="Client unavailable" />;

  const detail = resource.data;
  return (
    <>
      <PageHeader
        description={`Synthetic client · ${detail.client.timezone} · ${formatLabel(detail.client.dataClassification)} data only`}
        eyebrow="Client workspace"
        title={detail.client.handle}
      />
      <div className="content-layout">
        <div className="stack">
          <div className="grid-2">
            <ClientOverview detail={detail} />
            <Constraints detail={detail} />
          </div>
          <ProgrammeCard detail={detail} />
          <div className="grid-2">
            <ActivityHistory detail={detail} />
            <Signals detail={detail} />
          </div>
          <Messages detail={detail} />
        </div>
        <aside className="stack client-actions" aria-label="Client actions">
          <Card>
            <div className="card__header">
              <h2>Generate programme</h2>
              <Sparkles aria-hidden="true" className="muted" size={18} />
            </div>
            <div className="card__body stack stack--sm">
              <p className="caption">
                Assemble current context, run safety evaluation, and add a proposal to the queue.
              </p>
              <div className="field">
                <label htmlFor="target-week">Target week starts</label>
                <input
                  id="target-week"
                  onChange={(event) => {
                    setWeekStart(event.currentTarget.value);
                  }}
                  type="date"
                  value={weekStart}
                />
              </div>
              <Button
                busy={generation.busy}
                onClick={() => {
                  void generateProgramme();
                }}
              >
                <Play aria-hidden="true" size={15} /> Generate proposal
              </Button>
              {generation.error === null ? null : (
                <ErrorState
                  error={generation.error}
                  onRetry={() => {
                    void generateProgramme();
                  }}
                />
              )}
              {generation.result === null ? null : (
                <InlineStatus tone="success">
                  Proposal queued.{" "}
                  <Link href={`/programmes/${generation.result.programme.id}`}>Review it now</Link>.
                </InlineStatus>
              )}
            </div>
          </Card>
          <Card>
            <div className="card__header">
              <h2>Accountability</h2>
              <CircleCheck aria-hidden="true" className="muted" size={18} />
            </div>
            <div className="card__body stack stack--sm">
              <p className="caption">
                Recalculate deterministic engagement evidence. Message suppression and ownership
                rules remain enforced.
              </p>
              <Button
                busy={accountability.busy}
                onClick={() => {
                  void runAccountability();
                }}
                variant="secondary"
              >
                Run accountability
              </Button>
              {accountability.error === null ? null : (
                <ErrorState
                  error={accountability.error}
                  onRetry={() => {
                    void runAccountability();
                  }}
                />
              )}
              {accountability.result === null ? null : (
                <InlineStatus tone="success">
                  Tier {accountability.result.state.tier} recorded · owner{" "}
                  {accountability.result.state.owner}.
                </InlineStatus>
              )}
            </div>
          </Card>
          <InlineStatus tone="info">
            Actions are attributed by the server to the single seeded coach. This screen does not
            provide authentication.
          </InlineStatus>
        </aside>
      </div>
    </>
  );
}
