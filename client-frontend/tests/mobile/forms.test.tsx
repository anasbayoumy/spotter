import { act } from "react";
import React from "react";
import { createRoot, type Root, type TestInstance } from "test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkIn: vi.fn(),
  checkInClear: vi.fn().mockResolvedValue(undefined),
  checkInRead: vi.fn().mockResolvedValue(null),
  checkInSave: vi.fn().mockResolvedValue(undefined),
  completeSession: vi.fn(),
  getSession: vi.fn<() => unknown>(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  logSession: vi.fn(),
  push: vi.fn(),
  queryError: null as unknown,
  queryPending: false,
  queryRefetch: vi.fn().mockResolvedValue(undefined),
  replace: vi.fn(),
  selectionClientId: "00000000-0000-4000-8000-000000000101" as string | null,
  selectionLoading: false,
  sessionParam: "00000000-0000-4000-8000-000000000701" as string | readonly string[] | undefined,
  sessionQueryFn: null as (() => unknown) | null,
  sessionClear: vi.fn().mockResolvedValue(undefined),
  sessionRead: vi.fn().mockResolvedValue(null),
  sessionSave: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { readonly queryFn: () => unknown }) => {
    mocks.sessionQueryFn = options.queryFn;
    return {
      data: mocks.getSession(),
      error: mocks.queryError,
      isPending: mocks.queryPending,
      refetch: mocks.queryRefetch,
    };
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("expo-router", () => ({
  Redirect: ({ href }: { readonly href: string }) => React.createElement("Redirect", { href }),
  router: { push: mocks.push, replace: mocks.replace },
  useLocalSearchParams: () => ({ sessionId: mocks.sessionParam }),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children, ...props }: { readonly children?: React.ReactNode }) =>
    React.createElement("SafeAreaView", props, children),
}));
vi.mock("../../src/features/client-selector/SelectionProvider", () => ({
  useClientSelection: () => ({
    clientId: mocks.selectionClientId,
    loading: mocks.selectionLoading,
  }),
}));
vi.mock("../../src/features/check-in/draft", () => ({
  clearCheckInDraft: mocks.checkInClear,
  createCheckInDraft: (clientId: string) => ({
    body: "",
    idempotencyKey: `check-in:${clientId}`,
    readiness: null,
    respondedAt: null,
  }),
  readCheckInDraft: mocks.checkInRead,
  saveCheckInDraft: mocks.checkInSave,
  validateCheckInDraft: (
    clientId: string,
    draft: {
      readonly body: string;
      readonly readiness: number | null;
      readonly respondedAt: string | null;
    },
  ) =>
    draft.readiness === null || draft.body.trim().length === 0
      ? { error: { issues: [{ message: "Readiness and response are required." }] }, success: false }
      : {
          data: {
            body: draft.body,
            clientId,
            readiness: draft.readiness,
            respondedAt: draft.respondedAt,
          },
          success: true,
        },
}));
vi.mock("../../src/features/session-logging/draft", () => ({
  clearSessionDraft: mocks.sessionClear,
  createSessionDraft: (session: {
    readonly id: string;
    readonly planned: readonly {
      readonly id: string;
      readonly reps: number;
      readonly rpe: number;
      readonly sets: number;
    }[];
    readonly version: number;
  }) => ({
    completeKey: `complete:${session.id}`,
    exercises: session.planned.map((exercise) => ({
      exerciseId: exercise.id,
      sets: Array.from({ length: exercise.sets }, (_, index) => ({
        completed: true,
        loadKg: "",
        reps: String(exercise.reps),
        rpe: String(exercise.rpe),
        setIndex: index + 1,
      })),
    })),
    expectedVersion: session.version,
    logKey: `log:${session.id}`,
    notes: "",
    performedAt: null,
    sessionRpe: "",
  }),
  readSessionDraft: mocks.sessionRead,
  saveSessionDraft: mocks.sessionSave,
  validateSessionSubmission: (
    clientId: string,
    draft: {
      readonly expectedVersion: number;
      readonly notes: string;
      readonly performedAt: string | null;
      readonly sessionRpe: string;
    },
  ) =>
    draft.sessionRpe.trim().length === 0
      ? { errors: { rpe: "Overall session RPE is required." }, success: false }
      : {
          data: {
            completion: {
              clientId,
              expectedVersion: draft.expectedVersion,
              performedAt: draft.performedAt,
              rpe: Number(draft.sessionRpe),
            },
            log: {
              actual: [],
              clientId,
              expectedVersion: draft.expectedVersion,
              notes: draft.notes,
            },
          },
          success: true,
        },
}));
vi.mock("../../src/lib/api/client", () => ({
  clientApi: {
    checkIn: mocks.checkIn,
    completeSession: mocks.completeSession,
    getSession: mocks.getSession,
    logSession: mocks.logSession,
  },
}));
vi.mock("../../src/lib/query/client", () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));

