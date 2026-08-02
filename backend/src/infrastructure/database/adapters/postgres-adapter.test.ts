import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { migratePostgresDatabase } from "../migrate";
import { PostgresDatabaseAdapter } from "./postgres-adapter";

vi.mock("postgres", () => ({ default: vi.fn() }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn() }));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: vi.fn() }));

const postgresMock = vi.mocked(postgres);
const drizzleMock = vi.mocked(drizzle);
const migrateMock = vi.mocked(migrate);

interface FakeDatabase {
  readonly execute: Mock<(...parameters: unknown[]) => Promise<unknown>>;
  readonly transaction: Mock<(work: (value: unknown) => Promise<unknown>) => Promise<unknown>>;
}

function callableClient(): { readonly client: Sql; readonly end: ReturnType<typeof vi.fn> } {
  const end = vi.fn(() => Promise.resolve());
  const client = Object.assign(vi.fn(), { end });
  // `postgres` exposes a callable object with a broad fluent surface. The adapter only uses `end`,
  // while query execution is verified through the mocked Drizzle boundary below.
  return { client: client as unknown as Sql, end };
}

function fakeDatabase(): FakeDatabase {
  return {
    execute: vi.fn<(...parameters: unknown[]) => Promise<unknown>>(),
    transaction: vi.fn<(work: (value: unknown) => Promise<unknown>) => Promise<unknown>>(),
  };
}

describe("Postgres database adapter boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects with bounded defaults and permits an explicit option override", () => {
    const { client } = callableClient();
    const database = fakeDatabase();
    postgresMock.mockReturnValue(client);
    drizzleMock.mockReturnValue(database as never);

    const adapter = PostgresDatabaseAdapter.connect("postgresql://synthetic@localhost/spotter");
    PostgresDatabaseAdapter.connect("postgresql://synthetic@localhost/spotter", { max: 3 });

    expect(postgresMock).toHaveBeenNthCalledWith(1, "postgresql://synthetic@localhost/spotter", {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 32,
      max_lifetime: 1_800,
      prepare: false,
    });
    expect(postgresMock).toHaveBeenNthCalledWith(2, "postgresql://synthetic@localhost/spotter", {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 3,
      max_lifetime: 1_800,
      prepare: false,
    });
    expect(drizzleMock).toHaveBeenCalledTimes(2);
    expect(drizzleMock.mock.calls[0]?.[0]).toBe(client);
    expect(drizzleMock.mock.calls[0]?.[1]).toHaveProperty("schema");
    expect(adapter.capabilities).toEqual({
      advisoryLocks: true,
      authoritative: true,
      concurrentTransactions: true,
      hnswVectorIndex: true,
    });
  });

  it("maps complete and absent version rows into stable readiness health", async () => {
    const { client } = callableClient();
    const database = fakeDatabase();
    drizzleMock.mockReturnValue(database as never);
    const adapter = new PostgresDatabaseAdapter(client);
    database.execute.mockResolvedValueOnce([
      { migration_version: "migration-hash", pg_version: "16.4", vector_version: "0.7.4" },
    ]);
    database.execute.mockResolvedValueOnce([]);

    await expect(adapter.healthCheck()).resolves.toEqual({
      dialect: "postgres",
      migrationVersion: "migration-hash",
      ok: true,
      pgVersion: "16.4",
      vectorVersion: "0.7.4",
    });
    await expect(adapter.healthCheck()).resolves.toEqual({
      dialect: "postgres",
      migrationVersion: null,
      ok: false,
      pgVersion: "unknown",
      vectorVersion: null,
    });
  });

  it("delegates transaction, migration, and bounded close semantics", async () => {
    const { client, end } = callableClient();
    const database = fakeDatabase();
    drizzleMock.mockReturnValue(database as never);
    const adapter = new PostgresDatabaseAdapter(client);
    const transaction = { marker: "transaction" };
    database.transaction.mockImplementation((work: (value: unknown) => Promise<unknown>) =>
      work(transaction),
    );

    await expect(
      adapter.transaction((session) => Promise.resolve(Object.is(session, transaction))),
    ).resolves.toBe(true);
    await migratePostgresDatabase(adapter, "/synthetic/migrations");
    expect(migrateMock).toHaveBeenCalledWith(database, {
      migrationsFolder: "/synthetic/migrations",
    });
    await adapter.close();
    expect(end).toHaveBeenCalledWith({ timeout: 5 });
  });
});
