import { z } from "zod";

export const calibrationLabelsSchema = z
  .object({
    schemaVersion: z.literal(1),
    labelSource: z.enum(["pending_human_review", "human_reviewed_synthetic"]),
    generatorModel: z.string().trim().min(1).max(200).nullable(),
    judgeModel: z.string().trim().min(1).max(200).nullable(),
    labels: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(120),
            recordingId: z.string().trim().min(1).max(120),
            judge: z.enum(["grounding", "coherence", "consistency", "intervention"]),
            score: z.number().int().min(1).max(5),
            rationale: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.labelSource === "pending_human_review" && value.labels.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Pending human review cannot contain scored labels",
        path: ["labels"],
      });
    }
    if (value.labelSource === "human_reviewed_synthetic" && value.labels.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Human-reviewed calibration requires at least one label",
        path: ["labels"],
      });
    }
    if (value.labels.length > 0 && (value.generatorModel === null || value.judgeModel === null)) {
      context.addIssue({
        code: "custom",
        message: "Scored labels require generator and judge model identifiers",
        path: ["generatorModel"],
      });
    }
    if (
      value.generatorModel !== null &&
      value.judgeModel !== null &&
      value.generatorModel === value.judgeModel
    ) {
      context.addIssue({
        code: "custom",
        message: "Generator and judge models must be independent",
        path: ["judgeModel"],
      });
    }
    const ids = new Set<string>();
    for (const [index, label] of value.labels.entries()) {
      if (ids.has(label.id)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate calibration label",
          path: ["labels", index, "id"],
        });
      }
      ids.add(label.id);
    }
  });
