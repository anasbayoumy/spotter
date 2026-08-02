import { execFile } from "node:child_process";
import { readFile, rm, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const project = process.cwd();
const workspace = resolve(project, "..");
const statePath = resolve(project, "tests/e2e/.runtime-state.json");
interface RuntimeState {
  readonly applicationPid?: number;
  readonly composeProject: string;
}

export default async function globalTeardown(): Promise<void> {
  let state: RuntimeState;
  try {
    state = JSON.parse(await readFile(statePath, "utf8")) as RuntimeState;
  } catch {
    return;
  }
  if (
    !/^spotter-e2e-client-[a-z0-9-]+$/u.test(state.composeProject) ||
    (state.applicationPid !== undefined &&
      (!Number.isInteger(state.applicationPid) || state.applicationPid <= 0))
  ) {
    return;
  }
  if (state.applicationPid !== undefined) {
    try {
      process.kill(-state.applicationPid, "SIGTERM");
    } catch {
      // The production server may already have stopped.
    }
  }
  await execFileAsync(
    "docker",
    [
      "compose",
      "-f",
      "compose.yaml",
      "-p",
      state.composeProject,
      "--profile",
      "test",
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { cwd: workspace, killSignal: "SIGTERM", timeout: 30_000 },
  ).catch(() => undefined);
  await unlink(statePath).catch(() => undefined);
  await rm(`${workspace}/.cache/e2e-runtime/${state.composeProject}`, {
    force: true,
    recursive: true,
  }).catch(() => undefined);
}
