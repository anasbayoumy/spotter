import {
  checkInSchema,
  sessionSchema,
  type ActualExercise,
  type CheckIn,
  type Session,
} from "@spotter/contracts";

import type { ExecutionContext, FingerprintPort, IdempotencyPort } from "./core.js";
import { executeIdempotently } from "./core.js";
import type { AdjustmentTriggerPort, CheckInPort, RedFlagPort, SessionPort } from "./ports.js";

interface IdempotentDependencies {
  readonly idempotency: IdempotencyPort;
  readonly fingerprint: FingerprintPort;
}

export class LogSessionWork {
  public constructor(
    private readonly sessions: SessionPort,
    private readonly dependencies: IdempotentDependencies,
  ) {}

  public async execute(
    sessionId: string,
    input: {
      readonly clientId: string;
      readonly actual: readonly ActualExercise[];
      readonly notes: string | null;
      readonly expectedVersion: number;
    },
    context: ExecutionContext,
  ): Promise<Session> {
    const result = await executeIdempotently(
      this.dependencies,
      context,
      "session.log",
      { sessionId, ...input },
      () =>
        this.sessions.log({
          sessionId,
          clientId: input.clientId,
          actual: [...input.actual],
          notes: input.notes,
          expectedVersion: input.expectedVersion,
          context,
        }),
    );
    return sessionSchema.parse(result);
  }
}

function completionRatio(session: Session): number {
  const planned = session.planned.reduce((total, exercise) => total + exercise.sets, 0);
  if (planned === 0 || session.actual === null) return 0;
  const completed = session.actual.reduce(
    (total, exercise) => total + exercise.sets.filter((set) => set.completed).length,
    0,
  );
  return Math.min(1, completed / planned);
}

export class CompleteSession {
  public constructor(
    private readonly sessions: SessionPort,
    private readonly triggers: AdjustmentTriggerPort,
    private readonly dependencies: IdempotentDependencies,
  ) {}

  public async execute(
    sessionId: string,
    input: {
      readonly clientId: string;
      readonly rpe: number;
      readonly performedAt: string;
      readonly expectedVersion: number;
    },
    context: ExecutionContext,
  ): Promise<Session> {
    const result = await executeIdempotently(
      this.dependencies,
      context,
      "session.complete",
      { sessionId, ...input },
      async () => {
        const session = sessionSchema.parse(
          await this.sessions.complete({ sessionId, ...input, context }),
        );
        const sourceEventKey = `session:${session.id}:completed:v${String(session.version)}`;
        if (session.rpe !== null && session.rpe >= 9) {
          await this.triggers.request({
            clientId: session.clientId,
            sourceEventKey,
            trigger: { type: "high_rpe", sessionId: session.id, rpe: session.rpe },
            context,
          });
        } else {
          const ratio = completionRatio(session);
          if (ratio <= 0.7) {
            await this.triggers.request({
              clientId: session.clientId,
              sourceEventKey,
              trigger: { type: "low_completion", sessionId: session.id, completionRatio: ratio },
              context,
            });
          }
        }
        return session;
      },
    );
    return sessionSchema.parse(result);
  }
}

export class CreateCheckIn {
  public constructor(
    private readonly checkIns: CheckInPort,
    private readonly redFlags: RedFlagPort,
    private readonly triggers: AdjustmentTriggerPort,
    private readonly dependencies: IdempotentDependencies,
  ) {}

  public async execute(
    input: {
      readonly clientId: string;
      readonly readiness: number;
      readonly body: string;
      readonly respondedAt: string;
    },
    context: ExecutionContext,
  ): Promise<CheckIn> {
    const result = await executeIdempotently(
      this.dependencies,
      context,
      "check-in.create",
      input,
      async () => {
        const requiresHumanEscalation = this.redFlags.hasRedFlag(input.body);
        const checkIn = checkInSchema.parse(
          await this.checkIns.create({ ...input, requiresHumanEscalation, context }),
        );
        const sourceEventKey = `check-in:${checkIn.id}:created`;
        if (requiresHumanEscalation) {
          await this.redFlags.escalate({
            clientId: checkIn.clientId,
            sourceId: checkIn.id,
            context,
          });
        } else if (checkIn.readiness <= 2) {
          await this.triggers.request({
            clientId: checkIn.clientId,
            sourceEventKey,
            trigger: { type: "low_readiness", checkInId: checkIn.id, readiness: checkIn.readiness },
            context,
          });
        }
        return checkIn;
      },
    );
    return checkInSchema.parse(result);
  }
}
