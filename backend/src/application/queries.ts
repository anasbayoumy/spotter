import type {
  AccountabilityDetail,
  Adjustment,
  ClientDetail,
  ClientSummary,
  ContextTrace,
  InAppMessage,
  Programme,
  ProgrammeReview,
  ReviewBand,
  Scorecard,
  Session,
  Today,
} from "./read-models.js";

import { ApplicationError } from "./core.js";
import type {
  AccountabilityPort,
  AdjustmentPort,
  ClientReadPort,
  ProgrammePort,
  ScorecardPort,
  SessionPort,
  TracePort,
} from "./ports.js";

export class ListDemoClients {
  public constructor(private readonly clients: ClientReadPort) {}
  public execute(): Promise<readonly ClientSummary[]> {
    return this.clients.listSyntheticActive();
  }
}

export class GetClientDetail {
  public constructor(private readonly clients: ClientReadPort) {}
  public async execute(clientId: string, effectiveAt: Date): Promise<ClientDetail> {
    const value = await this.clients.getDetail(clientId, effectiveAt);
    if (value === undefined)
      throw new ApplicationError("client_not_found", "Client does not exist.");
    return value;
  }
}

export class GetClientToday {
  public constructor(private readonly clients: ClientReadPort) {}
  public async execute(clientId: string, effectiveAt: Date): Promise<Today> {
    const value = await this.clients.getToday(clientId, effectiveAt);
    if (value === undefined)
      throw new ApplicationError("client_not_found", "Client does not exist.");
    if (value.programme !== null && value.programme.status !== "published") {
      throw new ApplicationError("internal_error", "Client-visible programme invariant failed.");
    }
    return value;
  }
}

export class ListClientMessages {
  public constructor(private readonly clients: ClientReadPort) {}
  public execute(clientId: string): Promise<readonly InAppMessage[]> {
    return this.clients.listVisibleMessages(clientId);
  }
}

export class ListProgrammes {
  public constructor(private readonly programmes: ProgrammePort) {}
  public execute(input: {
    readonly clientId?: string;
    readonly status?: string;
    readonly band?: ReviewBand;
  }): Promise<readonly Programme[]> {
    return this.programmes.list(input);
  }
}

export class GetProgrammeReview {
  public constructor(private readonly programmes: ProgrammePort) {}
  public async execute(programmeId: string): Promise<ProgrammeReview> {
    const value = await this.programmes.getReview(programmeId);
    if (value === undefined)
      throw new ApplicationError("programme_not_found", "Programme does not exist.");
    return value;
  }
}

export class ListSessions {
  public constructor(private readonly sessions: SessionPort) {}
  public execute(input: {
    readonly clientId: string;
    readonly from?: string;
    readonly to?: string;
  }): Promise<readonly Session[]> {
    return this.sessions.list(input);
  }
}

export class GetSession {
  public constructor(private readonly sessions: SessionPort) {}
  public async execute(sessionId: string): Promise<Session> {
    const value = await this.sessions.get(sessionId);
    if (value === undefined) throw new ApplicationError("not_found", "Session does not exist.");
    return value;
  }
}

export class ListAdjustments {
  public constructor(private readonly adjustments: AdjustmentPort) {}
  public execute(input: {
    readonly clientId?: string;
    readonly status?: string;
  }): Promise<readonly Adjustment[]> {
    return this.adjustments.list(input);
  }
}

export class GetAccountabilityState {
  public constructor(private readonly accountability: AccountabilityPort) {}
  public async execute(clientId: string): Promise<AccountabilityDetail> {
    const value = await this.accountability.get(clientId);
    if (value === undefined)
      throw new ApplicationError("client_not_found", "Client does not exist.");
    return value;
  }
}

export class GetContextTrace {
  public constructor(private readonly traces: TracePort) {}
  public async execute(traceId: string): Promise<ContextTrace> {
    const value = await this.traces.get(traceId);
    if (value === undefined) throw new ApplicationError("not_found", "Trace does not exist.");
    return value;
  }
}

export class GetScorecard {
  public constructor(private readonly scorecard: ScorecardPort) {}
  public execute(): Promise<Scorecard> {
    return this.scorecard.get();
  }
}
