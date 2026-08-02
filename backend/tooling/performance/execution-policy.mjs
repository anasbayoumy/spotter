const attachOverrideNames = Object.freeze([
  "SPOTTER_PERF_COMPOSE_PROJECT",
  "SPOTTER_PERF_BASE_URL",
  "SPOTTER_PERF_WEB_PORT",
]);

export function resolvePerformanceExecution(environment) {
  const requestedProfile = environment.SPOTTER_PERF_PROFILE ?? "release";
  if (!["release", "smoke"].includes(requestedProfile)) {
    throw new Error("SPOTTER_PERF_PROFILE must be release or smoke.");
  }
  const suppliedAttachOverrides = attachOverrideNames.filter(
    (name) => environment[name] !== undefined,
  );
  if (requestedProfile === "release" && suppliedAttachOverrides.length > 0) {
    throw new Error(
      `Release performance evidence cannot attach through ${suppliedAttachOverrides.join(", ")}.`,
    );
  }
  const attached = environment.SPOTTER_PERF_COMPOSE_PROJECT !== undefined;
  if (
    requestedProfile === "smoke" &&
    !attached &&
    (environment.SPOTTER_PERF_BASE_URL !== undefined ||
      environment.SPOTTER_PERF_WEB_PORT !== undefined)
  ) {
    throw new Error("Smoke URL/port overrides require an explicit QA Compose project attachment.");
  }
  const mode =
    requestedProfile === "release"
      ? "fresh-owned-release"
      : attached
        ? "attached-smoke-non-release"
        : "fresh-owned-smoke-non-release";
  return Object.freeze({
    attached,
    mode,
    ownsCompose: !attached,
    profile: requestedProfile,
    releaseEligible: requestedProfile === "release" && !attached,
  });
}

export function assertCleanReleaseSource(execution, source) {
  if (execution.profile === "release" && source?.dirty !== false) {
    throw new Error("Release performance evidence requires a clean source tree before build.");
  }
  return source;
}
