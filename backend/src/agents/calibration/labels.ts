import { z } from "zod";

export const calibrationLabelsSchema = z
  .object({
    schemaVersion: z.literal(1),
    labelSource: z.literal("hand_reviewed_synthetic"),
    generatorModel: z.string().trim().min(1).max(200),
    judgeModel: z.string().trim().min(1).max(200),
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
      .min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.generatorModel === value.judgeModel) {
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
