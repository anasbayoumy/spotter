import { eq, sql } from "drizzle-orm";

import type { UnitOfWork } from "../unit-of-work.js";
import { accountabilityStates, messageGuards, messages } from "../schema.js";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export interface AutomatedMessageInput {
  readonly id: string;
  readonly clientId: string;
  readonly engagementScoreId?: string;
  readonly tier: 1 | 2;
  readonly body: string;
  readonly attemptedAt: Date;
}

export type AutomatedMessageResult =
  | { readonly status: "sent"; readonly messageId: string }
  | { readonly status: "suppressed"; readonly messageId: string; readonly reason: string };

export class AccountabilityRepository {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  runAutomatedMessageDecision(input: AutomatedMessageInput): Promise<AutomatedMessageResult> {
    return this.unitOfWork.run(async (database) => {
      await database
        .insert(messageGuards)
        .values({ clientId: input.clientId })
        .onConflictDoNothing();
      await database.execute(
        sql`SELECT client_id FROM message_guards WHERE client_id = ${input.clientId} FOR UPDATE`,
      );

      const guard = await database.query.messageGuards.findFirst({
        where: eq(messageGuards.clientId, input.clientId),
      });
      const state = await database.query.accountabilityStates.findFirst({
        where: eq(accountabilityStates.clientId, input.clientId),
      });

      const humanOwned = state?.owner === "coach" || (state?.tier ?? 0) >= 3;
      const recent =
        guard?.lastAutomatedSentAt !== null && guard?.lastAutomatedSentAt !== undefined
          ? input.attemptedAt.getTime() - guard.lastAutomatedSentAt.getTime() < FORTY_EIGHT_HOURS_MS
          : false;
      const reason = humanOwned
        ? "human_owned_escalation"
        : recent
          ? "automated_message_within_48h"
          : null;

      if (reason !== null) {
        await database.insert(messages).values({
          actor: "automation",
          body: input.body,
          clientId: input.clientId,
          engagementScoreId: input.engagementScoreId,
          id: input.id,
          status: "suppressed",
          suppressedAt: input.attemptedAt,
          suppressionReason: reason,
          tier: input.tier,
        });
        return { messageId: input.id, reason, status: "suppressed" };
      }

      await database.insert(messages).values({
        actor: "automation",
        body: input.body,
        clientId: input.clientId,
        engagementScoreId: input.engagementScoreId,
        id: input.id,
        sentAt: input.attemptedAt,
        status: "sent",
        tier: input.tier,
      });
      await database
        .update(messageGuards)
        .set({ lastAutomatedSentAt: input.attemptedAt, version: sql`${messageGuards.version} + 1` })
        .where(eq(messageGuards.clientId, input.clientId));
      return { messageId: input.id, status: "sent" };
    });
  }
}
