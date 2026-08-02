// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { ClientDetail, ProgrammeReview } from "@spotter/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../lib/api/use-resource", () => ({
  useResource: () => mocks.resource,
}));

import { ApiClientError } from "../lib/api/client";
import { ClientDetailPage } from "./client-detail/client-detail-page";
import { ReviewQueuePage } from "./review-queue/review-queue-page";
import { ScorecardPage } from "./scorecard/scorecard-page";
import { TraceInspectorPage } from "./trace-inspector/trace-inspector-page";

const CLIENT_ID = "00000000-0000-4000-8000-000000000101";
const PROGRAMME_ID = "00000000-0000-4000-8000-000000000601";
const TRACE_ID = "00000000-0000-4000-8000-000000000201";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000301";
const NOW = "2026-08-02T09:00:00.000Z";

const programme = {
  approvedAt: NOW,
  approvedBy: "00000000-0000-4000-8000-000000000001",
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
            id: EXERCISE_ID,
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
  reviewBand: "clear" as const,
  status: "published" as const,
  supersededBy: null,
  validFrom: NOW,
  version: 1,
  week: 1,
};

const review: ProgrammeReview = {
  citations: [],
  gates: [],
  judges: [],
  model: "recorded/programme",
  programme: { ...programme, approvedAt: null, approvedBy: null, status: "queued" },
  promptVersion: `sha256:${"a".repeat(64)}`,
  traceId: TRACE_ID,
};

const fullClient: ClientDetail = {
  activeConstraints: [
    {
      clientId: CLIENT_ID,
      createdAt: NOW,
      detail: {
        forbids: ["vertical_press"],
        modifies: [],
        note: null,
        region: "shoulder",
      },
      id: "00000000-0000-4000-8000-000000000401",
      kind: "injury",
      severity: "hard",
      source: "coach_entered",
      validFrom: NOW,
      validUntil: null,
    },
    {
      clientId: CLIENT_ID,
      createdAt: NOW,
      detail: { forbids: [], modifies: [], note: "Train after work.", region: null },
      id: "00000000-0000-4000-8000-000000000402",
      kind: "schedule",
      severity: "soft",
      source: "client_reported",
      validFrom: NOW,
      validUntil: "2026-09-02T09:00:00.000Z",
    },
  ],
  adherence14d: null,
  adherence7d: 0.75,
  checkIns: [
    {
      body: "Recovered but cautious.",
      clientId: CLIENT_ID,
      createdAt: NOW,
      id: "00000000-0000-4000-8000-000000000801",
      latencyHours: 2,
      readiness: 3,
      requiresHumanEscalation: true,
      respondedAt: NOW,
      sentiment: -0.25,
    },
    {
      body: "Ready to train.",
      clientId: CLIENT_ID,
      createdAt: NOW,
      id: "00000000-0000-4000-8000-000000000802",
      latencyHours: null,
      readiness: 5,
      requiresHumanEscalation: false,
      respondedAt: NOW,
      sentiment: null,
    },
  ],
  client: {
    coachId: "00000000-0000-4000-8000-000000000001",
    createdAt: NOW,
    dataClassification: "synthetic",
    goals: { primary: "Build consistency", secondary: [], targetDate: null },
    handle: "c_001",
    id: CLIENT_ID,
    profile: {
      ageBand: "25_34",
      equipment: ["rower", "dumbbells"],
      sessionsPerWeek: 3,
      sex: "not_specified",
      trainingAgeMonths: 18,
    },
    status: "active",
    timezone: "Africa/Cairo",
  },
  currentProgramme: programme,
  messages: [
    {
      actor: "agent",
      body: "Your coach is reviewing your update.",
      clientId: CLIENT_ID,
      createdAt: NOW,
      id: "00000000-0000-4000-8000-000000000901",
      sentAt: NOW,
      status: "sent",
      suppressedAt: null,
      suppressionReason: null,
      tier: 1,
    },
    {
      actor: "agent",
      body: "Suppressed synthetic message.",
      clientId: CLIENT_ID,
      createdAt: NOW,
      id: "00000000-0000-4000-8000-000000000902",
      sentAt: null,
      status: "suppressed",
      suppressedAt: NOW,
      suppressionReason: "Recent message exists.",
      tier: 2,
    },
  ],
  sessions: [
    {
      actual: null,
      clientId: CLIENT_ID,
      id: "00000000-0000-4000-8000-000000000701",
      notes: null,
      performedAt: NOW,
      planned: programme.payload.days[0]?.exercises ?? [],
      programmeId: PROGRAMME_ID,
      rpe: 7,
      scheduledFor: "2026-08-03",
      status: "completed",
      version: 1,
    },
    {
      actual: null,
      clientId: CLIENT_ID,
      id: "00000000-0000-4000-8000-000000000702",
      notes: null,
      performedAt: null,
      planned: [],
      programmeId: PROGRAMME_ID,
      rpe: null,
      scheduledFor: "2026-08-04",
      status: "missed",
      version: 1,
    },
  ],
};

