import { act } from "react";
import React from "react";
import { createRoot, type Root, type TestInstance } from "test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearSelection: vi.fn().mockResolvedValue(undefined),
  getToday: vi.fn().mockResolvedValue(undefined),
  listActiveClients: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  push: vi.fn(),
  query: {
    data: undefined as unknown,
    error: null as unknown,
    isPending: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  },
  queryFn: null as (() => unknown) | null,
  replace: vi.fn(),
  selectClient: vi.fn().mockResolvedValue(undefined),
  selection: {
    clientId: "00000000-0000-4000-8000-000000000101" as string | null,
    error: null as string | null,
    loading: false,
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { readonly queryFn: () => unknown }) => {
    mocks.queryFn = options.queryFn;
    return mocks.query;
  },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({
  default: (props: Record<string, unknown>) => React.createElement("Ionicons", props),
}));
vi.mock("expo-router", () => {
  const Tabs = ({
    children,
    screenOptions,
  }: {
    readonly children?: React.ReactNode;
    readonly screenOptions?: unknown;
  }): React.ReactElement => React.createElement("Tabs", { screenOptions }, children);
  Tabs.Screen = ({ name, options }: { readonly name: string; readonly options?: unknown }) =>
    React.createElement("TabScreen", { name, options });
  return {
    Redirect: ({ href }: { readonly href: string }) => React.createElement("Redirect", { href }),
    Tabs,
    router: { push: mocks.push, replace: mocks.replace },
  };
});
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children, ...props }: { readonly children?: React.ReactNode }) =>
    React.createElement("SafeAreaView", props, children),
}));
vi.mock("../../src/features/client-selector/SelectionProvider", () => ({
  useClientSelection: () => ({
    clearSelection: mocks.clearSelection,
    clientId: mocks.selection.clientId,
    error: mocks.selection.error,
    loading: mocks.selection.loading,
    selectClient: mocks.selectClient,
  }),
}));
vi.mock("../../src/lib/api/client", () => ({
  clientApi: {
    getToday: mocks.getToday,
    listActiveClients: mocks.listActiveClients,
    listSessions: mocks.listSessions,
  },
}));

import HistoryRoute from "../../src/app/(tabs)/history";
import TabsLayout, { TabBarIcon } from "../../src/app/(tabs)/_layout";
import TodayRoute from "../../src/app/(tabs)/today";
import IndexRoute from "../../src/app/index";
import SelectClientRoute from "../../src/app/select-client";
import { ApiClientError } from "../../src/lib/api/errors";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CLIENT_ID = "00000000-0000-4000-8000-000000000101";
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
const programme = {
  approvedAt: "2026-08-02T00:00:00.000Z",
  approvedBy: "00000000-0000-4000-8000-000000000001",
  clientId: CLIENT_ID,
  createdAt: "2026-08-02T00:00:00.000Z",
  generatedBy: "00000000-0000-4000-8000-000000000201",
  id: "00000000-0000-4000-8000-000000000601",
  mesocycle: 1,
  payload: { days: [], summary: "Synthetic published plan." },
  reviewBand: "clear",
  status: "published",
  supersededBy: null,
  validFrom: "2026-08-02T00:00:00.000Z",
  version: 1,
  week: 1,
};
const session = {
  actual: null,
  clientId: CLIENT_ID,
  completedAt: null,
  createdAt: "2026-08-02T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000701",
  notes: null,
  performedAt: null,
  planned: [exercise],
  programmeId: programme.id,
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

function renderedText(root: TestInstance): string {
  return root.children
    .map((child) => (typeof child === "string" ? child : renderedText(child)))
    .join("");
}

function labelled(root: TestInstance, label: string): TestInstance {
  const match = nodes(root, (node) => node.props.accessibilityLabel === label)[0];
  if (match === undefined) throw new Error(`${label} was not rendered.`);
  return match;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.clearSelection.mockReset().mockResolvedValue(undefined);
  mocks.getToday.mockReset().mockResolvedValue(undefined);
  mocks.listActiveClients.mockReset().mockResolvedValue([]);
  mocks.listSessions.mockReset().mockResolvedValue([]);
  mocks.push.mockReset();
  mocks.query.data = undefined;
  mocks.query.error = null;
  mocks.query.isPending = false;
  mocks.query.refetch.mockReset().mockResolvedValue(undefined);
  mocks.queryFn = null;
  mocks.replace.mockReset();
  mocks.selectClient.mockReset().mockResolvedValue(undefined);
  mocks.selection.clientId = CLIENT_ID;
  mocks.selection.error = null;
  mocks.selection.loading = false;
});

