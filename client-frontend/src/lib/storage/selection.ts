import { uuidSchema } from "@spotter/contracts";
import { z } from "zod";

import { readValidatedStorage, removeStorage, writeStorage } from "./json-storage";

const SELECTION_KEY = "spotter.demo.selected-client.v1";
const selectionSchema = z.object({ clientId: uuidSchema }).strict();

export async function readSelectedClientId(): Promise<string | null> {
  return (await readValidatedStorage(SELECTION_KEY, selectionSchema))?.clientId ?? null;
}

export async function storeSelectedClientId(clientId: string): Promise<void> {
  const selection = selectionSchema.parse({ clientId });
  await writeStorage(SELECTION_KEY, selection);
}

export async function clearSelectedClientId(): Promise<void> {
  await removeStorage(SELECTION_KEY);
}
