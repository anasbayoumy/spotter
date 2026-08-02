import type { BackendFacade } from "./backend-facade";
import { createBackend, type BackendRuntime } from "./create-backend";

interface BackendGlobal {
  __spotterBackendRuntime: Promise<BackendRuntime> | undefined;
}

function globalState(): BackendGlobal {
  return globalThis as unknown as BackendGlobal;
}

async function getRuntime(): Promise<BackendRuntime> {
  const state = globalState();
  state.__spotterBackendRuntime ??= createBackend();
  try {
    return await state.__spotterBackendRuntime;
  } catch (error: unknown) {
    state.__spotterBackendRuntime = undefined;
    throw error;
  }
}

export async function getBackend(): Promise<BackendFacade> {
  return (await getRuntime()).facade;
}

export async function getBackendReadiness(): Promise<{ readonly ready: boolean }> {
  const health = await (await getRuntime()).adapter.healthCheck();
  return { ready: health.ok && health.migrationVersion !== null };
}

export async function closeBackend(): Promise<void> {
  const state = globalState();
  const runtime = state.__spotterBackendRuntime;
  if (runtime === undefined) return;
  state.__spotterBackendRuntime = undefined;
  await (await runtime).adapter.close();
}
