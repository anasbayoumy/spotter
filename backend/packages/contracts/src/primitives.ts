import { z } from "zod";

export const limits = {
  shortText: 160,
  mediumText: 1_000,
  longText: 4_000,
  pageSize: 100,
  exercisesPerDay: 20,
  programmeDays: 14,
  setsPerExercise: 20,
  citations: 100,
} as const;

export const uuidSchema = z.uuid();
export const requestIdSchema = z.string().min(8).max(128);
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency keys contain unsupported characters");
export const isoInstantSchema = z.iso.datetime({ offset: true });
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  }, "Invalid calendar date");
export const ianaTimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone");
export const clientHandleSchema = z.string().regex(/^c_[a-z0-9_]{3,32}$/);
export const nonBlankTextSchema = z.string().trim().min(1).max(limits.mediumText);
export const optionalNoteSchema = z.string().trim().max(limits.longText).nullable();
export const pageLimitSchema = z.coerce.number().int().min(1).max(limits.pageSize).default(25);
export const cursorSchema = z.string().min(1).max(512).optional();

export type UUID = z.infer<typeof uuidSchema>;
export type ISOInstant = z.infer<typeof isoInstantSchema>;
export type ISODate = z.infer<typeof isoDateSchema>;
