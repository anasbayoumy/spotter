import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  configureProcessReport,
  createClusterSupervisor,
  parseRateLimitProfile,
  parseWorkerCount,
  processReportFilename,
  webClusterLimits,
} from "./web-cluster.mjs";
import {
  admissionProtocol,
  DeploymentAdmissionController,
  isAdmissionAcquireMessage,
  isAdmissionReleaseMessage,
  isAdmissionResultMessage,
} from "../frontend/src/server/deployment-admission.mjs";

class FakeWorker extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.connected = true;
    this.messages = [];
    this.signals = [];
    this.process = {
      kill: (signal) => {
        this.signals.push(signal);
      },
    };
  }

  isConnected() {
    return this.connected;
  }

  send(message) {
    this.messages.push(message);
  }
}

function harness() {
  const workers = [];
  const timers = [];
  const cleared = new Set();
  const exits = [];
  const clusterModule = {
    fork: () => {
      const worker = new FakeWorker(workers.length + 1);
      workers.push(worker);
      return worker;
    },
    setupPrimary: (options) => {
      clusterModule.setup = options;
    },
  };
  const supervisor = createClusterSupervisor({
    admission: new DeploymentAdmissionController("default", () => 1_000),
    clearTimer: (timer) => {
      cleared.add(timer);
    },
    clusterModule,
    exit: (code) => {
      exits.push(code);
    },
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    workerCount: 2,
    workerFile: "/app/frontend/spotter-worker.mjs",
  });
  return { cleared, clusterModule, exits, supervisor, timers, workers };
}

test("worker count, profile, and report identities are strictly bounded", () => {
  assert.equal(parseWorkerCount("1"), 1);
  assert.equal(parseWorkerCount("2"), 2);
  for (const invalid of ["", "0", "3", "1.5", " 2", "two"]) {
    assert.throws(() => parseWorkerCount(invalid), /SPOTTER_WEB_WORKERS/u);
  }
  assert.equal(parseRateLimitProfile("default"), "default");
  assert.equal(parseRateLimitProfile("load_test"), "load_test");
  assert.throws(() => parseRateLimitProfile("expanded"), /SPOTTER_RATE_LIMIT_PROFILE/u);
  assert.equal(
    processReportFilename("worker-2", 41),
    "spotter-process-report-worker-2-pid-41.json",
  );
  assert.throws(() => processReportFilename("worker-0", 41), /identity/u);

  const report = {};
  configureProcessReport(report, "primary", 1);
  assert.deepEqual(report, {
    directory: "/tmp",
    filename: "spotter-process-report-primary-pid-1.json",
    reportOnSignal: true,
  });
});

test("supervisor starts exact slots, respawns crashes, and never respawns during shutdown", () => {
  const state = harness();
  state.supervisor.start();
  assert.deepEqual(state.clusterModule.setup, {
    args: [],
    exec: "/app/frontend/spotter-worker.mjs",
    silent: false,
  });
  assert.equal(state.workers.length, 2);
  assert.deepEqual([...state.supervisor.workerSlots.keys()], [1, 2]);

  state.workers[0].emit("exit", 1, null);
  const respawn = state.timers.find((timer) => timer.delay === webClusterLimits.respawnDelayMs);
  assert.ok(respawn);
  respawn.callback();
  assert.equal(state.workers.length, 3);
  assert.equal(state.supervisor.workerSlots.get(1), state.workers[2]);

  state.supervisor.beginShutdown("SIGTERM");
  assert.deepEqual(state.workers[1].signals, ["SIGTERM"]);
  assert.deepEqual(state.workers[2].signals, ["SIGTERM"]);
  state.workers[1].emit("exit", 0, "SIGTERM");
  state.workers[2].emit("exit", 0, "SIGTERM");
  assert.deepEqual(state.exits, [0]);
  assert.equal(state.workers.length, 3);
});

test("primary admission remains deployment-wide and releases dead-worker ownership", () => {
  const state = harness();
  state.supervisor.start();
  const [first, second] = state.workers;
  assert.ok(first && second);
  for (let index = 0; index < 4; index += 1) {
    first.emit("message", {
      correlationId: `first-${String(index)}`,
      profile: "default",
      requestClass: "generation",
      type: admissionProtocol.acquire,
    });
  }
  second.emit("message", {
    correlationId: "second-blocked",
    profile: "default",
    requestClass: "generation",
    type: admissionProtocol.acquire,
  });
  assert.equal(
    first.messages.every((message) => message.granted === true),
    true,
  );
  assert.deepEqual(second.messages[0], {
    admissionId: null,
    correlationId: "second-blocked",
    granted: false,
    reason: "generation_queue_full",
    type: admissionProtocol.result,
  });

  first.emit("exit", 1, null);
  second.emit("message", {
    correlationId: "second-recovered",
    profile: "default",
    requestClass: "generation",
    type: admissionProtocol.acquire,
  });
  assert.equal(second.messages[1].granted, true);
});

test("deployment admission shares rate windows across workers and resets at 60 seconds", () => {
  let now = 1_000;
  const admission = new DeploymentAdmissionController("default", () => now);
  for (let index = 0; index < 120; index += 1) {
    assert.equal(admission.acquire(1, "read", "default").granted, true);
    assert.equal(admission.acquire(2, "read", "default").granted, true);
  }
  assert.deepEqual(admission.acquire(2, "read", "default"), {
    admissionId: null,
    granted: false,
    reason: "rate_limited",
  });
  now += 60_000;
  assert.equal(admission.acquire(1, "read", "default").granted, true);
  assert.deepEqual(admission.acquire(1, "read", "load_test"), {
    admissionId: null,
    granted: false,
    reason: "policy_mismatch",
  });
});

test("generation admission rejects foreign or duplicate release and reclaims dead workers", () => {
  const admission = new DeploymentAdmissionController("default");
  const first = admission.acquire(1, "generation", "default");
  assert.equal(first.granted, true);
  assert.notEqual(first.admissionId, null);
  assert.equal(admission.release(2, first.admissionId), false);
  assert.equal(admission.release(1, first.admissionId), true);
  assert.equal(admission.release(1, first.admissionId), false);

  admission.acquire(1, "generation", "default");
  admission.acquire(1, "generation", "default");
  admission.acquire(2, "generation", "default");
  assert.equal(admission.generationInFlight, 3);
  assert.equal(admission.releaseWorker(1), 2);
  assert.equal(admission.generationInFlight, 1);
  assert.equal(admission.releaseWorker(1), 0);
});

test("IPC message guards reject malformed or internally inconsistent protocol values", () => {
  assert.equal(
    isAdmissionAcquireMessage({
      correlationId: "request-1",
      profile: "default",
      requestClass: "read",
      type: admissionProtocol.acquire,
    }),
    true,
  );
  assert.equal(
    isAdmissionAcquireMessage({
      correlationId: "request-1",
      profile: "expanded",
      requestClass: "read",
      type: admissionProtocol.acquire,
    }),
    false,
  );
  assert.equal(
    isAdmissionReleaseMessage({ admissionId: "", type: admissionProtocol.release }),
    false,
  );
  assert.equal(
    isAdmissionResultMessage({
      admissionId: null,
      correlationId: "request-1",
      granted: false,
      reason: null,
      type: admissionProtocol.result,
    }),
    false,
  );
  assert.equal(
    isAdmissionResultMessage({
      admissionId: null,
      correlationId: "request-1",
      granted: true,
      reason: null,
      type: admissionProtocol.result,
    }),
    true,
  );
});
