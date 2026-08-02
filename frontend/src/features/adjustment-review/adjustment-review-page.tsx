"use client";

import {
  adjustmentSchema,
  editAdjustmentRequestSchema,
  overrideAdjustmentRequestSchema,
  programmeSchema,
  reviewAdjustmentRequestSchema,
  type Adjustment,
  type AdjustmentOperation,
} from "@spotter/contracts";
import { Ban, Check, PencilLine, Save, ShieldX, X } from "lucide-react";
import Link from "next/link";
import React, { useRef, useState } from "react";
import { z } from "zod";

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

const adjustmentListSchema = z.array(adjustmentSchema);
type LifecycleAction = "approve" | "override" | "reject";

interface MutationState {
  readonly action: LifecycleAction | "edit" | null;
  readonly error: ApiClientError | null;
  readonly message: string | null;
}

const idleMutation: MutationState = { action: null, error: null, message: null };

async function loadAdjustment(
  adjustmentId: string,
  signal: AbortSignal,
): Promise<ApiResult<Adjustment>> {
  const result = await requestApi("/api/v1/adjustments?limit=100", adjustmentListSchema, {
    signal,
  });
  const adjustment = result.data.find((item) => item.id === adjustmentId);
  if (adjustment === undefined) {
    throw new ApiClientError(
      "not_found",
      "The requested adjustment does not exist.",
      result.meta.requestId,
      false,
      404,
    );
  }
  return { data: adjustment, meta: result.meta };
}

function operationTitle(operation: AdjustmentOperation): string {
  if (operation.type === "reduce_load") return `Reduce load ${String(operation.percent)}%`;
  if (operation.type === "reduce_volume") {
    return `Remove ${String(operation.setsToRemove)} set(s)`;
  }
  return `Swap to ${operation.replacementName}`;
}

function OperationList({
  operations,
}: {
  readonly operations: readonly AdjustmentOperation[];
}): React.JSX.Element {
  return (
    <ol className="adjustment-operations">
      {operations.map((operation, index) => (
        <li key={`${operation.exerciseId}:${operation.type}:${String(index)}`}>
          <div>
            <span className="caption">{formatLabel(operation.type)}</span>
            <strong>{operationTitle(operation)}</strong>
          </div>
          <p>{operation.rationale}</p>
          <code>{operation.exerciseId}</code>
        </li>
      ))}
    </ol>
  );
}

function OperationEditor({
  index,
  onChange,
  operation,
}: {
  readonly index: number;
  readonly onChange: (operation: AdjustmentOperation) => void;
  readonly operation: AdjustmentOperation;
}): React.JSX.Element {
  const prefix = `operation-${String(index)}`;
  return (
    <fieldset className="editor-day adjustment-operation-editor">
      <legend>
        Operation {String(index + 1)} · {formatLabel(operation.type)}
      </legend>
      {operation.type === "reduce_load" ? (
        <div className="field">
          <label htmlFor={`${prefix}-percent`}>Load reduction (%)</label>
          <input
            id={`${prefix}-percent`}
            max={100}
            min={1}
            onChange={(event) => {
              onChange({ ...operation, percent: event.currentTarget.valueAsNumber });
            }}
            type="number"
            value={operation.percent}
          />
        </div>
      ) : null}
      {operation.type === "reduce_volume" ? (
        <div className="field">
          <label htmlFor={`${prefix}-sets`}>Sets to remove</label>
          <input
            id={`${prefix}-sets`}
            max={20}
            min={1}
            onChange={(event) => {
              onChange({ ...operation, setsToRemove: event.currentTarget.valueAsNumber });
            }}
            type="number"
            value={operation.setsToRemove}
          />
        </div>
      ) : null}
      {operation.type === "swap_exercise" ? (
        <>
          <div className="field">
            <label htmlFor={`${prefix}-replacement`}>Catalogued replacement exercise</label>
            <input id={`${prefix}-replacement`} readOnly value={operation.replacementName} />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-family`}>Catalogued movement family</label>
            <input id={`${prefix}-family`} readOnly value={operation.replacementFamily} />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-equivalence`}>Catalogue equivalence ID</label>
            <input id={`${prefix}-equivalence`} readOnly value={operation.equivalenceId} />
            <p className="field__hint">
              Replacement identity is selected by the backend-owned equivalence catalogue.
            </p>
          </div>
        </>
      ) : null}
      <div className="field">
        <label htmlFor={`${prefix}-rationale`}>Rationale</label>
        <textarea
          id={`${prefix}-rationale`}
          onChange={(event) => {
            onChange({ ...operation, rationale: event.currentTarget.value });
          }}
          value={operation.rationale}
        />
      </div>
    </fieldset>
  );
}

