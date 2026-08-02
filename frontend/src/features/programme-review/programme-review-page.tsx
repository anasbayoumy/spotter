"use client";

import {
  editProgrammeRequestSchema,
  lifecycleMutationRequestSchema,
  overrideProgrammeRequestSchema,
  programmePayloadSchema,
  programmeReviewSchema,
  programmeSchema,
  type ProgrammePayload,
  type ProgrammeReview,
} from "@spotter/contracts";
import { Ban, Check, ExternalLink, PencilLine, Save, ShieldCheck, ShieldX, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { BandBadge } from "../../components/ui/band-badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ConfirmationDialog } from "../../components/ui/confirmation-dialog";
import { DefinitionList } from "../../components/ui/definition-list";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState, ErrorState, InlineStatus, LoadingState } from "../../components/ui/states";
import { ApiClientError, requestApi, toApiClientError, type ApiResult } from "../../lib/api/client";
import { PayloadIdempotencyRegistry } from "../../lib/api/idempotency";
import { useResource } from "../../lib/api/use-resource";
import { formatDateTime, formatLabel } from "../../lib/format";

type Confirmation = "approve" | "override" | "reject" | null;
type LifecycleAction = Exclude<Confirmation, null>;

interface MutationState {
  readonly action: LifecycleAction | "edit" | null;
  readonly error: ApiClientError | null;
  readonly message: string | null;
}

const idleMutation: MutationState = { action: null, error: null, message: null };

async function loadReview(
  programmeId: string,
  signal: AbortSignal,
): Promise<ApiResult<ProgrammeReview>> {
  return requestApi(`/api/v1/programmes/${programmeId}`, programmeReviewSchema, { signal });
}

