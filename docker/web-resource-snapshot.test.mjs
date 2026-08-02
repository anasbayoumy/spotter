import assert from "node:assert/strict";
import test from "node:test";

import { aggregateProcessReports, discoverClusterProcesses } from "./web-resource-snapshot.mjs";

function entry(pid, command, slot) {
  return {
    command,
    environment: new Map(
      slot === undefined
        ? []
        : [
            ["SPOTTER_WEB_CLUSTER_WORKER", "true"],
            ["SPOTTER_WEB_WORKER_SLOT", String(slot)],
          ],
    ),
    pid,
  };
}

function report(role, pid, sequence, slot = null) {
  return {
    activeLibuvHandles: sequence,
    command: role === "primary" ? "node docker/web-cluster.mjs" : "next-server (v16.2.12)",
    fileDescriptorCount: 10 + sequence,
    heapTotalBytes: 100 + sequence,
    heapUsedBytes: 50 + sequence,
    pid,
    reportFile: `/tmp/report-${String(pid)}.json`,
    reportSequence: sequence,
    role,
    rssBytes: 200 + sequence,
    slot,
  };
}

test("discovers exactly one primary and contiguous unique worker slots", () => {
  const topology = discoverClusterProcesses(
    [
      entry(1, "/nodejs/bin/node /app/docker/web-cluster.mjs"),
      entry(12, "next-server (v16.2.12)", 2),
      entry(11, "next-server (v16.2.12)", 1),
      entry(99, "/nodejs/bin/node -e healthcheck"),
    ],
    2,
  );
  assert.equal(topology.primary.pid, 1);
  assert.deepEqual(
    topology.workers.map((worker) => [worker.slot, worker.pid]),
    [
      [1, 11],
      [2, 12],
    ],
  );
  assert.throws(
    () =>
      discoverClusterProcesses(
        [entry(1, "node docker/web-cluster.mjs"), entry(11, "node docker/spotter-worker.mjs", 1)],
        2,
      ),
    /exactly 2 web workers/u,
  );
  assert.throws(
    () =>
      discoverClusterProcesses(
        [
          entry(1, "node docker/web-cluster.mjs"),
          entry(11, "node docker/spotter-worker.mjs", 1),
          entry(12, "node docker/spotter-worker.mjs", 1),
        ],
        2,
      ),
    /not unique/u,
  );
  assert.throws(
    () =>
      discoverClusterProcesses(
        [
          entry(1, "node docker/web-cluster.mjs"),
          entry(11, "node unrelated-server.mjs", 1),
          entry(12, "next-server (v16.2.12)", 2),
        ],
        2,
      ),
    /invalid runtime command/u,
  );
});

test("aggregates primary and every worker while retaining exact per-process evidence", () => {
  const reports = [report("primary", 1, 1), report("worker", 11, 2, 1), report("worker", 12, 3, 2)];
  const aggregate = aggregateProcessReports(reports, 2);
  assert.equal(aggregate.processCount, 3);
  assert.equal(aggregate.workerCount, 2);
  assert.equal(aggregate.heapUsedBytes, 50 + 1 + 50 + 2 + 50 + 3);
  assert.equal(aggregate.rssBytes, 200 + 1 + 200 + 2 + 200 + 3);
  assert.equal(aggregate.fileDescriptorCount, 11 + 12 + 13);
  assert.equal(aggregate.activeLibuvHandles, 1 + 2 + 3);
  assert.deepEqual(aggregate.processes, reports);
  assert.throws(
    () =>
      aggregateProcessReports(
        [reports[0], reports[1], { ...reports[2], reportFile: reports[1].reportFile }],
        2,
      ),
    /unique files/u,
  );
  assert.throws(
    () =>
      aggregateProcessReports([reports[0], { ...reports[1], reportSequence: 3 }, reports[2]], 2),
    /sequentially/u,
  );
});
