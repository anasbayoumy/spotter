// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { Adjustment, ProgrammeReview } from "@spotter/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resource: {
    data: null as unknown,
    error: null as unknown,
    loading: false,
    reload: vi.fn(),
  },
}));

vi.mock("../lib/api/use-resource", () => ({ useResource: () => mocks.resource }));

import { ConfirmationDialog } from "../components/ui/confirmation-dialog";
import { ApiClientError } from "../lib/api/client";
import { AdjustmentReviewPage } from "./adjustment-review/adjustment-review-page";
import { ProgrammeReviewPage } from "./programme-review/programme-review-page";

const CLIENT_ID = "00000000-0000-4000-8000-000000000101";
const PROGRAMME_ID = "00000000-0000-4000-8000-000000000601";
const ADJUSTMENT_ID = "00000000-0000-4000-8000-000000001001";
const NOW = "2026-08-02T09:00:00.000Z";

const queuedProgramme: ProgrammeReview["programme"] = {
  approvedAt: null,
  approvedBy: null,
  clientId: CLIENT_ID,
  createdAt: NOW,
  generatedBy: "00000000-0000-4000-8000-000000000202",
  id: PROGRAMME_ID,
  mesocycle: 1,
  payload: {
    days: [
      {
        dayIndex: 1,
        exercises: [
          {
            family: "horizontal_pull",
            id: "00000000-0000-4000-8000-000000000301",
            loadKg: 40,
            muscleGroups: ["back"],
            name: "Row ergometer intervals",
            notes: null,
            reps: 8,
            restSeconds: 90,
            rpe: 7,
            sets: 4,
          },
          {
            family: "squat",
            id: "00000000-0000-4000-8000-000000000302",
            loadKg: null,
            muscleGroups: ["legs"],
            name: "Bodyweight squat",
            notes: "Controlled range.",
            reps: { max: 12, min: 8 },
            restSeconds: null,
            rpe: 6,
            sets: 3,
          },
        ],
        focus: "Strength endurance",
        scheduledDate: "2026-08-03",
      },
    ],
    summary: "Synthetic programme review.",
  },
  reviewBand: "clear",
  status: "queued",
  supersededBy: null,
  validFrom: null,
  version: 1,
  week: 1,
};

const review: ProgrammeReview = {
  citations: [
    {
      claim: "The current schedule supports three sessions.",
      recordIds: ["00000000-0000-4000-8000-000000000901"],
      sectionId: "profile",
    },
  ],
  gates: [
    {
      id: "00000000-0000-4000-8000-000000000501",
      name: "frequency_breach",
      passed: true,
      rationale: "Frequency is within the stored schedule.",
    },
    {
      id: "00000000-0000-4000-8000-000000000502",
      name: "forbidden_movement",
      passed: false,
      rationale: "Synthetic failure evidence.",
    },
  ],
  judges: [
    {
      id: "00000000-0000-4000-8000-000000000503",
      judgeModel: "recorded/judge",
      name: "grounding",
      rationale: "The draft is grounded.",
      score: 4,
    },
  ],
  model: "recorded/programme",
  programme: queuedProgramme,
  promptVersion: "programme-v1",
  traceId: "00000000-0000-4000-8000-000000000201",
};

const adjustment: Adjustment = {
  appliedProgrammeId: null,
  approvedAt: null,
  approvedBy: null,
  baseProgrammeId: PROGRAMME_ID,
  clientId: CLIENT_ID,
  createdAt: NOW,
  id: ADJUSTMENT_ID,
  operations: [
    {
      exerciseId: "00000000-0000-4000-8000-000000000301",
      percent: 15,
      rationale: "Reduce load.",
      type: "reduce_load",
    },
    {
      exerciseId: "00000000-0000-4000-8000-000000000302",
      rationale: "Reduce volume.",
      setsToRemove: 1,
      type: "reduce_volume",
    },
    {
      equivalenceId: "00000000-0000-4000-8000-000000000304",
      exerciseId: "00000000-0000-4000-8000-000000000303",
      rationale: "Use the documented equivalent.",
      replacementFamily: "horizontal_pull",
      replacementName: "Seated cable row",
      type: "swap_exercise",
    },
  ],
  reviewBand: "attention",
  sourceEventKey: "session:synthetic",
  status: "queued",
  trigger: { coachId: "00000000-0000-4000-8000-000000000001", type: "explicit_coach" },
  version: 1,
};

function setResource(data: unknown, error: unknown = null, loading = false): void {
  mocks.resource.data = data;
  mocks.resource.error = error;
  mocks.resource.loading = loading;
}

function apiResponse(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ data, error: null, meta: { requestId: "mutation-coverage" } }),
    { headers: { "Content-Type": "application/json" }, status },
  );
}

function elementAt(elements: readonly HTMLElement[], index: number, label: string): HTMLElement {
  const element = elements[index];
  if (element === undefined) throw new Error(`${label} was not rendered.`);
  return element;
}

