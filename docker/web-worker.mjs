import cluster from "node:cluster";

import { configureProcessReport } from "./web-cluster.mjs";

const value = process.env.SPOTTER_WEB_WORKER_SLOT;
if (!cluster.isWorker || value === undefined || !/^[1-9]\d*$/u.test(value)) {
  throw new Error("The Spotter web worker requires a valid cluster worker slot.");
}
const slot = Number(value);
configureProcessReport(process.report, `worker-${String(slot)}`, process.pid);

await import("../frontend/server.js");