function ProgrammeDisplay({ payload }: { readonly payload: ProgrammePayload }): React.JSX.Element {
  return (
    <div className="stack">
      <p className="programme-lead">{payload.summary}</p>
      <div className="programme-days">
        {payload.days.map((day) => (
          <article className="programme-day" key={`${String(day.dayIndex)}:${day.scheduledDate}`}>
            <header>
              <div>
                <span>Day {day.dayIndex}</span>
                <h3>{day.focus}</h3>
              </div>
              <time dateTime={day.scheduledDate}>{day.scheduledDate}</time>
            </header>
            <div className="exercise-table-wrap">
              <table className="exercise-table">
                <thead>
                  <tr>
                    <th scope="col">Exercise</th>
                    <th scope="col">Sets</th>
                    <th scope="col">Reps</th>
                    <th scope="col">Load</th>
                    <th scope="col">RPE</th>
                    <th scope="col">Rest</th>
                  </tr>
                </thead>
                <tbody>
                  {day.exercises.map((exercise) => (
                    <tr key={exercise.id}>
                      <td>
                        <strong>{exercise.name}</strong>
                        <small>{formatLabel(exercise.family)}</small>
                      </td>
                      <td>{exercise.sets}</td>
                      <td>
                        {typeof exercise.reps === "number"
                          ? exercise.reps
                          : `${String(exercise.reps.min)}–${String(exercise.reps.max)}`}
                      </td>
                      <td>
                        {exercise.loadKg === undefined || exercise.loadKg === null
                          ? "—"
                          : `${String(exercise.loadKg)} kg`}
                      </td>
                      <td>{exercise.rpe}</td>
                      <td>
                        {exercise.restSeconds === null ? "—" : `${String(exercise.restSeconds)}s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

interface ProgrammeEditorProps {
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (payload: ProgrammePayload, reason: string) => Promise<void>;
  readonly review: ProgrammeReview;
}

function ProgrammeEditor({
  busy,
  onCancel,
  onSave,
  review,
}: ProgrammeEditorProps): React.JSX.Element {
  const [payload, setPayload] = useState<ProgrammePayload>(review.programme.payload);
  const [reason, setReason] = useState("");
  const validation = programmePayloadSchema.safeParse(payload);
  const dirty = JSON.stringify(payload) !== JSON.stringify(review.programme.payload);

  function updateDayFocus(dayIndex: number, focus: string): void {
    setPayload((current) => ({
      ...current,
      days: current.days.map((day) => (day.dayIndex === dayIndex ? { ...day, focus } : day)),
    }));
  }

  function updateExercise(
    dayIndex: number,
    exerciseId: string,
    values: { readonly rpe?: number; readonly sets?: number },
  ): void {
    setPayload((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.dayIndex === dayIndex
          ? {
              ...day,
              exercises: day.exercises.map((exercise) =>
                exercise.id === exerciseId ? { ...exercise, ...values } : exercise,
              ),
            }
          : day,
      ),
    }));
  }

  return (
    <form
      className="programme-editor stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validation.success || !dirty) return;
        void onSave(validation.data, reason);
      }}
    >
      <InlineStatus tone="info">
        Saving creates an attributed structured diff and reruns deterministic gates before approval.
      </InlineStatus>
      <div className="field">
        <label htmlFor="programme-summary">Programme summary</label>
        <textarea
          aria-invalid={payload.summary.trim().length === 0}
          id="programme-summary"
          onChange={(event) => {
            setPayload((current) => ({ ...current, summary: event.currentTarget.value }));
          }}
          value={payload.summary}
        />
      </div>
      {payload.days.map((day) => (
        <fieldset className="editor-day" key={day.dayIndex}>
          <legend>
            Day {day.dayIndex} · {day.scheduledDate}
          </legend>
          <div className="field">
            <label htmlFor={`focus-${String(day.dayIndex)}`}>Training focus</label>
            <input
              id={`focus-${String(day.dayIndex)}`}
              onChange={(event) => {
                updateDayFocus(day.dayIndex, event.currentTarget.value);
              }}
              value={day.focus}
            />
          </div>
          <div className="editor-exercises">
            {day.exercises.map((exercise) => (
              <div className="editor-exercise" key={exercise.id}>
                <div>
                  <strong>{exercise.name}</strong>
                  <small>{formatLabel(exercise.family)}</small>
                </div>
                <div className="field">
                  <label htmlFor={`sets-${exercise.id}`}>Sets</label>
                  <input
                    id={`sets-${exercise.id}`}
                    max={20}
                    min={1}
                    onChange={(event) => {
                      updateExercise(day.dayIndex, exercise.id, {
                        sets: event.currentTarget.valueAsNumber,
                      });
                    }}
                    type="number"
                    value={exercise.sets}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`load-${exercise.id}`}>Load kg</label>
                  <input
                    id={`load-${exercise.id}`}
                    min={0}
                    onChange={(event) => {
                      const loadKg =
                        event.currentTarget.value === "" ? null : event.currentTarget.valueAsNumber;
                      setPayload((current) => ({
                        ...current,
                        days: current.days.map((currentDay) =>
                          currentDay.dayIndex === day.dayIndex
                            ? {
                                ...currentDay,
                                exercises: currentDay.exercises.map((currentExercise) =>
                                  currentExercise.id === exercise.id
                                    ? {
                                        ...currentExercise,
                                        loadKg,
                                      }
                                    : currentExercise,
                                ),
                              }
                            : currentDay,
                        ),
                      }));
                    }}
                    placeholder="Not prescribed"
                    step="0.25"
                    type="number"
                    value={exercise.loadKg ?? ""}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`rpe-${exercise.id}`}>RPE</label>
                  <input
                    id={`rpe-${exercise.id}`}
                    max={10}
                    min={1}
                    onChange={(event) => {
                      updateExercise(day.dayIndex, exercise.id, {
                        rpe: event.currentTarget.valueAsNumber,
                      });
                    }}
                    step="0.5"
                    type="number"
                    value={exercise.rpe}
                  />
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="field">
        <label htmlFor="edit-reason">Edit note (optional)</label>
        <textarea
          id="edit-reason"
          maxLength={1000}
          onChange={(event) => {
            setReason(event.currentTarget.value);
          }}
          placeholder="Why is this change appropriate?"
          value={reason}
        />
      </div>
      {!validation.success ? (
        <InlineStatus tone="danger">
          <strong>
            Resolve {validation.error.issues.length} validation issue(s) before saving.
          </strong>
          <ul>
            {validation.error.issues.slice(0, 5).map((issue) => (
              <li key={`${issue.path.join(".")}:${issue.message}`}>
                {issue.path.join(".") || "programme"}: {issue.message}
              </li>
            ))}
          </ul>
        </InlineStatus>
      ) : null}
      <div className="form-actions">
        <Button onClick={onCancel} variant="ghost">
          <X aria-hidden="true" size={15} /> Cancel
        </Button>
        <Button busy={busy} disabled={!dirty || !validation.success} type="submit">
          <Save aria-hidden="true" size={15} /> Save and rerun gates
        </Button>
      </div>
    </form>
  );
}

function Evidence({ review }: { readonly review: ProgrammeReview }): React.JSX.Element {
  return (
    <div className="stack">
      <Card>
        <div className="card__header">
          <h2>Deterministic safety gates</h2>
          <span className="caption">
            {review.gates.filter((gate) => gate.passed).length}/{review.gates.length} passed
          </span>
        </div>
        <div className="card__body">
          {review.gates.length === 0 ? (
            <p className="muted caption">No gate evidence is available.</p>
          ) : (
            <ul className="evidence-list">
              {review.gates.map((gate) => (
                <li className={gate.passed ? "evidence--passed" : "evidence--failed"} key={gate.id}>
                  {gate.passed ? (
                    <ShieldCheck aria-hidden="true" size={18} />
                  ) : (
                    <ShieldX aria-hidden="true" size={18} />
                  )}
                  <div>
                    <strong>{formatLabel(gate.name)}</strong>
                    <p>{gate.rationale}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card>
        <div className="card__header">
          <h2>Independent judges</h2>
        </div>
        <div className="card__body">
          {review.judges.length === 0 ? (
            <p className="muted caption">No judge evidence is available.</p>
          ) : (
            <ul className="judge-list">
              {review.judges.map((judge) => (
                <li key={judge.id}>
                  <div className="judge-score" aria-label={`${String(judge.score)} out of 5`}>
                    {judge.score}
                    <small>/5</small>
                  </div>
                  <div>
                    <strong>{formatLabel(judge.name)}</strong>
                    <p>{judge.rationale}</p>
                    <small>{judge.judgeModel}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card>
        <div className="card__header">
          <h2>Citations</h2>
          <span className="caption">{review.citations.length} claims</span>
        </div>
        <div className="card__body">
          {review.citations.length === 0 ? (
            <p className="muted caption">No citations are attached.</p>
          ) : (
            <ol className="citation-list">
              {review.citations.map((citation) => (
                <li key={`${citation.sectionId}:${citation.claim}`}>
                  <p>{citation.claim}</p>
                  <small>
                    {citation.sectionId} · {citation.recordIds.length} record(s)
                  </small>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </div>
  );
}

interface ConfirmationPanelProps {
  readonly busy: boolean;
  readonly kind: LifecycleAction;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => Promise<void>;
}

function ConfirmationPanel({
  busy,
  kind,
  onCancel,
  onConfirm,
}: ConfirmationPanelProps): React.JSX.Element {
  const [reason, setReason] = useState("");
  const requiresReason = kind === "override";
  const title =
    kind === "approve"
      ? "Publish this programme?"
      : kind === "reject"
        ? "Reject this proposal?"
        : "Override the safety block?";
  const description =
    kind === "approve"
      ? "This becomes the client-visible current plan and supersedes the prior version."
      : kind === "reject"
        ? "The proposal leaves the actionable queue and cannot later be approved."
        : "This publishes a blocked plan. Your written reason is retained in the audit trail.";
  return (
    <ConfirmationDialog
      busy={busy}
      confirmDisabled={requiresReason && reason.trim().length === 0}
      confirmLabel={
        kind === "approve"
          ? "Confirm publication"
          : kind === "reject"
            ? "Confirm rejection"
            : "Publish with override"
      }
      description={description}
      kind={kind}
      onCancel={onCancel}
      onConfirm={() => void onConfirm(reason)}
      title={title}
    >
      {kind === "approve" ? null : (
        <div className="field">
          <label htmlFor={`${kind}-reason`}>
            {requiresReason ? "Override reason" : "Rejection reason (optional)"}
          </label>
          <textarea
            aria-invalid={requiresReason && reason.trim().length === 0}
            id={`${kind}-reason`}
            maxLength={1000}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
            value={reason}
          />
        </div>
      )}
    </ConfirmationDialog>
  );
}

function ReviewWorkspace({
  initialReview,
}: {
  readonly initialReview: ProgrammeReview;
}): React.JSX.Element {
  const [review, setReview] = useState(initialReview);
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [mutation, setMutation] = useState<MutationState>(idleMutation);
  const keys = useRef(new PayloadIdempotencyRegistry());
  const actionable = review.programme.status === "queued";
  const blocked = review.programme.reviewBand === "blocked";

  async function save(payload: ProgrammePayload, reason: string): Promise<void> {
    const input = editProgrammeRequestSchema.safeParse({
      expectedVersion: review.programme.version,
      payload,
      ...(reason.trim().length === 0 ? {} : { reason }),
    });
    if (!input.success) {
      setMutation({
        action: null,
        error: new ApiClientError(
          "validation_failed",
          input.error.issues[0]?.message ?? "Programme edit is invalid.",
          null,
          false,
          400,
        ),
        message: null,
      });
      return;
    }
    setMutation({ action: "edit", error: null, message: null });
    try {
      const result = await requestApi(
        `/api/v1/programmes/${review.programme.id}`,
        programmeReviewSchema,
        {
          body: input.data,
          idempotencyKey: keys.current.keyFor("programme.edit", review.programme.id, input.data),
          method: "PATCH",
        },
      );
      keys.current.clear("programme.edit", review.programme.id);
      setReview(result.data);
      setEditing(false);
      setMutation({
        action: null,
        error: null,
        message: "Changes saved and safety evidence refreshed.",
      });
    } catch (error: unknown) {
      setMutation({ action: null, error: toApiClientError(error), message: null });
    }
  }

  async function mutate(action: LifecycleAction, reason: string): Promise<void> {
    const raw = {
      expectedVersion: review.programme.version,
      ...(reason.trim().length === 0 ? {} : { reason }),
    };
    const input =
      action === "override"
        ? overrideProgrammeRequestSchema.safeParse(raw)
        : lifecycleMutationRequestSchema.safeParse(raw);
    if (!input.success) {
      setMutation({
        action: null,
        error: new ApiClientError(
          "validation_failed",
          input.error.issues[0]?.message ?? "The request is invalid.",
          null,
          false,
          400,
        ),
        message: null,
      });
      return;
    }
    setMutation({ action, error: null, message: null });
    try {
      const result = await requestApi(
        `/api/v1/programmes/${review.programme.id}/${action}`,
        programmeSchema,
        {
          body: input.data,
          idempotencyKey: keys.current.keyFor(
            `programme.${action}`,
            review.programme.id,
            input.data,
          ),
          method: "POST",
        },
      );
      keys.current.clear(`programme.${action}`, review.programme.id);
      setReview((current) => ({ ...current, programme: result.data }));
      setConfirmation(null);
      setMutation({
        action: null,
        error: null,
        message:
          action === "reject"
            ? "Proposal rejected and removed from actionable review."
            : "Programme published successfully.",
      });
    } catch (error: unknown) {
      setMutation({ action: null, error: toApiClientError(error), message: null });
    }
  }

  return (
    <>
      <PageHeader
        actions={
          <>
            {review.programme.reviewBand === null ? null : (
              <BandBadge band={review.programme.reviewBand} />
            )}
            <span className="status-badge">{review.programme.status}</span>
          </>
        }
        description={`Week ${String(review.programme.week)} · mesocycle ${String(review.programme.mesocycle)} · proposal v${String(review.programme.version)}`}
        eyebrow="Programme review"
        title={review.programme.payload.summary}
      />
      {mutation.message === null ? null : (
        <InlineStatus tone="success">{mutation.message}</InlineStatus>
      )}
      {mutation.error === null ? null : (
        <ErrorState error={mutation.error} title="The programme was not changed" />
      )}
      <div className="programme-toolbar" aria-label="Programme actions">
        <Button
          disabled={!actionable || editing}
          onClick={() => {
            setEditing(true);
          }}
          variant="secondary"
        >
          <PencilLine aria-hidden="true" size={15} /> Edit proposal
        </Button>
        <Button
          disabled={!actionable || blocked || editing}
          onClick={() => {
            setConfirmation("approve");
          }}
        >
          <Check aria-hidden="true" size={15} /> Approve
        </Button>
        <Button
          disabled={!actionable || editing}
          onClick={() => {
            setConfirmation("reject");
          }}
          variant="danger"
        >
          <Ban aria-hidden="true" size={15} /> Reject
        </Button>
        {blocked && actionable ? (
          <Button
            disabled={editing}
            onClick={() => {
              setConfirmation("override");
            }}
            variant="danger"
          >
            <ShieldX aria-hidden="true" size={15} /> Override block
          </Button>
        ) : null}
      </div>
      {blocked && actionable ? (
        <InlineStatus tone="danger">
          Standard approval is disabled because at least one deterministic safety gate failed.
        </InlineStatus>
      ) : null}
      {confirmation === null ? null : (
        <ConfirmationPanel
          busy={mutation.action === confirmation}
          kind={confirmation}
          onCancel={() => {
            setConfirmation(null);
          }}
          onConfirm={(reason) => mutate(confirmation, reason)}
        />
      )}
      <div className="content-layout programme-review-layout">
        <div className="stack">
          <Card>
            <div className="card__header">
              <h2>Programme content</h2>
              <span className="caption">Schema-constrained</span>
            </div>
            <div className="card__body">
              {editing ? (
                <ProgrammeEditor
                  busy={mutation.action === "edit"}
                  key={review.programme.version}
                  onCancel={() => {
                    setEditing(false);
                  }}
                  onSave={save}
                  review={review}
                />
              ) : (
                <ProgrammeDisplay payload={review.programme.payload} />
              )}
            </div>
          </Card>
          <Evidence review={review} />
        </div>
        <aside className="stack review-sidebar">
          <Card>
            <div className="card__header">
              <h2>Generation record</h2>
            </div>
            <div className="card__body">
              <DefinitionList
                items={[
                  { label: "Created", value: formatDateTime(review.programme.createdAt) },
                  { label: "Model", value: review.model },
                  { label: "Prompt", value: <code>{review.promptVersion}</code> },
                  { label: "Generator run", value: <code>{review.programme.generatedBy}</code> },
                  {
                    label: "Client",
                    value: (
                      <Link className="text-link" href={`/clients/${review.programme.clientId}`}>
                        Open detail
                      </Link>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
          <Link className="trace-link-card" href={`/traces/${review.traceId}`}>
            <span>
              <small>Exact model context</small>
              <strong>Inspect trace</strong>
              <code>{review.traceId}</code>
            </span>
            <ExternalLink aria-hidden="true" size={18} />
          </Link>
          <InlineStatus tone="info">
            Only published programmes become visible to the client. Queued, rejected, and superseded
            versions remain coach evidence.
          </InlineStatus>
        </aside>
      </div>
    </>
  );
}

export function ProgrammeReviewPage({
  programmeId,
}: {
  readonly programmeId: string;
}): React.JSX.Element {
  const resource = useResource(`programme:${programmeId}`, (signal) =>
    loadReview(programmeId, signal),
  );
  if (resource.loading) return <LoadingState label="Loading programme evidence" />;
  if (resource.error !== null)
    return (
      <ErrorState
        error={resource.error}
        onRetry={resource.reload}
        title="Programme review unavailable"
      />
    );
  if (resource.data === null)
    return (
      <EmptyState
        body="The programme response contained no review evidence."
        title="Programme unavailable"
      />
    );
  return (
    <ReviewWorkspace
      initialReview={resource.data}
      key={`${resource.data.programme.id}:${String(resource.data.programme.version)}`}
    />
  );
}
