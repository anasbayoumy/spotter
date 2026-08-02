import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  read: vi.fn(),
  remove: vi.fn(),
  write: vi.fn(),
}));

vi.mock("./json-storage", () => ({
  readValidatedStorage: storage.read,
  removeStorage: storage.remove,
  writeStorage: storage.write,
}));

import { clearSelectedClientId, readSelectedClientId, storeSelectedClientId } from "./selection";

const CLIENT_ID = "00000000-0000-4000-8000-000000000101";

beforeEach(() => {
  storage.read.mockReset();
  storage.remove.mockReset().mockResolvedValue(undefined);
  storage.write.mockReset().mockResolvedValue(undefined);
});

describe("selected client storage", () => {
  it("returns both a selected client and an absent selection", async () => {
    storage.read.mockResolvedValueOnce({ clientId: CLIENT_ID }).mockResolvedValueOnce(null);
    await expect(readSelectedClientId()).resolves.toBe(CLIENT_ID);
    await expect(readSelectedClientId()).resolves.toBeNull();
  });

  it("validates writes and clears the stable selection key", async () => {
    await storeSelectedClientId(CLIENT_ID);
    expect(storage.write).toHaveBeenCalledWith("spotter.demo.selected-client.v1", {
      clientId: CLIENT_ID,
    });
    await clearSelectedClientId();
    expect(storage.remove).toHaveBeenCalledWith("spotter.demo.selected-client.v1");
  });
});
