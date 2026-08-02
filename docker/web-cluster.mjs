import cluster from "node:cluster";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  admissionProtocol,
  DeploymentAdmissionController,
  isAdmissionAcquireMessage,
  isAdmissionReleaseMessage,
} from "../frontend/src/server/deployment-admission.mjs";

export const webClusterLimits = Object.freeze({
  crashWindowMs: 30_000,
  maximumCrashes: 5,
  maximumWorkers: 2,
  minimumWorkers: 1,
  respawnDelayMs: 250,
  shutdownTimeoutMs: 18_000,
});

export function parseWorkerCount(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    throw new Error("SPOTTER_WEB_WORKERS must be a positive integer.");
  }
  const count = Number(value);
  if (count < webClusterLimits.minimumWorkers || count > webClusterLimits.maximumWorkers) {
    throw new Error(
      `SPOTTER_WEB_WORKERS must be between ${String(webClusterLimits.minimumWorkers)} and ${String(webClusterLimits.maximumWorkers)}.`,
    );
  }
  return count;
}

export function parseRateLimitProfile(value) {
  if (value !== "default" && value !== "load_test") {
    throw new Error("SPOTTER_RATE_LIMIT_PROFILE must be default or load_test.");
  }
  return value;
}

export function processReportFilename(role, pid) {
  if (!/^(?:primary|worker-[1-9]\d*)$/u.test(role) || !Number.isSafeInteger(pid) || pid < 1) {
    throw new Error("Process report identity is invalid.");
  }
  return `/tmp/spotter-process-report-${role}-pid-${String(pid)}.json`;
}

function sendAdmissionResult(worker, correlationId, result) {
  if (typeof worker.isConnected === "function" && !worker.isConnected()) return;
  try {
    worker.send({
      ...result,
      correlationId,
      type: admissionProtocol.result,
    });
  } catch {
    // The worker will fail its bounded admission request closed if IPC closes during this send.
  }
}

export function createClusterSupervisor(options) {
  const {
    admission,
    clusterModule,
    exit,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    workerCount,
    workerFile,
  } = options;
  const slots = new Map();
  const respawnTimers = new Set();
  const crashTimes = [];
  let finished = false;
  let shutdownCode = 0;
  let shutdownTimer;
  let shuttingDown = false;

  const finish = (code) => {
    if (finished) return;
    finished = true;
    if (shutdownTimer !== undefined) clearTimer(shutdownTimer);
    for (const timer of respawnTimers) clearTimer(timer);
    respawnTimers.clear();
    exit(code);
  };

  const beginShutdown = (signal = "SIGTERM", code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownCode = code;
    for (const timer of respawnTimers) clearTimer(timer);
    respawnTimers.clear();
    if (slots.size === 0) {
      finish(shutdownCode);
      return;
    }
    shutdownTimer = setTimer(() => {
      for (const worker of slots.values()) worker.process.kill("SIGKILL");
      finish(1);
    }, webClusterLimits.shutdownTimeoutMs);
    for (const worker of slots.values()) worker.process.kill(signal);
  };

  const scheduleRespawn = (slot, spawn) => {
    const timer = setTimer(() => {
      respawnTimers.delete(timer);
      if (!shuttingDown) spawn(slot);
    }, webClusterLimits.respawnDelayMs);
    respawnTimers.add(timer);
  };

  const spawn = (slot) => {
    const worker = clusterModule.fork({
      ...process.env,
      SPOTTER_WEB_CLUSTER_WORKER: "true",
      SPOTTER_WEB_WORKER_SLOT: String(slot),
    });
    slots.set(slot, worker);
    worker.on("message", (message) => {
      if (isAdmissionAcquireMessage(message)) {
        const result = admission.acquire(worker.id, message.requestClass, message.profile);
        sendAdmissionResult(worker, message.correlationId, result);
      } else if (isAdmissionReleaseMessage(message)) {
        admission.release(worker.id, message.admissionId);
      }
    });
    worker.once("exit", () => {
      admission.releaseWorker(worker.id);
      if (slots.get(slot) === worker) slots.delete(slot);
      if (shuttingDown) {
        if (slots.size === 0) finish(shutdownCode);
        return;
      }
      const timestamp = now();
      crashTimes.push(timestamp);
      while (crashTimes.length > 0 && timestamp - crashTimes[0] > webClusterLimits.crashWindowMs) {
        crashTimes.shift();
      }
      if (crashTimes.length > webClusterLimits.maximumCrashes) {
        beginShutdown("SIGTERM", 1);
        return;
      }
      scheduleRespawn(slot, spawn);
    });
    return worker;
  };

  return {
    beginShutdown,
    get workerSlots() {
      return new Map(slots);
    },
    start() {
      clusterModule.setupPrimary({ args: [], exec: workerFile, silent: false });
      for (let slot = 1; slot <= workerCount; slot += 1) spawn(slot);
    },
  };
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMainModule()) {
  if (!cluster.isPrimary)
    throw new Error("The web cluster supervisor must be the primary process.");
  const workerCount = parseWorkerCount(process.env.SPOTTER_WEB_WORKERS ?? "2");
  const profile = parseRateLimitProfile(process.env.SPOTTER_RATE_LIMIT_PROFILE ?? "default");
  const workerFile = fileURLToPath(new URL("./spotter-worker.mjs", import.meta.url));
  process.report.reportOnSignal = true;
  process.report.directory = "/tmp";
  process.report.filename = processReportFilename("primary", process.pid);
  const supervisor = createClusterSupervisor({
    admission: new DeploymentAdmissionController(profile),
    clusterModule: cluster,
    exit: (code) => {
      process.exit(code);
    },
    workerCount,
    workerFile,
  });
  process.once("SIGINT", () => {
    supervisor.beginShutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    supervisor.beginShutdown("SIGTERM");
  });
  supervisor.start();
}