import CheckInRoute from "../../src/app/(tabs)/check-in";
import SessionRoute from "../../src/app/session/[sessionId]";
import { ApiClientError } from "../../src/lib/api/errors";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const exercise = {
  family: "horizontal_pull",
  id: "00000000-0000-4000-8000-000000000301",
  loadKg: 40,
  muscleGroups: ["back"],
  name: "Row ergometer intervals",
  notes: null,
  reps: 8,
  restSeconds: 90,
  rpe: 7,
  sets: 1,
};
const session = {
  actual: null,
  clientId: "00000000-0000-4000-8000-000000000101",
  completedAt: null,
  createdAt: "2026-08-02T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000701",
  notes: null,
  performedAt: null,
  planned: [exercise],
  programmeId: "00000000-0000-4000-8000-000000000601",
  rpe: null,
  scheduledFor: "2026-08-03",
  sessionKey: "day-1",
  status: "scheduled",
  version: 1,
};

function renderer(): Root {
  return createRoot({ textComponentTypes: ["Text"] });
}
function nodes(root: TestInstance, predicate: (node: TestInstance) => boolean): TestInstance[] {
  return root.queryAll(predicate, { includeSelf: true });
}
function labelled(root: TestInstance, label: string): TestInstance {
  const matches = nodes(root, (node) => node.props.accessibilityLabel === label);
  expect(matches).toHaveLength(1);
  const match = matches[0];
  if (match === undefined) throw new Error(`Label ${label} was not rendered.`);
  return match;
}
function renderedText(root: TestInstance): string {
  return root.children
    .map((child) => (typeof child === "string" ? child : renderedText(child)))
    .join("");
}
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function fillValidCheckIn(root: TestInstance): void {
  act(() => {
    (labelled(root, "Readiness 4 of 5").props.onPress as () => void)();
    (labelled(root, "How are you feeling?").props.onChangeText as (value: string) => void)(
      "Ready to train.",
    );
  });
}

function fillSessionRpe(root: TestInstance, value = "7"): void {
  act(() => {
    (labelled(root, "Overall session RPE").props.onChangeText as (next: string) => void)(value);
  });
}

beforeEach(() => {
  mocks.checkInClear.mockReset().mockResolvedValue(undefined);
  mocks.checkInRead.mockReset().mockResolvedValue(null);
  mocks.checkInSave.mockReset().mockResolvedValue(undefined);
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.queryError = null;
  mocks.queryPending = false;
  mocks.queryRefetch.mockReset().mockResolvedValue(undefined);
  mocks.sessionClear.mockReset().mockResolvedValue(undefined);
  mocks.sessionRead.mockReset().mockResolvedValue(null);
  mocks.sessionSave.mockReset().mockResolvedValue(undefined);
  mocks.selectionClientId = "00000000-0000-4000-8000-000000000101";
  mocks.selectionLoading = false;
  mocks.sessionParam = "00000000-0000-4000-8000-000000000701";
  mocks.sessionQueryFn = null;
  mocks.getSession.mockReset().mockReturnValue(session);
  mocks.checkIn.mockReset().mockResolvedValue({ requiresHumanEscalation: false });
  mocks.logSession.mockReset().mockResolvedValue({ ...session, version: 2 });
  mocks.completeSession
    .mockReset()
    .mockResolvedValue({ ...session, status: "completed", version: 3 });
  mocks.push.mockReset();
  mocks.replace.mockReset();
});

