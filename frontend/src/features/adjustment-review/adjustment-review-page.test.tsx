// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { Adjustment } from "@spotter/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reload: vi.fn() }));

const adjustment: Adjustment = {
  appliedProgrammeId: null,
  approvedAt: null,
  approvedBy: null,
  baseProgrammeId: "00000000-0000-4000-8000-000000000603",
  clientId: "00000000-0000-4000-8000-000000000103",
  createdAt: "2026-08-02T09:00:00.000Z",
  id: "00000000-0000-4000-8000-000000001002",
  operations: [
    {
      exerciseId: "00000000-0000-4000-8000-000000000301",
      percent: 15,
      rationale: "Reduce exposure while the hard constraint remains active.",
      type: "reduce_load",
    },
  ],
  reviewBand: "blocked",
  sourceEventKey: "coach:blocked-fixture",
  status: "queued",
  trigger: {
    coachId: "00000000-0000-4000-8000-000000000001",
    type: "explicit_coach",
  },
  version: 1,
};

vi.mock("../../lib/api/use-resource", () => ({
  useResource: () => ({
    data: adjustment,
    error: null,
    loading: false,
    reload: mocks.reload,
  }),
}));

import { AdjustmentReviewPage } from "./adjustment-review-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("adjustment review presentation", () => {
  it("fails closed for blocked approval and requires a reasoned override", () => {
    render(<AdjustmentReviewPage adjustmentId={adjustment.id} />);

    expect(screen.getByRole("button", { name: /approve and apply/iu })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Standard approval is disabled");
    fireEvent.click(screen.getByRole("button", { name: /override block/iu }));

    expect(screen.getByRole("dialog", { name: "Override this blocked adjustment?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply with override" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Override reason"), {
      target: { value: "Coach reviewed the immutable base and accepts the bounded reduction." },
    });
    expect(screen.getByRole("button", { name: "Apply with override" })).toBeEnabled();
  });

  it("edits a reducing operation while keeping lifecycle actions unavailable", () => {
    render(<AdjustmentReviewPage adjustmentId={adjustment.id} />);
    fireEvent.click(screen.getByRole("button", { name: /edit operations/iu }));

    const percent = screen.getByLabelText("Load reduction (%)");
    fireEvent.change(percent, { target: { value: "20", valueAsNumber: 20 } });
    expect(percent).toHaveValue(20);
    expect(screen.getByRole("button", { name: /save adjustment/iu })).toBeEnabled();
    expect(screen.getByRole("button", { name: /override block/iu })).toBeDisabled();
  });

  it("rotates the edit key after a rejected payload is corrected", async () => {
    const updated = {
      ...adjustment,
      operations: [{ ...adjustment.operations[0], percent: 25 }],
      version: 2,
    } as Adjustment;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            error: { code: "validation_failed", message: "The first edit was rejected." },
            meta: { requestId: "adjustment-edit-rejected" },
          }),
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: updated,
            error: null,
            meta: { requestId: "adjustment-edit-corrected" },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<AdjustmentReviewPage adjustmentId={adjustment.id} />);
    fireEvent.click(screen.getByRole("button", { name: /edit operations/iu }));

    const percent = screen.getByLabelText("Load reduction (%)");
    fireEvent.change(percent, { target: { value: "20", valueAsNumber: 20 } });
    fireEvent.click(screen.getByRole("button", { name: /save adjustment/iu }));
    expect(await screen.findByText("The first edit was rejected.")).toBeVisible();

    fireEvent.change(percent, { target: { value: "25", valueAsNumber: 25 } });
    fireEvent.click(screen.getByRole("button", { name: /save adjustment/iu }));
    expect(await screen.findByText("Adjustment changes saved.")).toBeVisible();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers;
    expect(firstHeaders).toBeInstanceOf(Headers);
    expect(secondHeaders).toBeInstanceOf(Headers);
    if (firstHeaders instanceof Headers && secondHeaders instanceof Headers) {
      expect(secondHeaders.get("Idempotency-Key")).not.toBe(firstHeaders.get("Idempotency-Key"));
    }
  });
});
