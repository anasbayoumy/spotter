import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  removeItem: vi.fn<(key: string) => Promise<void>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("@react-native-async-storage/async-storage", (): object => ({ default: storage }));

import {
  LocalStorageError,
  readValidatedStorage,
  removeStorage,
  writeStorage,
} from "./json-storage";

const schema = z.object({ count: z.number().int() }).strict();

beforeEach(() => {
  storage.getItem.mockReset();
  storage.removeItem.mockReset();
  storage.setItem.mockReset();
  storage.removeItem.mockResolvedValue();
  storage.setItem.mockResolvedValue();
});

describe("validated local JSON storage", () => {
  it("returns null for a missing value and parses a valid value", async () => {
    storage.getItem.mockResolvedValueOnce(null).mockResolvedValueOnce('{"count":2}');
    await expect(readValidatedStorage("draft", schema)).resolves.toBeNull();
    await expect(readValidatedStorage("draft", schema)).resolves.toEqual({ count: 2 });
  });

  it("clears malformed JSON and reports the recovery", async () => {
    storage.getItem.mockResolvedValue("{not-json");
    await expect(readValidatedStorage("draft", schema)).rejects.toThrow(
      "Invalid local demo data was cleared safely.",
    );
    expect(storage.removeItem).toHaveBeenCalledWith("draft");
  });

  it("clears schema-invalid or outdated values", async () => {
    storage.getItem.mockResolvedValue('{"count":"two"}');
    await expect(readValidatedStorage("draft", schema)).rejects.toThrow(
      "Outdated local demo data was cleared safely.",
    );
    expect(storage.removeItem).toHaveBeenCalledWith("draft");
  });

  it("sanitizes read failures as LocalStorageError", async () => {
    storage.getItem.mockRejectedValue(new Error("native storage internals"));
    await expect(readValidatedStorage("draft", schema)).rejects.toEqual(
      expect.objectContaining({
        message: "Local demo data could not be read.",
        name: "LocalStorageError",
      }),
    );
  });

  it("serializes writes and sanitizes write failures", async () => {
    await writeStorage("draft", { count: 3 });
    expect(storage.setItem).toHaveBeenCalledWith("draft", '{"count":3}');

    storage.setItem.mockRejectedValueOnce(new Error("quota details"));
    await expect(writeStorage("draft", { count: 4 })).rejects.toBeInstanceOf(LocalStorageError);
    await expect(writeStorage("draft", { count: 4 })).resolves.toBeUndefined();
  });

  it("removes values and sanitizes remove failures", async () => {
    await expect(removeStorage("draft")).resolves.toBeUndefined();
    expect(storage.removeItem).toHaveBeenCalledWith("draft");

    storage.removeItem.mockRejectedValueOnce(new Error("native details"));
    await expect(removeStorage("draft")).rejects.toThrow("Local demo data could not be cleared.");
  });
});