describe("QA-MOB-001 native form routes", () => {
  it("waits for persisted selection restoration before evaluating a direct check-in route", () => {
    mocks.selectionClientId = null;
    mocks.selectionLoading = true;
    const root = renderer();
    act(() => {
      root.render(<CheckInRoute />);
    });

    expect(renderedText(root.container)).toContain("Loading client selection");
  });

  it("redirects direct form routes when no synthetic client is selected", () => {
    mocks.selectionClientId = null;
    mocks.getSession.mockReturnValue(undefined);
    const checkIn = renderer();
    const sessionRoot = renderer();
    act(() => {
      checkIn.render(<CheckInRoute />);
      sessionRoot.render(<SessionRoute />);
    });
    expect(nodes(checkIn.container, (node) => node.type === "Redirect")[0]?.props.href).toBe(
      "/select-client",
    );
    expect(nodes(sessionRoot.container, (node) => node.type === "Redirect")[0]?.props.href).toBe(
      "/select-client",
    );
  });

  it("normalizes array session params, rejects a missing ID, and shows selection loading", async () => {
    const arrayRoot = renderer();
    mocks.sessionParam = ["00000000-0000-4000-8000-000000000701", "ignored"];
    act(() => {
      arrayRoot.render(<SessionRoute />);
    });
    await flush();
    expect(mocks.sessionQueryFn?.()).toEqual(session);
    expect(mocks.getSession).toHaveBeenLastCalledWith("00000000-0000-4000-8000-000000000701");

    const missingRoot = renderer();
    mocks.sessionParam = undefined;
    mocks.getSession.mockReturnValue(undefined);
    act(() => {
      missingRoot.render(<SessionRoute />);
    });
    expect(() => mocks.sessionQueryFn?.()).toThrow("Session ID is missing.");

    const loadingRoot = renderer();
    mocks.sessionParam = "00000000-0000-4000-8000-000000000701";
    mocks.selectionClientId = null;
    mocks.selectionLoading = true;
    act(() => {
      loadingRoot.render(<SessionRoute />);
    });
    expect(renderedText(loadingRoot.container)).toContain("Loading client selection");
  });

  it("validates then submits a labelled readiness/free-text check-in", async () => {
    const root = renderer();
    act(() => {
      root.render(<CheckInRoute />);
    });
    await flush();
    await act(async () => {
      (labelled(root.container, "Send check-in").props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Check your response");
    act(() => {
      (labelled(root.container, "Readiness 2 of 5").props.onPress as () => void)();
      (
        labelled(root.container, "How are you feeling?").props.onChangeText as (
          value: string,
        ) => void
      )("Recovered but cautious.");
    });
    await act(async () => {
      (labelled(root.container, "Send check-in").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.checkIn).toHaveBeenCalledOnce();
    expect(renderedText(root.container)).toContain("Check-in received");
  });

  it("keeps the check-in draft visible when the network is unavailable", async () => {
    mocks.checkIn.mockRejectedValue(
      new ApiClientError({
        code: "network_unavailable",
        kind: "network",
        message: "Could not reach Spotter.",
        retryable: true,
      }),
    );
    const root = renderer();
    act(() => {
      root.render(<CheckInRoute />);
    });
    await flush();
    act(() => {
      (labelled(root.container, "Readiness 3 of 5").props.onPress as () => void)();
      (
        labelled(root.container, "How are you feeling?").props.onChangeText as (
          value: string,
        ) => void
      )("Keep this draft after failure.");
    });
    await act(async () => {
      (labelled(root.container, "Send check-in").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("You appear to be offline");
    expect(renderedText(root.container)).toContain("Could not reach Spotter.");
    expect(labelled(root.container, "How are you feeling?").props.value).toBe(
      "Keep this draft after failure.",
    );
    expect(nodes(root.container, (node) => node.props.accessibilityRole === "alert")).toHaveLength(
      1,
    );
    mocks.checkIn.mockResolvedValue({ requiresHumanEscalation: false });
    await act(async () => {
      (labelled(root.container, "Retry").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.checkIn).toHaveBeenCalledTimes(2);
    expect(renderedText(root.container)).toContain("Check-in received");
  });

  it("recovers an opaque check-in draft failure and reports escalation plus cleanup warning", async () => {
    mocks.checkInRead.mockRejectedValue("opaque restore failure");
    mocks.checkIn.mockResolvedValue({ requiresHumanEscalation: true });
    mocks.checkInClear.mockRejectedValue("opaque clear failure");
    const root = renderer();
    act(() => {
      root.render(<CheckInRoute />);
    });
    await flush();
    expect(renderedText(root.container)).toContain("Draft could not be restored.");
    act(() => {
      (labelled(root.container, "Readiness 5 of 5").props.onPress as () => void)();
      (
        labelled(root.container, "How are you feeling?").props.onChangeText as (
          value: string,
        ) => void
      )("Sharp discomfort after the last session.");
    });
    await act(async () => {
      (labelled(root.container, "Send check-in").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Sent for human review");
    expect(renderedText(root.container)).toContain("Submitted draft could not be cleared.");
    act(() => {
      (labelled(root.container, "Change client").props.onPress as () => void)();
    });
    expect(mocks.push).toHaveBeenCalledWith("/select-client");
    act(() => {
      (labelled(root.container, "Readiness 1 of 5").props.onPress as () => void)();
    });
    expect(renderedText(root.container)).not.toContain("Sent for human review");
  });

  it("stops check-in submission when local persistence fails", async () => {
    mocks.checkInSave.mockRejectedValue("opaque save failure");
    const root = renderer();
    act(() => {
      root.render(<CheckInRoute />);
    });
    await flush();
    act(() => {
      (labelled(root.container, "Readiness 4 of 5").props.onPress as () => void)();
      (
        labelled(root.container, "How are you feeling?").props.onChangeText as (
          value: string,
        ) => void
      )("Ready to train.");
    });
    await act(async () => {
      (labelled(root.container, "Send check-in").props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Draft could not be saved.");
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });

  it("reports Error restoration and opaque autosave failures for check-in drafts", async () => {
    vi.useFakeTimers();
    try {
      mocks.checkInRead.mockRejectedValue(new Error("Check-in restore failed."));
      mocks.checkInSave.mockRejectedValue("opaque autosave failure");
      const root = renderer();
      act(() => {
        root.render(<CheckInRoute />);
      });
      await flush();
      expect(renderedText(root.container)).toContain("Check-in restore failed.");
      await act(async () => {
        vi.advanceTimersByTime(251);
        await Promise.resolve();
      });
      expect(renderedText(root.container)).toContain("Draft could not be saved.");
      act(() => {
        root.unmount();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a valid check-in when binding-state persistence fails", async () => {
    mocks.checkInSave
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Bound draft could not be persisted."));
    const root = renderer();
    act(() => {
      root.render(<CheckInRoute />);
    });
    await flush();
    fillValidCheckIn(root.container);
    await act(async () => {
      (labelled(root.container, "Send check-in").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Bound draft could not be persisted.");
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });

  it("preserves a session draft through validation then completes once", async () => {
    const root = renderer();
    act(() => {
      root.render(<SessionRoute />);
    });
    await flush();
    act(() => {
      (
        labelled(root.container, "Session notes (optional)").props.onChangeText as (
          value: string,
        ) => void
      )("Controlled session.");
    });
    await act(async () => {
      (labelled(root.container, "Save and complete session").props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Check the session fields");
    expect(labelled(root.container, "Session notes (optional)").props.value).toBe(
      "Controlled session.",
    );
    act(() => {
      (
        labelled(root.container, "Overall session RPE").props.onChangeText as (
          value: string,
        ) => void
      )("7");
    });
    await act(async () => {
      (labelled(root.container, "Save and complete session").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.logSession).toHaveBeenCalledOnce();
    expect(mocks.completeSession).toHaveBeenCalledOnce();
    expect(renderedText(root.container)).toContain("Session completed");
  });

  it("renders session loading and retryable query failures", () => {
    mocks.getSession.mockReturnValue(undefined);
    mocks.queryPending = true;
    mocks.queryError = new ApiClientError({
      code: "dependency_unavailable",
      kind: "api",
      message: "Session dependency unavailable.",
      retryable: true,
      status: 503,
    });
    const root = renderer();
    act(() => {
      root.render(<SessionRoute />);
    });
    expect(renderedText(root.container)).toContain("Loading approved session");
    expect(renderedText(root.container)).toContain("Session dependency unavailable.");
    act(() => {
      (labelled(root.container, "Retry").props.onPress as () => void)();
    });
    expect(mocks.queryRefetch).toHaveBeenCalledOnce();
  });

  it("blocks a session belonging to a different synthetic client", async () => {
    mocks.getSession.mockReturnValue({
      ...session,
      clientId: "00000000-0000-4000-8000-000000000102",
    });
    const root = renderer();
    act(() => {
      root.render(<SessionRoute />);
    });
    await flush();
    expect(renderedText(root.container)).toContain("Session does not belong to this selection");
    expect(
      nodes(
        root.container,
        (node) => node.props.accessibilityLabel === "Save and complete session",
      ),
    ).toHaveLength(0);
  });

  it("shows completed server state without another submission control", async () => {
    mocks.getSession.mockReturnValue({ ...session, status: "completed" });
    const root = renderer();
    act(() => {
      root.render(<SessionRoute />);
    });
    await flush();
    expect(renderedText(root.container)).toContain("Session completed");
    expect(
      nodes(
        root.container,
        (node) => node.props.accessibilityLabel === "Save and complete session",
      ),
    ).toHaveLength(0);
    act(() => {
      (labelled(root.container, "View History").props.onPress as () => void)();
    });
    expect(mocks.replace).toHaveBeenCalledWith("/history");
  });

  it("recovers an opaque session draft failure and preserves input on stale conflict", async () => {
    mocks.sessionRead.mockRejectedValue("opaque restore failure");
    mocks.completeSession.mockRejectedValue(
      new ApiClientError({
        code: "version_conflict",
        kind: "api",
        message: "Published session changed.",
        requestId: "req_session_conflict",
        retryable: false,
        status: 409,
      }),
    );
    const root = renderer();
    act(() => {
      root.render(<SessionRoute />);
    });
    await flush();
    expect(renderedText(root.container)).toContain("Draft could not be restored.");
    act(() => {
      (
        labelled(root.container, "Overall session RPE").props.onChangeText as (
          value: string,
        ) => void
      )("8");
      (labelled(root.container, "Set 1 reps").props.onChangeText as (value: string) => void)("10");
      (labelled(root.container, "Set 1 load kg").props.onChangeText as (value: string) => void)(
        "42.5",
      );
      (labelled(root.container, "Set 1 RPE").props.onChangeText as (value: string) => void)("8");
      (
        labelled(root.container, "Row ergometer intervals, set 1 completed").props
          .onValueChange as (value: boolean) => void
      )(false);
    });
    await act(async () => {
      (labelled(root.container, "Save and complete session").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("This published session changed");
    expect(renderedText(root.container)).toContain("Request ID: req_session_conflict");
    expect(labelled(root.container, "Overall session RPE").props.value).toBe("8");
  });

  it("stops session submission when durable draft persistence fails", async () => {
    mocks.sessionSave.mockRejectedValue(new Error("Session storage is full."));
    const root = renderer();
    act(() => {
      root.render(<SessionRoute />);
    });
    await flush();
    act(() => {
      (
        labelled(root.container, "Overall session RPE").props.onChangeText as (
          value: string,
        ) => void
      )("7");
    });
    await act(async () => {
      (labelled(root.container, "Save and complete session").props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Session storage is full.");
    expect(mocks.logSession).not.toHaveBeenCalled();
  });

  it("renders ranged reps, optional load, and an absent draft exercise safely", async () => {
    const rangedExercise = { ...exercise, loadKg: null, reps: { max: 10, min: 6 } };
    mocks.getSession.mockReturnValue({ ...session, planned: [rangedExercise] });
    const rangedRoot = renderer();
    act(() => {
      rangedRoot.render(<SessionRoute />);
    });
    await flush();
    expect(renderedText(rangedRoot.container)).toContain("Planned reps: 6–10");
    expect(renderedText(rangedRoot.container)).not.toContain("kg prescribed");

    mocks.sessionRead.mockResolvedValue({
      completeKey: `complete:${session.id}`,
      exercises: [],
      expectedVersion: 1,
      logKey: `log:${session.id}`,
      notes: "",
      performedAt: null,
      sessionRpe: "",
    });
    const missingDraftRoot = renderer();
    act(() => {
      missingDraftRoot.render(<SessionRoute />);
    });
    await flush();
    expect(renderedText(missingDraftRoot.container)).not.toContain("Set 1");
    expect(labelled(missingDraftRoot.container, "Overall session RPE")).toBeDefined();
  });

  it("reports Error restoration and opaque autosave failures for session drafts", async () => {
    vi.useFakeTimers();
    try {
      mocks.sessionRead.mockRejectedValue(new Error("Session restore failed."));
      mocks.sessionSave.mockRejectedValue("opaque autosave failure");
      const root = renderer();
      act(() => {
        root.render(<SessionRoute />);
      });
      await flush();
      expect(renderedText(root.container)).toContain("Session restore failed.");
      await act(async () => {
        vi.advanceTimersByTime(251);
        await Promise.resolve();
      });
      expect(renderedText(root.container)).toContain("Draft could not be saved.");
      act(() => {
        root.unmount();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a non-stale session failure and reports an Error cleanup warning", async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error("Session completion offline."));
    mocks.sessionClear.mockRejectedValue(new Error("Completed draft cleanup failed."));
    const root = renderer();
    act(() => {
      root.render(<SessionRoute />);
    });
    await flush();
    fillSessionRpe(root.container, "8");
    await act(async () => {
      (labelled(root.container, "Save and complete session").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Session completion offline.");
    mocks.completeSession.mockResolvedValue({ ...session, status: "completed", version: 3 });
    await act(async () => {
      (labelled(root.container, "Retry").props.onPress as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Session completed");
    expect(renderedText(root.container)).toContain("Completed draft cleanup failed.");
  });

  it("ignores draft restoration that settles after form routes unmount", async () => {
    let resolveCheckIn: ((value: null) => void) | undefined;
    mocks.checkInRead.mockReturnValue(
      new Promise((resolve) => {
        resolveCheckIn = resolve;
      }),
    );
    const checkInRoot = renderer();
    act(() => {
      checkInRoot.render(<CheckInRoute />);
    });
    act(() => {
      checkInRoot.unmount();
    });
    await act(async () => {
      resolveCheckIn?.(null);
      await Promise.resolve();
    });

    let resolveSession: ((value: null) => void) | undefined;
    mocks.sessionRead.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const sessionRoot = renderer();
    act(() => {
      sessionRoot.render(<SessionRoute />);
    });
    act(() => {
      sessionRoot.unmount();
    });
    await act(async () => {
      resolveSession?.(null);
      await Promise.resolve();
    });
    expect(resolveCheckIn).toBeDefined();
    expect(resolveSession).toBeDefined();
  });
});
