import type { DatabaseAdapter, DatabaseCapabilities, DatabaseSession } from "./database-types.js";

export interface UnitOfWork {
  readonly capabilities: DatabaseCapabilities;
  run<T>(work: (database: DatabaseSession) => Promise<T>): Promise<T>;
}

export class DrizzleUnitOfWork implements UnitOfWork {
  readonly capabilities: DatabaseCapabilities;
  private readonly adapter: DatabaseAdapter;

  constructor(adapter: DatabaseAdapter) {
    this.adapter = adapter;
    this.capabilities = adapter.capabilities;
  }

  run<T>(work: (database: DatabaseSession) => Promise<T>): Promise<T> {
    return this.adapter.transaction(work);
  }
}
