import cluster from "node:cluster";

const value = process.env.SPOTTER_WEB_WORKER_SLOT;
if (!cluster.isWorker || value === undefined || !/^[1-9]\d*$/u.test(value)) {
  throw new Error("The Spotter web worker requires a valid cluster worker slot.");
}
const slot = Number(value);
process.report.reportOnSignal = true;
process.report.directory = "/tmp";
process.report.filename = `/tmp/spotter-process-report-worker-${String(slot)}-pid-${String(process.pid)}.json`;

await import("../frontend/server.js");
