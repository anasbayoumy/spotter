import AsyncStorage from "@react-native-async-storage/async-storage";
import type { z } from "zod";

export class LocalStorageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalStorageError";
  }
}

export async function readValidatedStorage<T extends z.ZodType>(
  key: string,
  schema: T,
): Promise<z.infer<T> | null> {
  let stored: string | null;
  try {
    stored = await AsyncStorage.getItem(key);
  } catch {
    throw new LocalStorageError("Local demo data could not be read.");
  }
  if (stored === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    await removeStorage(key);
    throw new LocalStorageError("Invalid local demo data was cleared safely.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    await removeStorage(key);
    throw new LocalStorageError("Outdated local demo data was cleared safely.");
  }
  return parsed.data;
}

export async function writeStorage(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new LocalStorageError("Local demo data could not be saved.");
  }
}

export async function removeStorage(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    throw new LocalStorageError("Local demo data could not be cleared.");
  }
}