function AdjustmentEditor({
  adjustment,
  busy,
  onCancel,
  onSave,
}: {
  readonly adjustment: Adjustment;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (operations: readonly AdjustmentOperation[], reason: string) => Promise<void>;
}): React.JSX.Element {
  const [operations, setOperations] = useState<readonly AdjustmentOperation[]>(
    adjustment.operations,
  );
  const [reason, setReason] = useState("");
  const input = editAdjustmentRequestSchema.safeParse({
    expectedVersion: adjustment.version,
    operations,
    ...(reason.trim().length === 0 ? {} : { reason }),
  });
  const dirty = JSON.stringify(operations) !== JSON.stringify(adjustment.operations);
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (input.success && dirty) void onSave(input.data.operations, reason);
      }}
    >
      <InlineStatus tone="info">
        Edits remain reducing-only, are version checked, and create an attributed audit diff.
      </InlineStatus>
      {operations.map((operation, index) => (
        <OperationEditor
          index={index}
          key={`${operation.exerciseId}:${operation.type}:${String(index)}`}
          onChange={(next) => {
            setOperations((current) =>
              current.map((item, itemIndex) => (itemIndex === index ? next : item)),
            );
          }}
          operation={operation}
        />
      ))}
      <div className="field">
        <label htmlFor="adjustment-edit-reason">Edit note (optional)</label>
        <textarea
          id="adjustment-edit-reason"
          maxLength={1000}
          onChange={(event) => {
            setReason(event.currentTarget.value);
          }}
          value={reason}
        />
      </div>
      {input.success ? null : (
        <InlineStatus tone="danger">
          Resolve {String(input.error.issues.length)} validation issue(s) before saving.
        </InlineStatus>
      )}
      <div className="form-actions">
        <Button onClick={onCancel} variant="ghost">
          <X aria-hidden="true" size={15} /> Cancel
        </Button>
        <Button busy={busy} disabled={!dirty || !input.success} type="submit">
          <Save aria-hidden="true" size={15} /> Save adjustment
        </Button>
      </div>
    </form>
  );
}

