import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

type MockAssemblyResult =
  | Readonly<{ status: "overflow" }>
  | Readonly<{
      status: "ready";
      trace: Readonly<{ id: string; rendered: string }>;
    }>;

interface MockGatewayResponse {
  readonly output: Readonly<{ captured: unknown }>;
  readonly usage: Readonly<{ costUsd: number; inputTokens: number; outputTokens: number }> | null;
}

const state = vi.hoisted(() => ({
  assembleRequests: [] as Record<string, unknown>[],
  assemblyStatus: "ready" as "ready" | "overflow",
  close: vi.fn<() => Promise<void>>(),
  gatewayRequests: [] as Record<string, unknown>[],
  liveFailure: false,
  migrate: vi.fn<(...arguments_: unknown[]) => Promise<void>>(),
  omitRawResponse: false,
  readFile: vi.fn<() => Promise<string>>(),
  rename: vi.fn<(...arguments_: unknown[]) => Promise<void>>(),
  returnNullUsage: false,
  seed: vi.fn<(...arguments_: unknown[]) => Promise<void>>(),
  transportOptions: [] as Record<string, unknown>[],
  writeFile: vi.fn<(...arguments_: unknown[]) => Promise<void>>(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: state.readFile,
  rename: state.rename,
  writeFile: state.writeFile,
}));

vi.mock("../composition/runtime-adapters.js", () => ({
  DatabaseContextAssembler: class {
    public assemble(request: Record<string, unknown>): Promise<MockAssemblyResult> {
      state.assembleRequests.push(request);
      if (state.assemblyStatus === "overflow") return Promise.resolve({ status: "overflow" });
      return Promise.resolve({
        status: "ready",
        trace: {
          id: `trace-${String(request["kind"])}`,
          rendered: `assembled ${String(request["kind"])} context`,
        },
      });
    }
  },
}));

vi.mock("../infrastructure/database/index.js", () => ({
  PgliteDatabaseAdapter: {
    create: vi.fn(() => Promise.resolve({ close: state.close, database: {} })),
  },
  migratePgliteDatabase: state.migrate,
  seedDemoDatabase: state.seed,
}));

vi.mock("../agents/gateway/openai-compatible-transport.js", () => ({
  OpenAICompatibleTransport: class {
    public constructor(public readonly options: Record<string, unknown>) {
      state.transportOptions.push(options);
    }
  },
}));

vi.mock("../agents/gateway/live-gateway.js", () => ({
  LiveModelGateway: class {
    public constructor(
      private readonly transport: { readonly options: Record<string, unknown> },
      private readonly options: { readonly modelId: string },
    ) {}

    public generate(request: Record<string, unknown>): Promise<MockGatewayResponse> {
      state.gatewayRequests.push(request);
      if (state.liveFailure) throw new TypeError("endpoint unreachable");
      const raw = JSON.stringify({ key: request["recordingKey"], model: this.options.modelId });
      if (!state.omitRawResponse) {
        const onRawResponse = this.transport.options["onRawResponse"] as
          | ((response: string) => void)
          | undefined;
        onRawResponse?.(raw);
      }
      return Promise.resolve({
        output: { captured: request["recordingKey"] },
        usage: state.returnNullUsage ? null : { costUsd: 0, inputTokens: 10, outputTokens: 5 },
      });
    }
  },
}));

const fixtureManifest = {
  recordings: [
    { id: "programme-baseline-v1", intent: "programme", key: "programme.baseline" },
    {
      id: "adjustment-low-readiness-v1",
      intent: "adjustment",
      key: "adjustment.low-readiness",
    },
    { id: "accountability-tier-1-v1", intent: "accountability", key: "accountability.tier-1" },
    { id: "accountability-tier-2-v1", intent: "accountability", key: "accountability.tier-2" },
    { id: "accountability-tier-3-v1", intent: "accountability", key: "accountability.tier-3" },
  ],
  schemaVersion: 1,
};

async function runCli(): Promise<void> {
  await import("./record-fixtures.js");
}

describe("record-fixtures CLI", () => {
  beforeEach(() => {
    vi.resetModules();
    state.assembleRequests.length = 0;
    state.gatewayRequests.length = 0;
    state.transportOptions.length = 0;
    state.assemblyStatus = "ready";
    state.liveFailure = false;
    state.omitRawResponse = false;
    state.returnNullUsage = false;
    for (const mock of [
      state.close,
      state.migrate,
      state.readFile,
      state.rename,
      state.seed,
      state.writeFile,
    ]) {
      mock.mockReset();
    }
    state.readFile.mockResolvedValue(JSON.stringify(fixtureManifest));
    process.env["SPOTTER_GENERATOR_MODEL"] = "generator-a";
    process.env["SPOTTER_MODEL_API_KEY"] = "test-key";
    process.env["SPOTTER_MODEL_BASE_URL"] = "http://model.test/v1/";
    process.env["SPOTTER_MODEL_MODE"] = "live";
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    delete process.env["SPOTTER_GENERATOR_MODEL"];
    delete process.env["SPOTTER_MODEL_API_KEY"];
    delete process.env["SPOTTER_MODEL_BASE_URL"];
    delete process.env["SPOTTER_MODEL_MODE"];
    vi.restoreAllMocks();
  });

  it("captures every configured case and replaces the manifest atomically", async () => {
    await runCli();

    expect(state.migrate).toHaveBeenCalledOnce();
    expect(state.seed).toHaveBeenCalledOnce();
    expect(state.gatewayRequests).toHaveLength(5);
    expect(state.transportOptions).toHaveLength(5);
    expect(state.assembleRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "programme", targetWeekStart: "2026-08-03" }),
        expect.objectContaining({ kind: "adjustment" }),
        expect.objectContaining({ kind: "accountability" }),
      ]),
    );
    const tierOneRequest = state.gatewayRequests.find(
      (request) => request["recordingKey"] === "accountability.tier-1",
    );
    expect(tierOneRequest?.["context"]).toEqual(
      expect.stringContaining("Deterministic accountability tier selected by code: 1."),
    );
    expect(state.writeFile).toHaveBeenCalledOnce();
    const written = z
      .object({
        recordings: z.array(
          z
            .object({
              model: z.string(),
              promptVersion: z.string(),
              rawResponse: z.string(),
              recordedAt: z.string(),
            })
            .loose(),
        ),
      })
      .parse(JSON.parse(String(state.writeFile.mock.calls[0]?.[1])) as unknown);
    expect(written.recordings).toHaveLength(5);
    expect(written.recordings[0]?.model).toBe("generator-a");
    expect(written.recordings[0]?.promptVersion.length).toBeGreaterThan(0);
    expect(written.recordings[0]?.rawResponse.length).toBeGreaterThan(0);
    expect(written.recordings[0]?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(state.rename).toHaveBeenCalledWith(
      expect.stringMatching(/recordings\.json\.next$/u),
      expect.stringMatching(/recordings\.json$/u),
    );
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("fails before opening storage when live configuration is missing", async () => {
    delete process.env["SPOTTER_MODEL_API_KEY"];
    await expect(runCli()).rejects.toThrow(/SPOTTER_MODEL_API_KEY/u);
    expect(state.migrate).not.toHaveBeenCalled();
    expect(state.writeFile).not.toHaveBeenCalled();
  });

  it("rejects an incomplete fixture manifest without replacing recordings", async () => {
    state.readFile.mockResolvedValue(
      JSON.stringify({ ...fixtureManifest, recordings: fixtureManifest.recordings.slice(0, 4) }),
    );
    await expect(runCli()).rejects.toThrow(/complete model fixture case list/u);
    expect(state.migrate).not.toHaveBeenCalled();
    expect(state.rename).not.toHaveBeenCalled();
  });

  it("keeps existing recordings when assembly or the live endpoint fails", async () => {
    state.assemblyStatus = "overflow";
    await expect(runCli()).rejects.toThrow(/hard-constraint context budget/u);
    expect(state.close).toHaveBeenCalledOnce();
    expect(state.writeFile).not.toHaveBeenCalled();

    vi.resetModules();
    state.close.mockReset();
    state.assemblyStatus = "ready";
    state.liveFailure = true;
    await expect(runCli()).rejects.toThrow(/existing recordings were not replaced/u);
    expect(state.close).toHaveBeenCalledOnce();
    expect(state.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ["raw response", true, false],
    ["usage", false, true],
  ])("refuses to write a fixture without recordable %s", async (_field, omitRaw, nullUsage) => {
    state.omitRawResponse = omitRaw;
    state.returnNullUsage = nullUsage;
    let failure: unknown;
    try {
      await runCli();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw failure;
    expect(failure.message).toMatch(/existing recordings were not replaced/u);
    expect(failure.cause).toBeInstanceOf(Error);
    if (!(failure.cause instanceof Error)) throw failure.cause;
    expect(failure.cause.message).toMatch(/did not return a recordable response/u);
    expect(state.writeFile).not.toHaveBeenCalled();
    expect(state.rename).not.toHaveBeenCalled();
    expect(state.close).toHaveBeenCalledOnce();
  });
});