function setResource(data: unknown, error: unknown = null, loading = false): void {
  mocks.resource.data = data;
  mocks.resource.error = error;
  mocks.resource.loading = loading;
}

function apiResponse(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ data, error: null, meta: { requestId: "coverage-request" } }),
    { headers: { "Content-Type": "application/json" }, status },
  );
}

beforeEach(() => {
  setResource(null);
  mocks.resource.reload.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("primary coach page coverage", () => {
  it("renders loading, error, and empty states for every primary resource page", () => {
    const components = [
      {
        component: <ReviewQueuePage key="queue" />,
        emptyData: { attention: [], blocked: [], clear: [] },
      },
      { component: <ScorecardPage key="scorecard" />, emptyData: null },
      {
        component: <TraceInspectorPage key="trace" traceId={TRACE_ID} />,
        emptyData: null,
      },
      { component: <ClientDetailPage clientId={CLIENT_ID} key="client" />, emptyData: null },
    ];
    for (const { component, emptyData } of components) {
      setResource(null, null, true);
      const view = render(component);
      expect(screen.getByRole("status")).toBeVisible();
      view.unmount();

      setResource(
        null,
        new ApiClientError(
          "dependency_unavailable",
          "Synthetic service unavailable.",
          null,
          true,
          503,
        ),
      );
      const failed = render(component);
      expect(screen.getByRole("alert")).toHaveTextContent("Synthetic service unavailable");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(mocks.resource.reload).toHaveBeenCalled();
      failed.unmount();

      setResource(emptyData);
      const empty = render(component);
      expect(
        screen.getByText(
          /(?:nothing needs review|no evaluation data|trace unavailable|client unavailable)/iu,
        ),
      ).toBeVisible();
      empty.unmount();
    }
  });

  it("renders populated queue groups, rows, and empty band states", () => {
    const baseItem = {
      band: "blocked" as const,
      clientHandle: "c_001",
      clientId: CLIENT_ID,
      createdAt: NOW,
      finding: "Synthetic safety finding.",
      href: `/programmes/${PROGRAMME_ID}`,
      id: PROGRAMME_ID,
      kind: "programme" as const,
      title: "Week 1 · Mesocycle 1",
    };
    setResource({
      attention: [],
      blocked: [baseItem],
      clear: [
        {
          ...baseItem,
          band: "clear",
          href: "/adjustments/00000000-0000-4000-8000-000000001001",
          id: "00000000-0000-4000-8000-000000001001",
          kind: "adjustment",
          title: "Adjustment proposal",
        },
      ],
    });
    render(<ReviewQueuePage />);

    expect(screen.getByText("2 actionable")).toBeVisible();
    expect(screen.getByRole("link", { name: "Week 1 · Mesocycle 1" })).toBeVisible();
    expect(screen.getByText("No needs attention work is waiting.")).toBeVisible();
  });

  it("renders available, unavailable, distributed, calibrated, and empty scorecard evidence", () => {
    const available = { availability: "available", sampleSize: 2, value: 0.5 } as const;
    const unavailable = { availability: "unavailable", sampleSize: 0, value: null } as const;
    setResource({
      bandAccuracy: available,
      calibrationKappaByJudge: { grounding: available, safety: unavailable },
      costPerPublishedPlanUsd: { ...available, value: 0.125 },
      generatedAt: NOW,
      judgeDistribution: { grounding: [0, 1, 0, 3, 0] },
      latencyP50Ms: { ...available, value: 100 },
      latencyP95Ms: { ...available, value: 250 },
      mode: "recorded",
      safetyPassRateByGate: { forbidden_movement: available, schedule: unavailable },
    });
    const populated = render(<ScorecardPage />);
    expect(screen.getByText("Recorded mode")).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Forbidden Movement pass rate" }),
    ).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("img", { name: /Grounding score distribution/iu })).toBeVisible();
    populated.unmount();

    setResource({
      bandAccuracy: unavailable,
      calibrationKappaByJudge: {},
      costPerPublishedPlanUsd: unavailable,
      generatedAt: NOW,
      judgeDistribution: {},
      latencyP50Ms: unavailable,
      latencyP95Ms: unavailable,
      mode: "mixed",
      safetyPassRateByGate: {},
    });
    render(<ScorecardPage />);
    expect(screen.getByText("No safety gate samples are available.")).toBeVisible();
    expect(screen.getByText("No judge score samples are available.")).toBeVisible();
    expect(screen.getByText("No calibration pairs are available.")).toBeVisible();
  });

  it("renders pinned and optional trace evidence plus bounded and empty sections", () => {
    const trace = {
      budget: 100,
      clientId: CLIENT_ID,
      createdAt: NOW,
      id: TRACE_ID,
      intent: "programme",
      rendered: "Synthetic exact model input",
      sections: [
        {
          id: "hard-constraints",
          kind: "hard_constraints",
          pinned: true,
          records: [
            {
              recordId: "00000000-0000-4000-8000-000000000401",
              recordVersion: null,
              source: "constraint",
            },
          ],
          rendered: "Pinned constraint",
          tokenEstimate: 70,
        },
        {
          id: "valid-notes",
          kind: "valid_notes",
          pinned: false,
          records: [],
          rendered: "Optional notes",
          tokenEstimate: 50,
        },
      ],
      tokenCount: 120,
      turnId: "00000000-0000-4000-8000-000000000211",
    };
    setResource({ client: fullClient.client, trace });
    const populated = render(<TraceInspectorPage traceId={TRACE_ID} />);
    expect(screen.getByText("Pinned")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    populated.unmount();

    setResource({ client: null, trace: { ...trace, sections: [], tokenCount: 25 } });
    render(<TraceInspectorPage traceId={TRACE_ID} />);
    expect(screen.getByText("No context sections were selected for this run.")).toBeVisible();
    expect(screen.getByText("Unknown synthetic client")).toBeVisible();
  });

  it("renders complete and sparse client evidence branches", () => {
    setResource(fullClient);
    const populated = render(<ClientDetailPage clientId={CLIENT_ID} />);
    expect(screen.getByText("Human review required")).toBeVisible();
    expect(screen.getByText("Suppressed: Recent message exists.")).toBeVisible();
    expect(screen.getByText("Rower")).toBeVisible();
    populated.unmount();

    setResource({
      ...fullClient,
      activeConstraints: [],
      adherence14d: 0,
      adherence7d: null,
      checkIns: [],
      client: {
        ...fullClient.client,
        goals: { ...fullClient.client.goals, targetDate: "2026-12-01" },
        profile: { ...fullClient.client.profile, equipment: [] },
      },
      currentProgramme: null,
      messages: [],
      sessions: [],
    });
    render(<ClientDetailPage clientId={CLIENT_ID} />);
    expect(screen.getByText("No equipment has been recorded.")).toBeVisible();
    expect(
      screen.getByText("No published programme is currently visible to this client."),
    ).toBeVisible();
    expect(screen.getByText("No active constraints at the current effective time.")).toBeVisible();
  });

  it("validates generation and completes programme and accountability actions", async () => {
    setResource(fullClient);
    const accountability = {
      latestScore: null,
      messages: [],
      state: {
        automationPaused: false,
        churnFlagged: false,
        clientId: CLIENT_ID,
        lastTransitionAt: NOW,
        owner: "automation",
        tier: 1,
        version: 2,
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(review))
      .mockResolvedValueOnce(apiResponse(accountability));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientDetailPage clientId={CLIENT_ID} />);

    fireEvent.change(screen.getByLabelText("Target week starts"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /generate proposal/iu }));
    expect(await screen.findByText("Choose a valid target week.")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Target week starts"), {
      target: { value: "2026-08-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate proposal/iu }));
    expect(await screen.findByText(/proposal queued/iu)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Run accountability" }));
    expect(await screen.findByText(/tier 1 recorded/iu)).toBeVisible();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mocks.resource.reload).toHaveBeenCalledOnce();
    });
  });

  it("surfaces action transport failures and retries with the same UI actions", async () => {
    setResource(fullClient);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    render(<ClientDetailPage clientId={CLIENT_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /generate proposal/iu }));
    expect(
      await screen.findByText("The coach console could not reach the Spotter service."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Run accountability" }));
    await waitFor(() => {
      expect(
        screen.getAllByText("The coach console could not reach the Spotter service."),
      ).toHaveLength(2);
    });
  });
});
