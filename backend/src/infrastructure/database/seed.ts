import type { InferInsertModel } from "drizzle-orm";

import type { DatabaseSession } from "./database-types.js";
import {
  accountabilityStates,
  adjustments,
  agentRuns,
  appEvents,
  checkIns,
  clientConstraints,
  clientNotes,
  clients,
  coachActions,
  coaches,
  contextTraces,
  engagementScores,
  evalResults,
  messageGuards,
  messages,
  programmes,
  sessions,
} from "./schema.js";

export interface DemoSeedDataset {
  readonly accountabilityStates: readonly InferInsertModel<typeof accountabilityStates>[];
  readonly adjustments: readonly InferInsertModel<typeof adjustments>[];
  readonly agentRuns: readonly InferInsertModel<typeof agentRuns>[];
  readonly appEvents: readonly InferInsertModel<typeof appEvents>[];
  readonly checkIns: readonly InferInsertModel<typeof checkIns>[];
  readonly clientConstraints: readonly InferInsertModel<typeof clientConstraints>[];
  readonly clientNotes: readonly InferInsertModel<typeof clientNotes>[];
  readonly clients: readonly InferInsertModel<typeof clients>[];
  readonly coachActions: readonly InferInsertModel<typeof coachActions>[];
  readonly coaches: readonly InferInsertModel<typeof coaches>[];
  readonly contextTraces: readonly InferInsertModel<typeof contextTraces>[];
  readonly engagementScores: readonly InferInsertModel<typeof engagementScores>[];
  readonly evalResults: readonly InferInsertModel<typeof evalResults>[];
  readonly messageGuards: readonly InferInsertModel<typeof messageGuards>[];
  readonly messages: readonly InferInsertModel<typeof messages>[];
  readonly programmes: readonly InferInsertModel<typeof programmes>[];
  readonly sessions: readonly InferInsertModel<typeof sessions>[];
}

export interface DemoSeedSummary {
  readonly clients: number;
  readonly programmes: number;
  readonly sessions: number;
  readonly traces: number;
}

export async function seedDemoDatabase(
  database: DatabaseSession,
  dataset: DemoSeedDataset,
): Promise<DemoSeedSummary> {
  await database.transaction(async (transaction) => {
    if (dataset.coaches.length > 0)
      await transaction
        .insert(coaches)
        .values([...dataset.coaches])
        .onConflictDoNothing();
    if (dataset.clients.length > 0)
      await transaction
        .insert(clients)
        .values([...dataset.clients])
        .onConflictDoNothing();
    if (dataset.clientConstraints.length > 0)
      await transaction
        .insert(clientConstraints)
        .values([...dataset.clientConstraints])
        .onConflictDoNothing();
    if (dataset.clientNotes.length > 0)
      await transaction
        .insert(clientNotes)
        .values([...dataset.clientNotes])
        .onConflictDoNothing();
    if (dataset.contextTraces.length > 0)
      await transaction
        .insert(contextTraces)
        .values([...dataset.contextTraces])
        .onConflictDoNothing();
    if (dataset.agentRuns.length > 0)
      await transaction
        .insert(agentRuns)
        .values([...dataset.agentRuns])
        .onConflictDoNothing();
    if (dataset.evalResults.length > 0)
      await transaction
        .insert(evalResults)
        .values([...dataset.evalResults])
        .onConflictDoNothing();
    if (dataset.programmes.length > 0)
      await transaction
        .insert(programmes)
        .values([...dataset.programmes])
        .onConflictDoNothing();
    if (dataset.sessions.length > 0)
      await transaction
        .insert(sessions)
        .values([...dataset.sessions])
        .onConflictDoNothing();
    if (dataset.checkIns.length > 0)
      await transaction
        .insert(checkIns)
        .values([...dataset.checkIns])
        .onConflictDoNothing();
    if (dataset.appEvents.length > 0)
      await transaction
        .insert(appEvents)
        .values([...dataset.appEvents])
        .onConflictDoNothing();
    if (dataset.adjustments.length > 0)
      await transaction
        .insert(adjustments)
        .values([...dataset.adjustments])
        .onConflictDoNothing();
    if (dataset.engagementScores.length > 0)
      await transaction
        .insert(engagementScores)
        .values([...dataset.engagementScores])
        .onConflictDoNothing();
    if (dataset.accountabilityStates.length > 0)
      await transaction
        .insert(accountabilityStates)
        .values([...dataset.accountabilityStates])
        .onConflictDoNothing();
    if (dataset.messageGuards.length > 0)
      await transaction
        .insert(messageGuards)
        .values([...dataset.messageGuards])
        .onConflictDoNothing();
    if (dataset.messages.length > 0)
      await transaction
        .insert(messages)
        .values([...dataset.messages])
        .onConflictDoNothing();
    if (dataset.coachActions.length > 0)
      await transaction
        .insert(coachActions)
        .values([...dataset.coachActions])
        .onConflictDoNothing();
  });

  return {
    clients: dataset.clients.length,
    programmes: dataset.programmes.length,
    sessions: dataset.sessions.length,
    traces: dataset.contextTraces.length,
  };
}
