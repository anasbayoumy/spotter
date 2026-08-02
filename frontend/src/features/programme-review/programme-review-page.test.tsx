// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { ProgrammeReview } from "@spotter/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const review: ProgrammeReview = {
  citations: [
    {
      claim: "The current schedule supports three weekly sessions.",
      recordIds: ["00000000-0000-4000-8000-000000000901"],
      sectionId: "profile",
    },
  ],
  gates: [
    {
      id: "00000000-0000-4000-8000-000000000501",
      name: "forbidden_movement",
      passed: false,
      rationale: "A hard movement constraint still requires coach review.",
    },
  ],
  judges: [
    {
      id: "00000000-0000-4000-8000-000000000502",
      judgeModel: "recorded-judge",
      name: "grounding",
      rationale: "The proposal cites stored schedule context.",
      score: 4,
    },
  ],
  model: "recorded-programme-generator",
  programme: {
    approvedAt: null,
    approvedBy: null,
    clientId: "00000000-0000-4000-8000-000000000102",
    createdAt: "2026-08-02T09:00:00.000Z",
    generatedBy: "00000000-0000-4000-8000-000000000202",
    id: "00000000-0000-4000-8000-000000000602",
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
          ],
          focus: "Aerobic power",
          scheduledDate: "2026-08-03",
        },
      ],
      summary: "Synthetic recorded-mode training week.",
    },
    reviewBand: "blocked",
    status: "queued",
    supersededBy: null,
    validFrom: null,
    version: 1,
    week: 1,
  },
  promptVersion: `sha256:${"a".repeat(64)}`,
  traceId: "00000000-0000-4000-8000-000000000201",
};

vi.mock("../../lib/api/use-resource", () => ({
  useResource: () => ({ data: review, error: null, loading: false, reload: vi.fn() }),
}));

import { ProgrammeReviewPage } from "./programme-review-page";

afterEach(() => {
  cleanup();
});

describe("programme review presentation", () => {
  it("shows prescribed load and fails closed for an ordinary blocked approval", () => {
    render(<ProgrammeReviewPage programmeId={review.programme.id} />);

    expect(screen.getByRole("cell", { name: "40 kg" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/standard approval is disabled/iu);
  });

  it("retains edits, validates bounds, and exposes prescribed load to the coach", () => {
    render(<ProgrammeReviewPage programmeId={review.programme.id} />);
    fireEvent.click(screen.getByRole("button", { name: /edit proposal/iu }));

    expect(screen.getByLabelText("Load kg")).toHaveValue(40);
    const sets = screen.getByLabelText("Sets");
    fireEvent.change(sets, { target: { value: "0", valueAsNumber: 0 } });
    expect(screen.getByText(/validation issue\(s\) before saving/iu)).toBeVisible();
    expect(screen.getByRole("button", { name: /save and rerun gates/iu })).toBeDisabled();

    fireEvent.change(sets, { target: { value: "3", valueAsNumber: 3 } });
    expect(screen.getByRole("button", { name: /save and rerun gates/iu })).toBeEnabled();
  });
});
