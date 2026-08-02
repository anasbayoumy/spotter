import { and, count, desc, eq, gt } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_ANCHOR, demoSeedDataset } from "../../../fixtures/demo/index";
import { GenerateProgramme } from "../../src/application/programmes";
import type {
  AgentAuditPort,
  EvaluationPort,
  ModelGatewayPort,
  ProgrammePort,
} from "../../src/application/ports";
import { DatabaseContextAssembler } from "../../src/composition/runtime-adapters";
import {
  DrizzleTraceRepository,
  PgliteDatabaseAdapter,
  contextTraces,
  migratePgliteDatabase,
  seedDemoDatabase,
} from "../../src/infrastructure/database/index";

const blockedClientId = "00000000-0000-4000-8000-000000000102";
const coachId = "00000000-0000-4000-8000-000000000001";
const idempotencyRecordId = "00000000-0000-4000-8000-000000003001";

describe("production hard-constraint overflow evidence", () => {
  let adapter: PgliteDatabaseAdapter;

  beforeEach(async () => {
    adapter = await PgliteDatabaseAdapter.create();
    await migratePgliteDatabase(adapter, "migrations");
    await seedDemoDatabase(adapter.database, demoSeedDataset);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("persists a retrievable overflow trace before surfacing failure and never calls the gateway", async () => {
    const traces = new DrizzleTraceRepository(adapter.database);
    let gatewayCalls = 0;
    let queueCalls = 0;
    let auditCalls = 0;
    let idempotencyFailures = 0;
    const gateway: ModelGatewayPort = {
      draftAccountability: () => Promise.reject(new Error("unused")),
      generateAdjustment: () => Promise.reject(new Error("unused")),
      generateProgramme: () => {
        gatewayCalls += 1;
        return Promise.reject(new Error("Overflow must prevent this call"));
      },
    };
    const evaluation: EvaluationPort = {
      runGates: () => Promise.reject(new Error("Overflow must prevent evaluation")),
      runJudges: () => Promise.reject(new Error("Overflow must prevent evaluation")),
    };
    const audit: AgentAuditPort = {
      recordFailure: () => {
        auditCalls += 1;
        return Promise.resolve();
      },
      recordSuccess: () => {
        auditCalls += 1;
        return Promise.reject(new Error("Overflow must prevent audit"));
      },
    };
    const programmes: ProgrammePort = {
      edit: () => Promise.reject(new Error("unused")),
      getReview: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      publish: () => Promise.reject(new Error("unused")),
      queueGenerated: () => {
        queueCalls += 1;
        return Promise.reject(new Error("Overflow must prevent queueing"));
      },
      reject: () => Promise.reject(new Error("unused")),
    };
    const useCase = new GenerateProgramme({
      assembler: new DatabaseContextAssembler(adapter.database, 1),
      audit,
      evaluation,
      fingerprint: { fingerprint: (value) => JSON.stringify(value) },
      gateway,
      idempotency: {
        claim: () => Promise.resolve({ kind: "claimed", recordId: idempotencyRecordId }),
        complete: () => Promise.resolve(),
        fail: () => {
          idempotencyFailures += 1;
          return Promise.resolve();
        },
      },
      programmes,
      traces,
    });
    const [before] = await adapter.database
      .select({ value: count() })
      .from(contextTraces)
      .where(eq(contextTraces.clientId, blockedClientId));

    await expect(
      useCase.execute(
        { clientId: blockedClientId, targetWeekStart: "2026-08-03" },
        {
          actorId: coachId,
          effectiveAt: DEMO_ANCHOR,
          idempotencyKey: "property-overflow-attempt",
          requestId: "property-overflow-request",
        },
      ),
    ).rejects.toMatchObject({ code: "context_hard_constraints_exceed_budget" });

    const [after] = await adapter.database
      .select({ value: count() })
      .from(contextTraces)
      .where(eq(contextTraces.clientId, blockedClientId));
    const [stored] = await adapter.database
      .select()
      .from(contextTraces)
      .where(
        and(
          eq(contextTraces.clientId, blockedClientId),
          gt(contextTraces.tokenCount, contextTraces.budget),
        ),
      )
      .orderBy(desc(contextTraces.createdAt))
      .limit(1);

    expect(after?.value).toBe((before?.value ?? 0) + 1);
    expect(stored).toBeDefined();
    if (stored === undefined) throw new Error("Expected durable overflow evidence");
    const retrieved = await traces.get(stored.id);
    expect(retrieved).toBeDefined();
    if (retrieved === undefined) throw new Error("Expected retrievable overflow evidence");
    expect(retrieved.tokenCount).toBeGreaterThan(retrieved.budget);
    expect(retrieved.rendered).toBe(stored.rendered);
    expect(retrieved.sections[0]).toMatchObject({ kind: "hard_constraints", pinned: true });
    expect(gatewayCalls).toBe(0);
    expect(queueCalls).toBe(0);
    expect(auditCalls).toBe(0);
    expect(idempotencyFailures).toBe(1);
  });
});
