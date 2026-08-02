import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertProjectScopedVolume,
  assertTestPostgresVolumeConfiguration,
  ComposeProject,
  EvidenceCommandRunner,
  parseJsonRecords,
  serializeError,
  stopServiceGracefully,
  teardownProjectAfterFailure,
} from "./lib.mjs";

test("treats the pre-container Docker Compose image inventory as empty", () => {
  assert.deepEqual(parseJsonRecords("null\n", "Compose image inventory"), []);
});

test("filters null separators from JSON-lines and array output", () => {
  assert.deepEqual(parseJsonRecords('{"Service":"web"}\nnull\n{"Service":"seed"}\n'), [
    { Service: "web" },
    { Service: "seed" },
  ]);
  assert.deepEqual(parseJsonRecords('[null,{"Service":"migrate"}]'), [{ Service: "migrate" }]);
});

test("rejects scalar records instead of dereferencing them", () => {
  assert.throws(
    () => parseJsonRecords('"unexpected"', "Compose output"),
    /Compose output contained a malformed JSON record/u,
  );
});

test("retains structured failure evidence without leaking configured secrets", () => {
  const secret = "qa-secret-value";
  const failure = serializeError(new TypeError(`unsafe ${secret}`), [secret]);
  assert.equal(failure.name, "TypeError");
  assert.equal(failure.message, "unsafe [REDACTED]");
  assert.match(failure.stack, /TypeError: unsafe \[REDACTED\]/u);
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(secret, "u"));
});

