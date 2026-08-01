import {
  apiContracts,
  completeSessionRequestSchema,
  createCheckInRequestSchema,
  logSessionRequestSchema,
  type CheckIn,
  type ClientSummary,
  type Session,
  type Today,
} from "@spotter/contracts";
import type { z } from "zod";

import { assertPublishedToday } from "../../features/today/contract";
import { requestJson } from "./http-client";

export type LogSessionInput = z.input<typeof logSessionRequestSchema>;
export type CompleteSessionInput = z.input<typeof completeSessionRequestSchema>;
export type CreateCheckInInput = z.input<typeof createCheckInRequestSchema>;

function encodeQuery(values: Readonly<Record<string, string>>): string {
  return new URLSearchParams(values).toString();
}

export const clientApi = {
  async checkIn(input: CreateCheckInInput, idempotencyKey: string): Promise<CheckIn> {
    const body = createCheckInRequestSchema.parse(input);
    return requestJson<CheckIn>("/api/v1/check-ins", apiContracts.checkIns.create.output, {
      body,
      idempotencyKey,
      method: "POST",
    });
  },

  async completeSession(
    sessionId: string,
    input: CompleteSessionInput,
    idempotencyKey: string,
  ): Promise<Session> {
    const body = completeSessionRequestSchema.parse(input);
    return requestJson<Session>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/complete`,
      apiContracts.sessions.complete.output,
      { body, idempotencyKey, method: "POST" },
    );
  },

  async getSession(sessionId: string): Promise<Session> {
    return requestJson<Session>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      apiContracts.sessions.detail.output,
    );
  },

  async getToday(clientId: string): Promise<Today> {
    const today = await requestJson<Today>(
      `/api/v1/clients/${encodeURIComponent(clientId)}/today`,
      apiContracts.clients.today.output,
    );
    return assertPublishedToday(today);
  },

  async listActiveClients(): Promise<readonly ClientSummary[]> {
    const clients = await requestJson<ClientSummary[]>(
      `/api/v1/clients?${encodeQuery({ limit: "100", status: "active" })}`,
      apiContracts.clients.list.output,
    );
    return clients.filter(
      (client) => client.status === "active" && client.dataClassification === "synthetic",
    );
  },

  async listSessions(clientId: string): Promise<readonly Session[]> {
    return requestJson<Session[]>(
      `/api/v1/sessions?${encodeQuery({ clientId, limit: "50" })}`,
      apiContracts.sessions.list.output,
    );
  },

  async logSession(
    sessionId: string,
    input: LogSessionInput,
    idempotencyKey: string,
  ): Promise<Session> {
    const body = logSessionRequestSchema.parse(input);
    return requestJson<Session>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/log`,
      apiContracts.sessions.log.output,
      { body, idempotencyKey, method: "POST" },
    );
  },
} as const;
