const defaultRequestLimits = Object.freeze({
  cron: 10,
  generation: 8,
  mutation: 60,
  read: 240,
});

const loadTestRequestLimits = Object.freeze({
  cron: 1_000,
  generation: 10_000,
  mutation: 10_000,
  read: 10_000_000,
});

const generationPaths = new Set([
  "/api/v1/accountability/run",
  "/api/v1/adjustments/generate",
  "/api/v1/programmes/generate",
]);

const requestClasses = new Set(["cron", "generation", "mutation", "read"]);
const profiles = new Set(["default", "load_test"]);

export const admissionProtocol = Object.freeze({
  acquire: "spotter:admission:acquire:v1",
  release: "spotter:admission:release:v1",
  result: "spotter:admission:result:v1",
});

export function requestClassFor(path, mutation) {
  return path.startsWith("/api/v1/jobs/")
    ? "cron"
    : generationPaths.has(path)
      ? "generation"
      : mutation
        ? "mutation"
        : "read";
}

export function requestLimitsFor(profile) {
  if (!profiles.has(profile)) throw new Error("Request-limit profile is invalid.");
  return profile === "load_test" ? loadTestRequestLimits : defaultRequestLimits;
}

function positiveWorkerId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function record(value) {
  return typeof value === "object" && value !== null ? value : undefined;
}

export function isAdmissionAcquireMessage(value) {
  const candidate = record(value);
  return (
    candidate !== undefined &&
    candidate.type === admissionProtocol.acquire &&
    typeof candidate.correlationId === "string" &&
    candidate.correlationId.length > 0 &&
    candidate.correlationId.length <= 200 &&
    typeof candidate.requestClass === "string" &&
    requestClasses.has(candidate.requestClass) &&
    typeof candidate.profile === "string" &&
    profiles.has(candidate.profile)
  );
}

export function isAdmissionReleaseMessage(value) {
  const candidate = record(value);
  return (
    candidate !== undefined &&
    candidate.type === admissionProtocol.release &&
    typeof candidate.admissionId === "string" &&
    candidate.admissionId.length > 0 &&
    candidate.admissionId.length <= 200
  );
}

export function isAdmissionResultMessage(value) {
  const candidate = record(value);
  const shapeValid =
    candidate !== undefined &&
    candidate.type === admissionProtocol.result &&
    typeof candidate.correlationId === "string" &&
    typeof candidate.granted === "boolean" &&
    (candidate.admissionId === null || typeof candidate.admissionId === "string") &&
    (candidate.reason === null ||
      candidate.reason === "generation_queue_full" ||
      candidate.reason === "policy_mismatch" ||
      candidate.reason === "rate_limited");
  if (!shapeValid) return false;
  return candidate.granted
    ? candidate.reason === null
    : candidate.admissionId === null && candidate.reason !== null;
}

export class DeploymentAdmissionController {
  #generationAdmissions = new Map();
  #nextAdmission = 0;
  #windows = new Map();

  constructor(profile, now = Date.now) {
    this.profile = profile;
    this.limits = requestLimitsFor(profile);
    this.now = now;
  }

  acquire(workerId, requestClass, profile) {
    if (!positiveWorkerId(workerId) || !requestClasses.has(requestClass)) {
      throw new Error("Admission request identity is invalid.");
    }
    if (profile !== this.profile) {
      return { admissionId: null, granted: false, reason: "policy_mismatch" };
    }
    const now = this.now();
    const current = this.#windows.get(requestClass);
    const window =
      current === undefined || now - current.startedAt >= 60_000
        ? { count: 0, startedAt: now }
        : current;
    window.count += 1;
    this.#windows.set(requestClass, window);
    if (window.count > this.limits[requestClass]) {
      return { admissionId: null, granted: false, reason: "rate_limited" };
    }
    if (requestClass !== "generation") {
      return { admissionId: null, granted: true, reason: null };
    }
    if (this.#generationAdmissions.size >= 4) {
      return { admissionId: null, granted: false, reason: "generation_queue_full" };
    }
    this.#nextAdmission += 1;
    const admissionId = `generation:${String(workerId)}:${String(this.#nextAdmission)}`;
    this.#generationAdmissions.set(admissionId, workerId);
    return { admissionId, granted: true, reason: null };
  }

  release(workerId, admissionId) {
    if (this.#generationAdmissions.get(admissionId) !== workerId) return false;
    return this.#generationAdmissions.delete(admissionId);
  }

  releaseWorker(workerId) {
    let released = 0;
    for (const [admissionId, owner] of this.#generationAdmissions) {
      if (owner !== workerId) continue;
      this.#generationAdmissions.delete(admissionId);
      released += 1;
    }
    return released;
  }

  get generationInFlight() {
    return this.#generationAdmissions.size;
  }
}