test("records raw configured-secret exposure while persisting only redacted output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "spotter-command-evidence-"));
  const secret = "qa-configured-secret-value";
  try {
    const runner = new EvidenceCommandRunner(directory, { secrets: [secret] });
    const result = await runner.run(
      process.execPath,
      ["-e", "process.stdout.write(process.env.TEST_SECRET)"],
      { environment: { TEST_SECRET: secret } },
    );
    assert.equal(result.sensitiveMatchCount, 1);
    assert.equal(result.stdout, "[REDACTED]");
    assert.doesNotMatch(
      await readFile(path.join(directory, result.log), "utf8"),
      new RegExp(secret),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("detects and redacts a configured secret split across process-output chunks", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "spotter-split-secret-evidence-"));
  const secret = "qa-split-configured-secret-value";
  try {
    const runner = new EvidenceCommandRunner(directory, { secrets: [secret] });
    const result = await runner.run(
      process.execPath,
      [
        "-e",
        "process.stdout.write(process.env.TEST_SECRET.slice(0,9));setTimeout(()=>process.stdout.write(process.env.TEST_SECRET.slice(9)),10)",
      ],
      { environment: { TEST_SECRET: secret } },
    );
    assert.equal(result.sensitiveMatchCount, 1);
    assert.equal(result.stdout, "[REDACTED]");
    assert.doesNotMatch(
      await readFile(path.join(directory, result.log), "utf8"),
      new RegExp(secret),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("requires restart-persistent project volume configuration for test PostgreSQL", () => {
  const config = {
    services: {
      "test-postgres": {
        volumes: [
          { source: "spotter-test-postgres", target: "/var/lib/postgresql/data", type: "volume" },
        ],
      },
    },
    volumes: { "spotter-test-postgres": {} },
  };
  assert.equal(assertTestPostgresVolumeConfiguration(config).source, "spotter-test-postgres");
  assert.throws(
    () =>
      assertTestPostgresVolumeConfiguration({
        ...config,
        services: {
          "test-postgres": { tmpfs: ["/var/lib/postgresql/data:rw,size=1g"] },
        },
      }),
    /ephemeral project volume/u,
  );
});

test("accepts only the exact local Compose-project test volume", () => {
  const project = "spotter-qa-20260802-volume-test";
  const logicalName = "spotter-test-postgres";
  const volume = {
    Driver: "local",
    Labels: {
      "com.docker.compose.project": project,
      "com.docker.compose.volume": logicalName,
    },
    Name: `${project}_${logicalName}`,
    Scope: "local",
  };
  assert.equal(assertProjectScopedVolume(volume, project, logicalName).name, volume.Name);
  assert.throws(
    () =>
      assertProjectScopedVolume(
        { ...volume, Name: "another-project_volume" },
        project,
        logicalName,
      ),
    /not scoped/u,
  );
});

test("resolves the exact running container before graceful stop and inspects that ID", async () => {
  const events = [];
  const compose = {
    async run(args) {
      events.push(`compose:${args.join(" ")}`);
      return { exitCode: 0 };
    },
    async serviceContainer(service) {
      events.push(`resolve:${service}`);
      return "a".repeat(64);
    },
  };
  const runner = {
    async run(command, args) {
      events.push(`${command}:${args.at(-1)}`);
      return { stdout: '{"Running":false,"ExitCode":0}' };
    },
  };
  const times = [1_000, 1_250];
  const result = await stopServiceGracefully({
    compose,
    now: () => times.shift(),
    runner,
    service: "web",
  });
  assert.deepEqual(events, [
    "resolve:web",
    "compose:stop --timeout 20 web",
    `docker:${"a".repeat(64)}`,
  ]);
  assert.equal(result.container, "a".repeat(64));
  assert.equal(result.durationMs, 250);
  assert.deepEqual(result.state, { ExitCode: 0, Running: false });
});

test("rejects an unclean stopped state", async () => {
  await assert.rejects(
    stopServiceGracefully({
      compose: {
        run: async () => ({ exitCode: 0 }),
        serviceContainer: async () => "b".repeat(64),
      },
      now: () => 0,
      runner: {
        run: async () => ({ stdout: '{"Running":false,"ExitCode":137}' }),
      },
      service: "web",
    }),
    /did not terminate cleanly/u,
  );
});

test("runs an in-flight drain callback while the bounded stop is pending", async () => {
  const events = [];
  let finishStop;
  const stopPending = new Promise((resolve) => {
    finishStop = resolve;
  });
  const operation = stopServiceGracefully({
    compose: {
      async run() {
        events.push("stop-started");
        return stopPending;
      },
      async serviceContainer() {
        events.push("resolved");
        return "c".repeat(64);
      },
    },
    async duringStop() {
      events.push("drain-finished");
      finishStop({ exitCode: 0 });
    },
    now: () => 0,
    runner: {
      async run() {
        events.push("inspected");
        return { stdout: '{"Running":false,"ExitCode":0}' };
      },
    },
    service: "web",
  });
  await operation;
  assert.deepEqual(events, ["resolved", "stop-started", "drain-finished", "inspected"]);
});

test("awaits the bounded stop and inspects state before reporting a drain callback failure", async () => {
  const events = [];
  await assert.rejects(
    stopServiceGracefully({
      compose: {
        async run() {
          events.push("stop-started");
          return { exitCode: 0 };
        },
        async serviceContainer() {
          events.push("resolved");
          return "d".repeat(64);
        },
      },
      async duringStop() {
        events.push("drain-failed");
        throw new Error("listener never rejected work");
      },
      now: () => 0,
      runner: {
        async run() {
          events.push("inspected");
          return { stdout: '{"Running":false,"ExitCode":0}' };
        },
      },
      service: "web",
    }),
    /listener never rejected work/u,
  );
  assert.deepEqual(events, ["resolved", "stop-started", "drain-failed", "inspected"]);
});

test("validates exact project ownership for containers, volumes, and networks", async () => {
  const project = "spotter-qa-20260802-owned-test";
  const runner = {
    async run(_command, args) {
      if (args[0] === "ps") {
        return {
          stdout: `${JSON.stringify({
            Labels: `com.docker.compose.project=${project},com.docker.compose.service=web`,
            Names: `${project}-web-1`,
          })}\n`,
        };
      }
      if (args[0] === "volume") {
        return {
          stdout: `${JSON.stringify({
            Labels: `com.docker.compose.project=${project},com.docker.compose.volume=data`,
            Name: `${project}_data`,
          })}\n`,
        };
      }
      return {
        stdout: `${JSON.stringify({
          Labels: `com.docker.compose.network=default,com.docker.compose.project=${project}`,
          Name: `${project}_default`,
        })}\n`,
      };
    },
  };
  const compose = new ComposeProject(project, runner);
  const resolved = await compose.assertOwnedResources();
  assert.equal(resolved.containers.length, 1);
  assert.equal(resolved.volumes.length, 1);
  assert.equal(resolved.networks.length, 1);
});

test("rejects a label-filter result with a foreign resource name", async () => {
  const project = "spotter-qa-20260802-owned-test";
  const runner = {
    async run(_command, args) {
      if (args[0] === "ps") {
        return {
          stdout: `${JSON.stringify({
            Labels: `com.docker.compose.project=${project}`,
            Names: "foreign-web-1",
          })}\n`,
        };
      }
      return { stdout: "" };
    },
  };
  await assert.rejects(
    new ComposeProject(project, runner).assertOwnedResources(),
    /not exactly owned/u,
  );
});

test("post-teardown absence includes the project network", async () => {
  const project = "spotter-qa-20260802-owned-test";
  let includeNetwork = true;
  const runner = {
    async run(_command, args) {
      if (args[0] !== "network" || !includeNetwork) return { stdout: "" };
      return {
        stdout: `${JSON.stringify({
          Labels: `com.docker.compose.project=${project}`,
          Name: `${project}_default`,
        })}\n`,
      };
    },
  };
  const compose = new ComposeProject(project, runner);
  await assert.rejects(compose.assertNoOwnedResources(), /left project resources/u);
  includeNetwork = false;
  await assert.doesNotReject(compose.assertNoOwnedResources());
});

test("Compose teardown proves exact absence even when down fails", async () => {
  const project = "spotter-qa-20260802-teardown-test";
  let downAttempted = false;
  let postDownInventories = 0;
  const runner = {
    async run(_command, args) {
      if (args.includes("down")) {
        downAttempted = true;
        return { exitCode: 1 };
      }
      if (downAttempted) postDownInventories += 1;
      return { stdout: "" };
    },
  };

  await assert.rejects(new ComposeProject(project, runner).teardown(), /down=1, absence=pass/u);
  assert.equal(postDownInventories, 3);
});

test("Compose teardown still inventories exact absence when the down command throws", async () => {
  const project = "spotter-qa-20260802-teardown-test";
  let downAttempted = false;
  let postDownInventories = 0;
  const runner = {
    async run(_command, args) {
      if (args.includes("down")) {
        downAttempted = true;
        throw new Error("docker transport unavailable");
      }
      if (downAttempted) postDownInventories += 1;
      return { stdout: "" };
    },
  };

  await assert.rejects(new ComposeProject(project, runner).teardown(), /down=error, absence=pass/u);
  assert.equal(postDownInventories, 3);
});

test("Compose teardown rejects residual project resources after a successful down", async () => {
  const project = "spotter-qa-20260802-teardown-test";
  let downAttempted = false;
  const runner = {
    async run(_command, args) {
      if (args.includes("down")) {
        downAttempted = true;
        return { exitCode: 0 };
      }
      if (args[0] === "ps" && downAttempted) {
        return {
          stdout: `${JSON.stringify({
            Labels: `com.docker.compose.project=${project}`,
            Names: `${project}-web-1`,
          })}\n`,
        };
      }
      return { stdout: "" };
    },
  };

  await assert.rejects(new ComposeProject(project, runner).teardown(), /down=0, absence=fail/u);
});

test("Compose teardown returns the target and zero-resource inventories", async () => {
  const project = "spotter-qa-20260802-teardown-test";
  let downAttempted = false;
  const runner = {
    async run(_command, args) {
      if (args.includes("down")) {
        downAttempted = true;
        return { exitCode: 0 };
      }
      if (args[0] === "ps" && !downAttempted) {
        return {
          stdout: `${JSON.stringify({
            Labels: `com.docker.compose.project=${project}`,
            Names: `${project}-web-1`,
          })}\n`,
        };
      }
      return { stdout: "" };
    },
  };

  const result = await new ComposeProject(project, runner).teardown();
  assert.equal(result.targets.containers.length, 1);
  assert.deepEqual(result.removed, {
    containers: [],
    networks: [],
    project,
    volumes: [],
  });
});

test("failure teardown checks resource absence even when Compose down fails", async () => {
  const events = [];
  await assert.rejects(
    teardownProjectAfterFailure({
      compose: {
        async assertOwnedResources() {
          events.push("resolve");
          return { containers: [{ Names: "owned" }], networks: [], volumes: [] };
        },
        async run() {
          events.push("down");
          return { exitCode: 1 };
        },
      },
      async verifyRemoved() {
        events.push("absence");
        return { resources: [] };
      },
      async onTargets() {
        events.push("record");
      },
    }),
    (error) => {
      assert.equal(error.evidence.downExitCode, 1);
      assert.equal(error.evidence.absenceFailure, null);
      return true;
    },
  );
  assert.deepEqual(events, ["resolve", "record", "down", "absence"]);
});

test("failure teardown retains absence failure evidence", async () => {
  await assert.rejects(
    teardownProjectAfterFailure({
      compose: {
        assertOwnedResources: async () => ({ containers: [], networks: [], volumes: [] }),
        run: async () => ({ exitCode: 0 }),
      },
      verifyRemoved: async () => {
        throw new TypeError("network remains");
      },
    }),
    (error) => {
      assert.deepEqual(error.evidence.absenceFailure, {
        message: "network remains",
        name: "TypeError",
      });
      return true;
    },
  );
});
