import { act } from "react";
import React from "react";
import { createRoot, type Root, type TestInstance } from "test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearSelection: vi.fn().mockResolvedValue(undefined),
  data: undefined as unknown,
  push: vi.fn(),
  replace: vi.fn(),
  selectClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.data, error: null, isPending: false }),
}));
vi.mock("expo-router", () => ({
  router: { push: mocks.push, replace: mocks.replace },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children, ...props }: { readonly children?: React.ReactNode }) =>
    React.createElement("SafeAreaView", props, children),
}));
vi.mock("../../src/features/client-selector/SelectionProvider", () => ({
  useClientSelection: () => ({
    clearSelection: mocks.clearSelection,
    clientId: "00000000-0000-4000-8000-000000000101",
    loading: false,
    selectClient: mocks.selectClient,
  }),
}));

import HistoryRoute from "../../src/app/(tabs)/history";
import TodayRoute from "../../src/app/(tabs)/today";
import SelectClientRoute from "../../src/app/select-client";

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
  sets: 4,
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

function text(root: TestInstance): string {
  return root.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

function firstNode(matches: readonly TestInstance[], label: string): TestInstance {
  const match = matches[0];
  if (match === undefined) throw new Error(`${label} was not rendered.`);
  return match;
}

beforeEach(() => {
  mocks.data = undefined;
});

describe("QA-MOB-001 native route components", () => {
  it("selects a synthetic client from labelled 72px targets", async () => {
    mocks.data = [
      {
        goals: { primary: "Build consistent training", secondary: [], targetDate: null },
        handle: "c_001",
        id: "00000000-0000-4000-8000-000000000101",
      },
    ];
    const root = renderer();
    act(() => {
      root.render(<SelectClientRoute />);
    });
    const select = firstNode(
      nodes(root.container, (node) => node.props.accessibilityLabel === "Select c_001"),
      "Select c_001",
    );
    expect(select.props.accessibilityRole).toBe("button");
    expect(select.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ minHeight: 72 })]),
    );
    await act(async () => {
      (select.props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(mocks.selectClient).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000101");
    expect(mocks.replace).toHaveBeenCalledWith("/today");
  });

  it("renders only a current approved Today session and opens its log", () => {
    mocks.data = {
      clientId: session.clientId,
      localDate: "2026-08-03",
      nextSession: null,
      outstandingMessage: null,
      programme: { id: session.programmeId },
      session,
      timezone: "Africa/Cairo",
    };
    const root = renderer();
    act(() => {
      root.render(<TodayRoute />);
    });
    expect(text(root.container)).toContain("Only the current coach-published plan is shown here.");
    expect(text(root.container)).toContain("Row ergometer intervals");
    const open = firstNode(
      nodes(root.container, (node) => node.props.accessibilityLabel === "Open session log"),
      "Open session log",
    );
    (open.props.onPress as () => void)();
    expect(mocks.push).toHaveBeenCalledWith({
      params: { sessionId: session.id },
      pathname: "/session/[sessionId]",
    });
  });

  it("distinguishes completed and missed History while excluding planned sessions", () => {
    mocks.data = [
      { ...session, id: "00000000-0000-4000-8000-000000000711", rpe: 7, status: "completed" },
      { ...session, id: "00000000-0000-4000-8000-000000000712", status: "missed" },
      session,
    ];
    const root = renderer();
    act(() => {
      root.render(<HistoryRoute />);
    });
    const rendered = text(root.container);
    expect(rendered).toContain("Completed · Session RPE 7");
    expect(rendered).toContain("Missed after its due date");
    expect(rendered).not.toContain("scheduled");
  });
});