function AdjustmentWorkspace({ initial }: { readonly initial: Adjustment }): React.JSX.Element {
  const [adjustment, setAdjustment] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState("");
  const [mutation, setMutation] = useState<MutationState>(idleMutation);
  const keys = useRef(new PayloadIdempotencyRegistry());
  const actionable = adjustment.status === "queued";
  const blocked = adjustment.reviewBand === "blocked";

  async function save(
    operations: readonly AdjustmentOperation[],
    editReason: string,
  ): Promise<void> {
    const input = editAdjustmentRequestSchema.parse({
      expectedVersion: adjustment.version,
      operations,
      ...(editReason.trim().length === 0 ? {} : { reason: editReason }),
    });
    setMutation({ action: "edit", error: null, message: null });
    try {
      const result = await requestApi(`/api/v1/adjustments/${adjustment.id}`, adjustmentSchema, {
        body: input,
        idempotencyKey: keys.current.keyFor("adjustment.edit", adjustment.id, input),
        method: "PATCH",
      });
      keys.current.clear("adjustment.edit", adjustment.id);
      setAdjustment(result.data);
      setEditing(false);
      setMutation({ action: null, error: null, message: "Adjustment changes saved." });
    } catch (error) {
      setMutation({ action: null, error: toApiClientError(error), message: null });
    }
  }

  async function mutate(action: LifecycleAction): Promise<void> {
    const raw = {
      expectedVersion: adjustment.version,
      ...(reason.trim().length === 0 ? {} : { reason }),
    };
    const input =
      action === "override"
        ? overrideAdjustmentRequestSchema.parse(raw)
        : reviewAdjustmentRequestSchema.parse(raw);
    setMutation({ action, error: null, message: null });
    try {
      if (action === "reject") {
        const result = await requestApi(
          `/api/v1/adjustments/${adjustment.id}/reject`,
          adjustmentSchema,
          {
            body: input,
            idempotencyKey: keys.current.keyFor(`adjustment.${action}`, adjustment.id, input),
            method: "POST",
          },
        );
        setAdjustment(result.data);
      } else {
        await requestApi(`/api/v1/adjustments/${adjustment.id}/${action}`, programmeSchema, {
          body: input,
          idempotencyKey: keys.current.keyFor(`adjustment.${action}`, adjustment.id, input),
          method: "POST",
        });
        const refreshed = await loadAdjustment(adjustment.id, new AbortController().signal);
        setAdjustment(refreshed.data);
      }
      keys.current.clear(`adjustment.${action}`, adjustment.id);
      setConfirmation(null);
      setReason("");
      setMutation({
        action: null,
        error: null,
        message:
          action === "approve" || action === "override"
            ? "Adjustment approved and applied as a new programme version."
            : "Adjustment rejected and removed from actionable review.",
      });
    } catch (error) {
      setMutation({ action: null, error: toApiClientError(error), message: null });
    }
  }

  return (
    <>
      <PageHeader
        actions={
          <>
            <BandBadge band={adjustment.reviewBand} />
            <span className="status-badge">{adjustment.status}</span>
          </>
        }
        description={`Reducing-only proposal · v${String(adjustment.version)} · ${formatLabel(adjustment.trigger.type)}`}
        eyebrow="Adjustment review"
        title={`${String(adjustment.operations.length)} proposed operation(s)`}
      />
      {mutation.message === null ? null : (
        <InlineStatus tone="success">{mutation.message}</InlineStatus>
      )}
      {mutation.error === null ? null : (
        <ErrorState error={mutation.error} title="The adjustment was not changed" />
      )}
      <div aria-label="Adjustment actions" className="programme-toolbar">
        <Button
          disabled={!actionable || editing}
          onClick={() => {
            setEditing(true);
          }}
          variant="secondary"
        >
          <PencilLine aria-hidden="true" size={15} /> Edit operations
        </Button>
        <Button
          disabled={!actionable || blocked || editing}
          onClick={() => {
            setConfirmation("approve");
          }}
        >
          <Check aria-hidden="true" size={15} /> Approve and apply
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
          Standard approval is disabled because this adjustment failed a deterministic safety gate.
        </InlineStatus>
      ) : null}
      {confirmation === null ? null : (
        <ConfirmationDialog
          busy={mutation.action === confirmation}
          confirmDisabled={confirmation === "override" && reason.trim().length === 0}
          confirmLabel={
            confirmation === "approve"
              ? "Confirm and apply"
              : confirmation === "override"
                ? "Apply with override"
                : "Confirm rejection"
          }
          description={
            confirmation === "approve"
              ? "Approval creates and publishes a new programme version. The base programme remains immutable evidence."
              : confirmation === "override"
                ? "This applies a blocked adjustment as a new programme version. The written reason remains in the audit trail."
                : "The proposal leaves the actionable queue and cannot later be applied."
          }
          kind={confirmation}
          onCancel={() => {
            setConfirmation(null);
            setReason("");
          }}
          onConfirm={() => void mutate(confirmation)}
          title={
            confirmation === "approve"
              ? "Apply this adjustment?"
              : confirmation === "override"
                ? "Override this blocked adjustment?"
                : "Reject this adjustment?"
          }
        >
          <div className="field">
            <label htmlFor={`${confirmation}-adjustment-reason`}>
              {confirmation === "override" ? "Override reason" : "Decision note (optional)"}
            </label>
            <textarea
              aria-invalid={confirmation === "override" && reason.trim().length === 0}
              id={`${confirmation}-adjustment-reason`}
              maxLength={1000}
              onChange={(event) => {
                setReason(event.currentTarget.value);
              }}
              value={reason}
            />
          </div>
        </ConfirmationDialog>
      )}
      <div className="content-layout programme-review-layout">
        <Card>
          <div className="card__header">
            <h2>Reducing operations</h2>
            <span className="caption">Coach editable</span>
          </div>
          <div className="card__body">
            {editing ? (
              <AdjustmentEditor
                adjustment={adjustment}
                busy={mutation.action === "edit"}
                key={adjustment.version}
                onCancel={() => {
                  setEditing(false);
                }}
                onSave={save}
              />
            ) : (
              <OperationList operations={adjustment.operations} />
            )}
          </div>
        </Card>
        <aside className="stack review-sidebar">
          <Card>
            <div className="card__header">
              <h2>Proposal record</h2>
            </div>
            <div className="card__body">
              <DefinitionList
                items={[
                  { label: "Created", value: formatDateTime(adjustment.createdAt) },
                  { label: "Source event", value: <code>{adjustment.sourceEventKey}</code> },
                  {
                    label: "Client",
                    value: (
                      <Link className="text-link" href={`/clients/${adjustment.clientId}`}>
                        Open detail
                      </Link>
                    ),
                  },
                  {
                    label: "Base programme",
                    value: (
                      <Link
                        className="text-link"
                        href={`/programmes/${adjustment.baseProgrammeId}`}
                      >
                        Inspect immutable base
                      </Link>
                    ),
                  },
                  ...(adjustment.appliedProgrammeId === null
                    ? []
                    : [
                        {
                          label: "Applied programme",
                          value: (
                            <Link
                              className="text-link"
                              href={`/programmes/${adjustment.appliedProgrammeId}`}
                            >
                              Inspect published version
                            </Link>
                          ),
                        },
                      ]),
                ]}
              />
            </div>
          </Card>
          <InlineStatus tone="info">
            Adjustments never silently mutate a published programme. Approval creates a separately
            versioned programme and retains this proposal as evidence.
          </InlineStatus>
        </aside>
      </div>
    </>
  );
}

export function AdjustmentReviewPage({
  adjustmentId,
}: {
  readonly adjustmentId: string;
}): React.JSX.Element {
  const resource = useResource(`adjustment:${adjustmentId}`, (signal) =>
    loadAdjustment(adjustmentId, signal),
  );
  if (resource.loading) return <LoadingState label="Loading adjustment evidence" />;
  if (resource.error !== null) {
    return (
      <ErrorState
        error={resource.error}
        onRetry={resource.reload}
        title="Adjustment review unavailable"
      />
    );
  }
  if (resource.data === null) {
    return (
      <EmptyState
        body="The adjustment response contained no review evidence."
        title="Adjustment unavailable"
      />
    );
  }
  return <AdjustmentWorkspace initial={resource.data} key={resource.data.version} />;
}
