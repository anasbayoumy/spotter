import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ requestJson: vi.fn() }));

vi.mock("./http-client", () => ({ requestJson: http.requestJson }));

import { clientApi } from "./client";

beforeEach(() => {
  http.requestJson.mockReset();
});

describe("client API projection", () => {
  it("keeps only active synthetic records from the public selector response", async () => {
    const activeSynthetic = {
      dataClassification: "synthetic",
      handle: "c_001",
      id: "00000000-0000-4000-8000-000000000101",
      status: "active",
    };
    http.requestJson.mockResolvedValue([
      activeSynthetic,
      { ...activeSynthetic, id: "00000000-0000-4000-8000-000000000102", status: "paused" },
      {
        ...activeSynthetic,
        dataClassification: "sensitive",
        id: "00000000-0000-4000-8000-000000000103",
      },
    ]);
    await expect(clientApi.listActiveClients()).resolves.toEqual([activeSynthetic]);
    expect(http.requestJson).toHaveBeenCalledOnce();
  });
});