describe("native route branch coverage", () => {
  it("guards Today and History query functions when selection is absent", () => {
    const root = renderer();
    mocks.selection.clientId = null;
    act(() => {
      root.render(<TodayRoute />);
    });
    expect(() => mocks.queryFn?.()).toThrow("A demo client must be selected.");
    act(() => {
      root.render(<HistoryRoute />);
    });
    expect(() => mocks.queryFn?.()).toThrow("A demo client must be selected.");

    mocks.selection.clientId = CLIENT_ID;
    act(() => {
      root.render(<TodayRoute />);
    });
    expect(mocks.queryFn?.()).toBeInstanceOf(Promise);
    expect(mocks.getToday).toHaveBeenCalledWith(CLIENT_ID);
    act(() => {
      root.render(<HistoryRoute />);
    });
    expect(mocks.queryFn?.()).toBeInstanceOf(Promise);
    expect(mocks.listSessions).toHaveBeenCalledWith(CLIENT_ID);
  });

  it("routes index through loading, reset warning, missing, and selected states", () => {
    const root = renderer();
    mocks.selection.loading = true;
    act(() => {
      root.render(<IndexRoute />);
    });
    expect(renderedText(root.container)).toContain("Loading local demo selection");

    mocks.selection.loading = false;
    mocks.selection.error = "Stored selection was corrupt.";
    act(() => {
      root.render(<IndexRoute />);
    });
    expect(renderedText(root.container)).toContain("Local selection was reset");
    expect(nodes(root.container, (node) => node.type === "Redirect")[0]?.props.href).toBe(
      "/select-client",
    );

    mocks.selection.error = null;
    mocks.selection.clientId = null;
    act(() => {
      root.render(<IndexRoute />);
    });
    expect(nodes(root.container, (node) => node.type === "Redirect")[0]?.props.href).toBe(
      "/select-client",
    );
    mocks.selection.clientId = CLIENT_ID;
    act(() => {
      root.render(<IndexRoute />);
    });
    expect(nodes(root.container, (node) => node.type === "Redirect")[0]?.props.href).toBe("/today");
  });

  it("guards tabs only after selection restoration and renders all selected tabs", () => {
    const root = renderer();
    mocks.selection.clientId = null;
    mocks.selection.loading = true;
    act(() => {
      root.render(<TabsLayout />);
    });
    expect(nodes(root.container, (node) => node.type === "Tabs")).toHaveLength(1);

    mocks.selection.loading = false;
    act(() => {
      root.render(<TabsLayout />);
    });
    expect(nodes(root.container, (node) => node.type === "Redirect")[0]?.props.href).toBe(
      "/select-client",
    );
    mocks.selection.clientId = CLIENT_ID;
    act(() => {
      root.render(<TabsLayout />);
    });
    const tabs = nodes(root.container, (node) => node.type === "TabScreen");
    expect(tabs).toHaveLength(3);
    const iconNames = tabs.flatMap((tab) => {
      const icon = (
        tab.props.options as {
          readonly tabBarIcon: (props: {
            readonly color: string;
            readonly focused: boolean;
            readonly size: number;
          }) => React.ReactElement;
        }
      ).tabBarIcon;
      const activeWrapper = icon({ color: "brand", focused: true, size: 30 });
      const inactiveWrapper = icon({
        color: "muted",
        focused: false,
        size: 30,
      });
      const active = TabBarIcon(
        activeWrapper.props as Parameters<typeof TabBarIcon>[0],
      ) as React.ReactElement<{ readonly name: string }>;
      const inactive = TabBarIcon(
        inactiveWrapper.props as Parameters<typeof TabBarIcon>[0],
      ) as React.ReactElement<{ readonly name: string }>;
      return [active.props.name, inactive.props.name];
    });
    expect(iconNames).toEqual([
      "calendar",
      "calendar-outline",
      "time",
      "time-outline",
      "pulse",
      "pulse-outline",
    ]);
  });

  it("renders selector pending, API failure/retry, and empty states", () => {
    const root = renderer();
    mocks.query.isPending = true;
    act(() => {
      root.render(<SelectClientRoute />);
    });
    expect(renderedText(root.container)).toContain("Loading synthetic clients");

    mocks.query.isPending = false;
    mocks.query.error = new Error("Synthetic client API offline.");
    act(() => {
      root.render(<SelectClientRoute />);
    });
    expect(renderedText(root.container)).toContain("Synthetic client API offline.");
    act(() => {
      (labelled(root.container, "Retry").props.onPress as () => void)();
    });
    expect(mocks.query.refetch).toHaveBeenCalledOnce();

    mocks.query.error = null;
    mocks.query.data = [];
    act(() => {
      root.render(<SelectClientRoute />);
    });
    expect(renderedText(root.container)).toContain("No active demo clients");
  });

  it("handles invalid stored selection and selection persistence failures", async () => {
    const root = renderer();
    mocks.query.data = [
      {
        goals: { primary: "Build consistency", secondary: [], targetDate: null },
        handle: "c_002",
        id: "00000000-0000-4000-8000-000000000102",
      },
    ];
    mocks.clearSelection.mockRejectedValue("opaque reset failure");
    act(() => {
      root.render(<SelectClientRoute />);
    });
    await flush();
    expect(renderedText(root.container)).toContain("Selection could not be reset.");

    mocks.selection.clientId = null;
    mocks.selectClient.mockRejectedValue(new Error("Device storage is unavailable."));
    act(() => {
      root.render(<SelectClientRoute />);
    });
    await act(async () => {
      (labelled(root.container, "Select c_002").props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(renderedText(root.container)).toContain("Device storage is unavailable.");

    expect(labelled(root.container, "Select c_002").props.style).toBeDefined();
  });

  it("reports Error reset failures and opaque selection-save failures", async () => {
    const client = {
      goals: { primary: "Build consistency", secondary: [], targetDate: null },
      handle: "c_002",
      id: "00000000-0000-4000-8000-000000000102",
    };
    mocks.query.data = [client];
    mocks.clearSelection.mockRejectedValue(new Error("Stored selection cleanup failed."));
    const invalidRoot = renderer();
    act(() => {
      invalidRoot.render(<SelectClientRoute />);
    });
    await flush();
    expect(renderedText(invalidRoot.container)).toContain("Stored selection cleanup failed.");
    act(() => {
      invalidRoot.unmount();
    });

    mocks.selection.clientId = null;
    mocks.selectClient.mockRejectedValue("opaque save failure");
    const chooseRoot = renderer();
    act(() => {
      chooseRoot.render(<SelectClientRoute />);
    });
    await act(async () => {
      (labelled(chooseRoot.container, "Select c_002").props.onPress as () => void)();
      await Promise.resolve();
    });
    expect(renderedText(chooseRoot.container)).toContain("Selection could not be saved.");
  });

  it("renders Today pending, error/retry, no-plan message, and both rest-day variants", () => {
    const root = renderer();
    mocks.query.isPending = true;
    act(() => {
      root.render(<TodayRoute />);
    });
    expect(renderedText(root.container)).toContain("Loading today's approved plan");

    mocks.query.isPending = false;
    mocks.query.error = new Error("Today failed.");
    act(() => {
      root.render(<TodayRoute />);
    });
    act(() => {
      (labelled(root.container, "Retry").props.onPress as () => void)();
    });
    expect(mocks.query.refetch).toHaveBeenCalledOnce();

    mocks.query.error = null;
    const noProgramme = {
      clientId: CLIENT_ID,
      localDate: "2026-08-03",
      nextSession: null,
      outstandingMessage: {
        actor: "coach",
        body: "Synthetic coach note.",
        clientId: CLIENT_ID,
        createdAt: "2026-08-02T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000901",
        sentAt: "2026-08-02T00:00:00.000Z",
        status: "sent",
        suppressedAt: null,
        suppressionReason: null,
        tier: 1,
      },
      programme: null,
      session: null,
      timezone: "Africa/Cairo",
    };
    mocks.query.data = noProgramme;
    act(() => {
      root.render(<TodayRoute />);
    });
    expect(renderedText(root.container)).toContain("No published plan yet");
    expect(renderedText(root.container)).toContain("Synthetic coach note.");

    const restDay = { ...noProgramme, outstandingMessage: null, programme };
    mocks.query.data = restDay;
    act(() => {
      root.render(<TodayRoute />);
    });
    expect(renderedText(root.container)).toContain("There is no upcoming approved session yet.");
    mocks.query.data = { ...restDay, nextSession: session };
    act(() => {
      root.render(<TodayRoute />);
    });
    expect(renderedText(root.container)).toContain("Next session:");
  });

  it("resets an invalid Today selection on success and reports Error/non-Error reset failures", async () => {
    const invalid = new ApiClientError({
      code: "client_not_found",
      kind: "api",
      message: "Client disappeared.",
      retryable: false,
      status: 404,
    });
    const root = renderer();
    mocks.query.error = invalid;
    act(() => {
      root.render(<TodayRoute />);
    });
    await flush();
    expect(mocks.replace).toHaveBeenCalledWith("/select-client");

    mocks.clearSelection.mockRejectedValue(new Error("Selection database failed."));
    mocks.query.error = new ApiClientError({
      code: "client_not_found",
      kind: "api",
      message: "Client disappeared again.",
      retryable: false,
      status: 404,
    });
    act(() => {
      root.render(<TodayRoute />);
    });
    await flush();
    expect(renderedText(root.container)).toContain("Selection database failed.");

    mocks.clearSelection.mockRejectedValue("opaque");
    mocks.query.error = new ApiClientError({
      code: "not_found",
      kind: "api",
      message: "Missing.",
      retryable: false,
      status: 404,
    });
    act(() => {
      root.render(<TodayRoute />);
    });
    await flush();
    expect(renderedText(root.container)).toContain("invalid local selection could not be reset");
    (labelled(root.container, "Change client").props.onPress as () => void)();
    expect(mocks.push).toHaveBeenCalledWith("/select-client");
  });

  it("renders History pending, error/retry, empty, and completed without RPE", () => {
    const root = renderer();
    mocks.query.isPending = true;
    act(() => {
      root.render(<HistoryRoute />);
    });
    expect(renderedText(root.container)).toContain("Loading session history");

    mocks.query.isPending = false;
    mocks.query.error = new Error("History failed.");
    act(() => {
      root.render(<HistoryRoute />);
    });
    act(() => {
      (labelled(root.container, "Retry").props.onPress as () => void)();
    });
    expect(mocks.query.refetch).toHaveBeenCalledOnce();

    mocks.query.error = null;
    mocks.query.data = [];
    act(() => {
      root.render(<HistoryRoute />);
    });
    expect(renderedText(root.container)).toContain("No completed or missed sessions yet");

    mocks.query.data = [{ ...session, status: "completed" }];
    act(() => {
      root.render(<HistoryRoute />);
    });
    expect(renderedText(root.container)).toContain("Completed");
    expect(renderedText(root.container)).not.toContain("Session RPE");
    (labelled(root.container, "Change client").props.onPress as () => void)();
    expect(mocks.push).toHaveBeenCalledWith("/select-client");
  });
});
