import { act, useEffect } from "react";
import React from "react";
import { createRoot, type Root, type TestInstance } from "test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clear: vi.fn().mockResolvedValue(undefined),
  read: vi.fn().mockResolvedValue(null),
  store: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/storage/selection", () => ({
  clearSelectedClientId: mocks.clear,
  readSelectedClientId: mocks.read,
  storeSelectedClientId: mocks.store,
}));

import {
  SelectionProvider,
  useClientSelection,
} from "../../src/features/client-selector/SelectionProvider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Selection = ReturnType<typeof useClientSelection>;
let current: Selection | null = null;

function captureSelection(selection: Selection): void {
  current = selection;
}

function Consumer(): React.ReactElement {
  const selection = useClientSelection();
  useEffect(() => {
    captureSelection(selection);
  }, [selection]);
  return React.createElement(
    "SelectionState",
    {
      clientId: selection.clientId,
      error: selection.error,
      loading: selection.loading,
    },
    selection.clientId ?? selection.error ?? "none",
  );
}

function renderer(): Root {
  return createRoot({ textComponentTypes: ["SelectionState"] });
}

function state(root: TestInstance): TestInstance {
  const match = root.queryAll((node) => node.type === "SelectionState", { includeSelf: true })[0];
  if (match === undefined) throw new Error("Selection state was not rendered.");
  return match;
}

async function mount(): Promise<Root> {
  const root = renderer();
  await act(async () => {
    root.render(
      <SelectionProvider>
        <Consumer />
      </SelectionProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return root;
}

beforeEach(() => {
  current = null;
  mocks.clear.mockReset().mockResolvedValue(undefined);
  mocks.read.mockReset().mockResolvedValue(null);
  mocks.store.mockReset().mockResolvedValue(undefined);
});

describe("native client selection provider", () => {
  it("requires a provider", () => {
    const root = renderer();
    expect(() => {
      act(() => {
        root.render(<Consumer />);
      });
    }).toThrow("useClientSelection requires SelectionProvider");
  });

  it("restores, selects, and clears a persisted client", async () => {
    const clientId = "00000000-0000-4000-8000-000000000101";
    mocks.read.mockResolvedValue(clientId);
    const root = await mount();
    expect(state(root.container).props).toMatchObject({ clientId, error: null, loading: false });

    await act(async () => {
      await current?.selectClient("00000000-0000-4000-8000-000000000102");
    });
    expect(mocks.store).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000102");
    expect(state(root.container).props.clientId).toBe("00000000-0000-4000-8000-000000000102");

    await act(async () => {
      await current?.clearSelection();
    });
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(state(root.container).props.clientId).toBeNull();
  });

  it("reports Error and opaque restoration failures", async () => {
    mocks.read.mockRejectedValue(new Error("Selection storage failed."));
    const failed = await mount();
    expect(state(failed.container).props).toMatchObject({
      error: "Selection storage failed.",
      loading: false,
    });
    act(() => {
      failed.unmount();
    });

    mocks.read.mockRejectedValue("opaque");
    const opaque = await mount();
    expect(state(opaque.container).props.error).toBe("Selection unavailable.");
    act(() => {
      opaque.unmount();
    });
  });

  it("ignores a restoration that settles after unmount", async () => {
    let resolve: ((value: string | null) => void) | undefined;
    mocks.read.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const root = renderer();
    act(() => {
      root.render(
        <SelectionProvider>
          <Consumer />
        </SelectionProvider>,
      );
    });
    expect(state(root.container).props.loading).toBe(true);
    act(() => {
      root.unmount();
    });
    await act(async () => {
      resolve?.("00000000-0000-4000-8000-000000000101");
      await Promise.resolve();
    });
    expect(resolve).toBeDefined();
  });
});