function publishedProgramme(): ProgrammeReview["programme"] {
  return {
    ...queuedProgramme,
    approvedAt: NOW,
    approvedBy: "00000000-0000-4000-8000-000000000001",
    status: "published",
    validFrom: NOW,
    version: 2,
  };
}

beforeEach(() => {
  setResource(null);
  mocks.resource.reload.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("coach mutation page coverage", () => {
  it("renders loading, retryable error, and empty states for both mutation pages", () => {
    for (const component of [
      <ProgrammeReviewPage key="programme" programmeId={PROGRAMME_ID} />,
      <AdjustmentReviewPage adjustmentId={ADJUSTMENT_ID} key="adjustment" />,
    ]) {
      setResource(null, null, true);
      const loading = render(component);
      expect(screen.getByRole("status")).toBeVisible();
      loading.unmount();

      setResource(
        null,
        new ApiClientError(
          "dependency_unavailable",
          "Synthetic mutation service failed.",
          null,
          true,
          503,
        ),
      );
      const failed = render(component);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(mocks.resource.reload).toHaveBeenCalled();
      failed.unmount();

      setResource(null);
      const empty = render(component);
      expect(screen.getByText(/(?:programme|adjustment) unavailable/iu)).toBeVisible();
      empty.unmount();
    }
  });

  it("renders range, nullable prescription, passing/failing evidence, judges, and citations", () => {
    setResource(review);
    render(<ProgrammeReviewPage programmeId={PROGRAMME_ID} />);

    expect(screen.getByRole("cell", { name: "8–12" })).toBeVisible();
    expect(screen.getAllByRole("cell", { name: "—" })).toHaveLength(2);
    expect(screen.getByText("1/2 passed")).toBeVisible();
    expect(screen.getByLabelText("4 out of 5")).toBeVisible();
    expect(screen.getByText("The current schedule supports three sessions.")).toBeVisible();
  });

  it("edits every mutable programme field and persists refreshed evidence", async () => {
    const updated = {
      ...review,
      programme: {
        ...review.programme,
        payload: { ...review.programme.payload, summary: "Updated synthetic programme." },
        version: 2,
      },
    } satisfies ProgrammeReview;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(apiResponse(updated)));
    setResource(review);
    render(<ProgrammeReviewPage programmeId={PROGRAMME_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /edit proposal/iu }));

    fireEvent.change(screen.getByLabelText("Programme summary"), {
      target: { value: "Updated synthetic programme." },
    });
    fireEvent.change(screen.getByLabelText("Training focus"), {
      target: { value: "Updated focus" },
    });
    fireEvent.change(elementAt(screen.getAllByLabelText("Sets"), 0, "First sets field"), {
      target: { value: "3", valueAsNumber: 3 },
    });
    const loads = screen.getAllByLabelText("Load kg");
    fireEvent.change(elementAt(loads, 0, "First load field"), {
      target: { value: "", valueAsNumber: Number.NaN },
    });
    fireEvent.change(elementAt(loads, 1, "Second load field"), {
      target: { value: "20", valueAsNumber: 20 },
    });
    fireEvent.change(elementAt(screen.getAllByLabelText("RPE"), 0, "First RPE field"), {
      target: { value: "8", valueAsNumber: 8 },
    });
    fireEvent.change(screen.getByLabelText("Edit note (optional)"), {
      target: { value: "Coach-reviewed change." },
    });
    fireEvent.click(screen.getByRole("button", { name: /save and rerun gates/iu }));

    expect(await screen.findByText("Changes saved and safety evidence refreshed.")).toBeVisible();
  });

  it("approves, rejects, overrides, and reports a failed programme lifecycle mutation", async () => {
    const scenarios = [
      {
        button: "Approve",
        confirm: "Confirm publication",
        expected: "Programme published successfully.",
        input: review,
        response: publishedProgramme(),
      },
      {
        button: "Reject",
        confirm: "Confirm rejection",
        expected: "Proposal rejected and removed from actionable review.",
        input: review,
        response: { ...queuedProgramme, reviewBand: null, status: "rejected", version: 2 },
      },
    ] as const;
    for (const scenario of scenarios) {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(apiResponse(scenario.response)),
      );
      setResource(scenario.input);
      const view = render(<ProgrammeReviewPage programmeId={PROGRAMME_ID} />);
      fireEvent.click(screen.getByRole("button", { name: scenario.button }));
      fireEvent.click(screen.getByRole("button", { name: scenario.confirm }));
      expect(await screen.findByText(scenario.expected)).toBeVisible();
      view.unmount();
    }

    const blocked = {
      ...review,
      programme: { ...review.programme, reviewBand: "blocked" as const },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(apiResponse(publishedProgramme())),
    );
    setResource(blocked);
    const override = render(<ProgrammeReviewPage programmeId={PROGRAMME_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Override block" }));
    expect(screen.getByRole("button", { name: "Publish with override" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Override reason"), {
      target: { value: "Coach accepts the bounded synthetic risk." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish with override" }));
    expect(await screen.findByText("Programme published successfully.")).toBeVisible();
    override.unmount();

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    setResource(review);
    render(<ProgrammeReviewPage programmeId={PROGRAMME_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm publication" }));
    expect(
      await screen.findByText("The coach console could not reach the Spotter service."),
    ).toBeVisible();
  });

  it("renders and edits every adjustment operation type, validation, cancellation, and terminal evidence", () => {
    setResource(adjustment);
    const view = render(<AdjustmentReviewPage adjustmentId={ADJUSTMENT_ID} />);
    expect(screen.getByText("Reduce load 15%")).toBeVisible();
    expect(screen.getByText("Remove 1 set(s)")).toBeVisible();
    expect(screen.getByText("Swap to Seated cable row")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /edit operations/iu }));
    fireEvent.change(screen.getByLabelText("Sets to remove"), {
      target: { value: "2", valueAsNumber: 2 },
    });
    fireEvent.change(elementAt(screen.getAllByLabelText("Rationale"), 0, "First rationale"), {
      target: { value: "" },
    });
    expect(screen.getByText(/validation issue/iu)).toBeVisible();
    fireEvent.change(elementAt(screen.getAllByLabelText("Rationale"), 0, "First rationale"), {
      target: { value: "Updated reducing rationale." },
    });
    fireEvent.change(screen.getByLabelText("Edit note (optional)"), {
      target: { value: "Audited edit." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Sets to remove")).not.toBeInTheDocument();
    view.unmount();

    setResource({
      ...adjustment,
      appliedProgrammeId: PROGRAMME_ID,
      approvedAt: NOW,
      approvedBy: "00000000-0000-4000-8000-000000000001",
      status: "applied",
      version: 2,
    });
    render(<AdjustmentReviewPage adjustmentId={ADJUSTMENT_ID} />);
    expect(screen.getByRole("link", { name: "Inspect published version" })).toBeVisible();
    expect(screen.getByRole("button", { name: /edit operations/iu })).toBeDisabled();
  });

  it("persists an adjustment edit, rejects a proposal, and surfaces transport failure", async () => {
    const edited: Adjustment = {
      ...adjustment,
      operations: [
        { ...adjustment.operations[0], percent: 25 } as Adjustment["operations"][number],
      ],
      version: 2,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(apiResponse(edited)));
    setResource(adjustment);
    const editView = render(<AdjustmentReviewPage adjustmentId={ADJUSTMENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /edit operations/iu }));
    fireEvent.change(screen.getByLabelText("Load reduction (%)"), {
      target: { value: "25", valueAsNumber: 25 },
    });
    fireEvent.click(screen.getByRole("button", { name: /save adjustment/iu }));
    expect(await screen.findByText("Adjustment changes saved.")).toBeVisible();
    editView.unmount();

    const rejected: Adjustment = { ...adjustment, status: "rejected", version: 2 };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(apiResponse(rejected)));
    setResource(adjustment);
    const rejectView = render(<AdjustmentReviewPage adjustmentId={ADJUSTMENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Decision note (optional)"), {
      target: { value: "Not appropriate this week." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(
      await screen.findByText("Adjustment rejected and removed from actionable review."),
    ).toBeVisible();
    rejectView.unmount();

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    setResource(adjustment);
    render(<AdjustmentReviewPage adjustmentId={ADJUSTMENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    expect(
      await screen.findByText("The coach console could not reach the Spotter service."),
    ).toBeVisible();
  });
});

describe("confirmation dialog keyboard coverage", () => {
  it("traps both tab directions, confirms, cancels on Escape, and restores focus", () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(
      <ConfirmationDialog
        busy={false}
        confirmLabel="Confirm action"
        description="Synthetic confirmation"
        kind="reject"
        onCancel={cancel}
        onConfirm={confirm}
        title="Confirm synthetic action"
      >
        <input aria-label="Reason" />
      </ConfirmationDialog>,
    );
    const dialog = screen.getByRole("dialog");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const confirmButton = screen.getByRole("button", { name: "Confirm action" });
    const reason = screen.getByLabelText("Reason");
    expect(cancelButton).toHaveFocus();
    reason.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirmButton).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(reason).toHaveFocus();
    fireEvent.click(confirmButton);
    expect(confirm).toHaveBeenCalledOnce();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("does not cancel a busy dialog and covers the primary visual variant", () => {
    const cancel = vi.fn();
    render(
      <ConfirmationDialog
        busy
        confirmDisabled
        confirmLabel="Publishing"
        description="Busy confirmation"
        kind="approve"
        onCancel={cancel}
        onConfirm={vi.fn()}
        title="Publishing synthetic plan"
      />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publishing" })).toBeDisabled();
  });
});
