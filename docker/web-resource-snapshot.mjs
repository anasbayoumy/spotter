import fs from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function processEnvironment(pid) {
  return new Map(
    fs
      .readFileSync(`/proc/${String(pid)}/environ`, "utf8")
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator < 0
          ? [entry, ""]
          : [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
}

export function discoverClusterProcesses(entries, expectedWorkerCount) {
  if (
    !Number.isSafeInteger(expectedWorkerCount) ||
    expectedWorkerCount < 1 ||
    expectedWorkerCount > 2
  ) {
    throw new Error("Expected worker count must be between 1 and 2.");
  }
  const primaries = entries.filter(
    (entry) =>
      entry.pid === 1 &&
      /(?:^|\s)(?:\/app\/)?docker\/web-cluster\.mjs(?:\s|$)/u.test(entry.command),
  );
  const workerEntries = entries.filter(
    (entry) => entry.environment.get("SPOTTER_WEB_CLUSTER_WORKER") === "true",
  );
  if (primaries.length !== 1) {
    throw new Error(`Expected exactly one web cluster primary, found ${String(primaries.length)}.`);
  }
  if (workerEntries.length !== expectedWorkerCount) {
    throw new Error(
      `Expected exactly ${String(expectedWorkerCount)} web workers, found ${String(workerEntries.length)}.`,
    );
  }
  const workers = workerEntries
    .map((entry) => {
      const slot = Number(entry.environment.get("SPOTTER_WEB_WORKER_SLOT"));
      if (!Number.isSafeInteger(slot) || slot < 1 || slot > expectedWorkerCount) {
        throw new Error(`Worker ${String(entry.pid)} has an invalid slot.`);
      }
      if (
        !/(?:^|\s)(?:\/app\/)?docker\/spotter-worker\.mjs(?:\s|$)/u.test(entry.command) &&
        !/^next-server \(v\d+\.\d+\.\d+(?:-[^)]+)?\)$/u.test(entry.command)
      ) {
        throw new Error(`Worker ${String(entry.pid)} has an invalid runtime command.`);
      }
      return { ...entry, role: "worker", slot };
    })
    .sort((left, right) => left.slot - right.slot);
  const slots = workers.map((worker) => worker.slot);
  if (new Set(slots).size !== expectedWorkerCount) {
    throw new Error("Web worker slots are not unique.");
  }
  for (let slot = 1; slot <= expectedWorkerCount; slot += 1) {
    if (slots[slot - 1] !== slot) throw new Error("Web worker slots are not contiguous.");
  }
  return {
    primary: { ...primaries[0], role: "primary", slot: null },
    workers,
  };
}

export function aggregateProcessReports(reports, expectedWorkerCount) {
  if (reports.length !== expectedWorkerCount + 1) {
    throw new Error("Cluster resource aggregate is missing a process report.");
  }
  const reportFiles = reports.map((report) => report.reportFile);
  const sequences = reports.map((report) => report.reportSequence);
  if (new Set(reportFiles).size !== reports.length) {
    throw new Error("Cluster process reports must use unique files.");
  }
  if (sequences.some((sequence, index) => sequence !== index + 1)) {
    throw new Error("Cluster process reports must be collected sequentially.");
  }
  const primary = reports.filter((report) => report.role === "primary");
  const workers = reports.filter((report) => report.role === "worker");
  if (primary.length !== 1 || workers.length !== expectedWorkerCount) {
    throw new Error("Cluster process report roles do not match the expected topology.");
  }
  return {
    activeLibuvHandles: reports.reduce((total, report) => total + report.activeLibuvHandles, 0),
    expectedWorkerCount,
    fileDescriptorCount: reports.reduce((total, report) => total + report.fileDescriptorCount, 0),
    heapTotalBytes: reports.reduce((total, report) => total + report.heapTotalBytes, 0),
    heapUsedBytes: reports.reduce((total, report) => total + report.heapUsedBytes, 0),
    primary: primary[0],
    processCount: reports.length,
    processes: reports,
    rssBytes: reports.reduce((total, report) => total + report.rssBytes, 0),
    workerCount: workers.length,
    workers,
  };
}

function reportFile(processEntry) {
  const role = processEntry.role === "primary" ? "primary" : `worker-${String(processEntry.slot)}`;
  return `/tmp/spotter-process-report-${role}-pid-${String(processEntry.pid)}.json`;
}

async function collectProcessReport(processEntry, reportSequence) {
  const file = reportFile(processEntry);
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  process.kill(processEntry.pid, "SIGUSR2");
  const deadline = Date.now() + 5_000;
  let report;
  for (;;) {
    try {
      report = JSON.parse(fs.readFileSync(file, "utf8"));
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  }
  if (report.header?.processId !== processEntry.pid) {
    throw new Error(`Process report PID does not match ${String(processEntry.pid)}.`);
  }
  const fileDescriptorCount = fs.readdirSync(`/proc/${String(processEntry.pid)}/fd`).length;
  const activeLibuvHandles = Array.isArray(report.libuv)
    ? report.libuv.filter((handle) => handle?.is_active === true).length
    : 0;
  fs.unlinkSync(file);
  return {
    activeLibuvHandles,
    command: processEntry.command,
    fileDescriptorCount,
    heapTotalBytes: report.javascriptHeap.totalMemory,
    heapUsedBytes: report.javascriptHeap.usedMemory,
    pid: processEntry.pid,
    reportFile: file,
    reportSequence,
    role: processEntry.role,
    rssBytes: report.resourceUsage.rss,
    slot: processEntry.slot,
  };
}

async function snapshot() {
  const expectedWorkerCount = Number(process.env.SPOTTER_WEB_WORKERS ?? "2");
  const entries = fs
    .readdirSync("/proc")
    .filter((entry) => /^\d+$/u.test(entry))
    .flatMap((entry) => {
      const pid = Number(entry);
      if (pid === process.pid) return [];
      try {
        return [
          {
            command: fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ").trim(),
            environment: processEnvironment(pid),
            pid,
          },
        ];
      } catch {
        return [];
      }
    });
  const topology = discoverClusterProcesses(entries, expectedWorkerCount);
  const ordered = [topology.primary, ...topology.workers];
  const reports = [];
  for (const [index, processEntry] of ordered.entries()) {
    reports.push(await collectProcessReport(processEntry, index + 1));
  }
  process.stdout.write(JSON.stringify(aggregateProcessReports(reports, expectedWorkerCount)));
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await snapshot();
}
