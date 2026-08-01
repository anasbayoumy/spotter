import type {
  accountabilityDetailSchema,
  adjustmentSchema,
  clientDetailSchema,
  clientSummarySchema,
  contextTraceSchema,
  inAppMessageSchema,
  programmeReviewSchema,
  programmeSchema,
  reviewBandSchema,
  scorecardSchema,
  sessionSchema,
  todaySchema,
} from "@spotter/contracts";
import type { z } from "zod";

export type AccountabilityDetail = z.infer<typeof accountabilityDetailSchema>;
export type Adjustment = z.infer<typeof adjustmentSchema>;
export type ClientDetail = z.infer<typeof clientDetailSchema>;
export type ClientSummary = z.infer<typeof clientSummarySchema>;
export type ContextTrace = z.infer<typeof contextTraceSchema>;
export type InAppMessage = z.infer<typeof inAppMessageSchema>;
export type Programme = z.infer<typeof programmeSchema>;
export type ProgrammeReview = z.infer<typeof programmeReviewSchema>;
export type ReviewBand = z.infer<typeof reviewBandSchema>;
export type Scorecard = z.infer<typeof scorecardSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Today = z.infer<typeof todaySchema>;
