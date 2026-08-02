import { createCheckInRequestSchema, limits } from "@spotter/contracts";
import { z } from "zod";

import { createIdempotencyKey } from "../../lib/api/idempotency";
import { readValidatedStorage, removeStorage, writeStorage } from "../../lib/storage/json-storage";

export const checkInDraftSchema = z
  .object({
    body: z.string().max(limits.longText),
    idempotencyKey: z.string().min(8).max(128),
    payloadFingerprint: z.string().nullable().default(null),
    readiness: z.number().int().min(1).max(5).nullable(),
    respondedAt: z.string().nullable(),
  })
  .strict();
export type CheckInDraft = z.infer<typeof checkInDraftSchema>;

function storageKey(clientId: string): string {
  return `spotter.demo.check-in-draft.v1:${clientId}`;
}

export function createCheckInDraft(clientId: string): CheckInDraft {
  return {
    body: "",
    idempotencyKey: createIdempotencyKey("check-in", clientId),
    payloadFingerprint: null,
    readiness: null,
    respondedAt: null,
  };
}

export function validateCheckInDraft(
  clientId: string,
  draft: CheckInDraft,
): ReturnType<typeof createCheckInRequestSchema.safeParse> {
  return createCheckInRequestSchema.safeParse({
    body: draft.body,
    clientId,
    readiness: draft.readiness,
    respondedAt: draft.respondedAt ?? new Date().toISOString(),
  });
}

export async function readCheckInDraft(clientId: string): Promise<CheckInDraft | null> {
  return readValidatedStorage(storageKey(clientId), checkInDraftSchema);
}

export async function saveCheckInDraft(clientId: string, draft: CheckInDraft): Promise<void> {
  await writeStorage(storageKey(clientId), checkInDraftSchema.parse(draft));
}

export async function clearCheckInDraft(clientId: string): Promise<void> {
  await removeStorage(storageKey(clientId));
}
