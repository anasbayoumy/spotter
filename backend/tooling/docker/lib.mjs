import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const qaProjectPattern = /^spotter-qa-[a-z0-9][a-z0-9-]{0,61}$/u;
const sensitiveKeyPattern =
  /(authorization|cookie|credential|database_url|password|secret|token)/iu;

export function assertQaProject(project) {
  if (!qaProjectPattern.test(project)) {
    throw new Error(`Unsafe Compose project name: ${project}`);
  }
  return project;
}

export function createQaIdentity(scope) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/gu, "")
    .slice(0, 14);
  const suffix = randomBytes(3).toString("hex");
  const normalized = scope
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return {
    project: assertQaProject(`spotter-qa-${timestamp}-${normalized}-${suffix}`.slice(0, 62)),
    runId: `${timestamp}-${normalized}-${suffix}`,
  };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function parseJsonRecords(text, description = "JSON output") {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const parsed = trimmed.startsWith("[")
    ? JSON.parse(trimmed)
    : trimmed.split("\n").filter(Boolean).map(JSON.parse);
  const records = (Array.isArray(parsed) ? parsed : [parsed]).filter((entry) => entry !== null);
  if (records.some((entry) => typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error(`${description} contained a malformed JSON record.`);
  }
  return records;
}

export function expectedProjectVolumeName(project, logicalName) {
  assertQaProject(project);
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(logicalName)) {
    throw new Error(`Unsafe Compose volume name: ${logicalName}`);
  }
  return `${project}_${logicalName}`;
}

export function assertTestPostgresVolumeConfiguration(config) {
  const service = config?.services?.["test-postgres"];
  const volumes = Array.isArray(service?.volumes) ? service.volumes : [];
  const dataMounts = volumes.filter((volume) => volume?.target === "/var/lib/postgresql/data");
  const [dataMount] = dataMounts;
  if (
    dataMounts.length !== 1 ||
    dataMount?.type !== "volume" ||
    dataMount.source !== "spotter-test-postgres" ||
    config?.volumes?.["spotter-test-postgres"] === undefined
  ) {
    throw new Error("test-postgres must use the declared ephemeral project volume for PGDATA.");
  }
  const tmpfs = Array.isArray(service.tmpfs) ? service.tmpfs : [];
  if (tmpfs.some((entry) => String(entry).startsWith("/var/lib/postgresql/data"))) {
    throw new Error("test-postgres PGDATA cannot use tmpfs because restart evidence must persist.");
  }
  return dataMount;
}

export function assertProjectScopedVolume(volume, project, logicalName) {
  const expectedName = expectedProjectVolumeName(project, logicalName);
  const labels = volume?.Labels ?? {};
  if (
    volume?.Name !== expectedName ||
    volume?.Driver !== "local" ||
    volume?.Scope !== "local" ||
    labels["com.docker.compose.project"] !== project ||
    labels["com.docker.compose.volume"] !== logicalName
  ) {
    throw new Error(`Volume is not scoped to ${project}: ${JSON.stringify(volume)}`);
  }
  return { driver: volume.Driver, labels, name: volume.Name, scope: volume.Scope };
}

export async function resolveEvidenceDirectory(root, explicitDirectory, fallbackDirectory) {
  const evidenceRoot = path.resolve(root, "artifacts", "verification");
  await mkdir(evidenceRoot, { recursive: true });
  const resolvedEvidenceRoot = await realpath(evidenceRoot);
  const requested = path.resolve(explicitDirectory ?? fallbackDirectory);
  const relative = path.relative(evidenceRoot, requested);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(
      `Evidence directory must be a dedicated child of ${evidenceRoot}; received ${requested}.`,
    );
  }

  let existingAncestor = requested;
  let resolvedAncestor;
  while (resolvedAncestor === undefined) {
    try {
      resolvedAncestor = await realpath(existingAncestor);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      existingAncestor = parent;
    }
  }
  const realRelative = path.relative(resolvedEvidenceRoot, resolvedAncestor);
  if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Evidence directory resolves outside ${resolvedEvidenceRoot}.`);
  }
  return requested;
}

export function redact(value, secrets = []) {
  let output = String(value);
  for (const secret of secrets) {
    if (secret.length > 0) output = output.split(secret).join("[REDACTED]");
  }
  output = output
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/giu, "$1[REDACTED]@")
    .replace(
      /^([ \t-]*(?:POSTGRES_PASSWORD|SPOTTER_APP_PASSWORD|CRON_SECRET|DATABASE_URL):)[^\n]*$/gimu,
      "$1 [REDACTED]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\x2f-]+/giu, "$1[REDACTED]");
  return output;
}

export function serializeError(error, secrets = []) {
  if (error instanceof Error) {
    return {
      message: redact(error.message, secrets),
      name: error.name,
      stack: error.stack === undefined ? null : redact(error.stack, secrets),
    };
  }
  return {
    message: redact(String(error), secrets),
    name: "NonErrorThrown",
    stack: null,
  };
}

export function redactObject(value, secrets = []) {
  if (Array.isArray(value)) return value.map((entry) => redactObject(entry, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactObject(entry, secrets),
      ]),
    );
  }
  return typeof value === "string" ? redact(value, secrets) : value;
}

export async function waitFor(description, probe, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let delayMs = options.initialDelayMs ?? 100;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined && value !== false && value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(Math.ceil(delayMs * 1.5), options.maximumDelayMs ?? 2_000);
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

export async function stopServiceGracefully(options) {
  const { compose, runner, service } = options;
  const timeoutSeconds = options.timeoutSeconds ?? 20;
  const maximumDurationMs = options.maximumDurationMs ?? (timeoutSeconds + 5) * 1_000;
  const now = options.now ?? Date.now;
  if (!/^[a-z][a-z0-9-]*$/u.test(service)) {
    throw new Error(`Unsafe Compose service name: ${String(service)}`);
  }
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 120) {
    throw new Error("Graceful-stop timeout must be an integer from 1 to 120 seconds.");
  }
  const container = await compose.serviceContainer(service);
  const started = now();
  const stopPromise = compose.run(["stop", "--timeout", String(timeoutSeconds), service], {
    allowFailure: true,
    label: `graceful-${service}-stop`,
  });
  let duringStopError;
  if (options.duringStop !== undefined) {
    try {
      await new Promise((resolve) => setImmediate(resolve));
      await options.duringStop();
    } catch (error) {
      duringStopError = error;
    }
  }
  const stop = await stopPromise;
  const durationMs = now() - started;
  if (stop.exitCode !== 0 || durationMs > maximumDurationMs) {
    throw new Error(
      `${service} graceful stop failed or exceeded ${String(maximumDurationMs)} ms (${String(durationMs)} ms).`,
    );
  }
  const stoppedState = await runner.run(
    "docker",
    ["inspect", "--format", "{{json .State}}", container],
    { label: `stopped-${service}-state` },
  );
  const state = JSON.parse(stoppedState.stdout);
  if (state.Running !== false || ![0, 143].includes(state.ExitCode)) {
    throw new Error(`${service} did not terminate cleanly: ${JSON.stringify(state)}`);
  }
  if (duringStopError !== undefined) throw duringStopError;
  return { container, durationMs, state };
}

export async function teardownProjectAfterFailure(options) {
  const targets = await options.compose.assertOwnedResources("failure-teardown-targets");
  await options.onTargets?.(targets);
  const down = await options.compose.run(
    ["down", "--volumes", "--remove-orphans", "--timeout", "20"],
    { allowFailure: true, label: "failure-safe-teardown" },
  );
  let absence;
  let absenceError;
  try {
    absence = await options.verifyRemoved();
  } catch (error) {
    absenceError = error;
  }
  const evidence = {
    absence,
    absenceFailure:
      absenceError instanceof Error
        ? { message: absenceError.message, name: absenceError.name }
        : absenceError === undefined
          ? null
          : { message: String(absenceError), name: "NonErrorThrown" },
    downExitCode: down.exitCode,
    targets,
  };
  if (down.exitCode !== 0 || absenceError !== undefined) {
    const error = new Error(
      `Failure teardown was incomplete (down=${String(down.exitCode)}, absence=${absenceError === undefined ? "pass" : "fail"}).`,
    );
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}

export class EvidenceCommandRunner {
  #sequence = 0;
  #results = [];

  constructor(directory, options = {}) {
    this.directory = directory;
    this.environment = options.environment ?? {};
    this.secrets = options.secrets ?? [];
  }

  get results() {
    return [...this.#results];
  }

  async run(command, args, options = {}) {
    await mkdir(this.directory, { recursive: true });
    this.#sequence += 1;
    const label = (options.label ?? path.basename(command))
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 60);
    const filename = `${String(this.#sequence).padStart(3, "0")}-${label || "command"}.log`;
    const logfile = path.join(this.directory, filename);
    const stream = createWriteStream(logfile, { encoding: "utf8" });
    const startedAt = new Date();
    const shownCommand = [command, ...args].join(" ");
    stream.write(`$ ${redact(shownCommand, this.secrets)}\n`);
    const stdout = [];
    const stderr = [];
    const pending = { stderr: "", stdout: "" };
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let sensitiveMatchCount = 0;
    const captureLimit = options.captureLimitBytes ?? 8 * 1024 * 1024;
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...this.environment, ...options.environment },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
    const flush = (target, raw, channel) => {
      for (const secret of this.secrets) {
        if (secret.length === 0) continue;
        let offset = 0;
        while ((offset = raw.indexOf(secret, offset)) >= 0) {
          sensitiveMatchCount += 1;
          offset += secret.length;
        }
      }
      const text = redact(raw, this.secrets);
      stream.write(text);
      if (options.stream === true) {
        const output = channel === "stdout" ? process.stdout : process.stderr;
        output.write(text);
      }
      const bytes = Buffer.byteLength(text);
      if (target === stdout) stdoutBytes += bytes;
      else stderrBytes += bytes;
      const total = target === stdout ? stdoutBytes : stderrBytes;
      if (total <= captureLimit) target.push(text);
    };
    const consume = (target, chunk, channel) => {
      const raw = pending[channel] + chunk.toString("utf8");
      const lineEnd = raw.lastIndexOf("\n") + 1;
      if (lineEnd === 0) {
        pending[channel] = raw;
        return;
      }
      pending[channel] = raw.slice(lineEnd);
      flush(target, raw.slice(0, lineEnd), channel);
    };
    child.stdout.on("data", (chunk) => consume(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => consume(stderr, chunk, "stderr"));
    const outcome = await new Promise((resolve, reject) => {
      let spawnError;
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => {
        if (spawnError !== undefined) reject(spawnError);
        else resolve({ code: code ?? 1, signal });
      });
    }).finally(() => {
      flush(stdout, pending.stdout, "stdout");
      flush(stderr, pending.stderr, "stderr");
      return new Promise((resolve) => {
        stream.end(resolve);
      });
    });
    const finishedAt = new Date();
    const result = {
      command: redact(shownCommand, this.secrets),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitCode: outcome.code,
      finishedAt: finishedAt.toISOString(),
      log: filename,
      signal: outcome.signal,
      sensitiveMatchCount,
      startedAt: startedAt.toISOString(),
      stderr: stderr.join(""),
      stdout: stdout.join(""),
      truncated: stdoutBytes > captureLimit || stderrBytes > captureLimit,
    };
    this.#results.push({
      command: result.command,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      log: result.log,
      sensitiveMatchCount: result.sensitiveMatchCount,
      signal: result.signal,
    });
    if (options.allowFailure !== true && result.exitCode !== 0) {
      const error = new Error(`${result.command} exited with ${String(result.exitCode)}`);
      error.commandResult = result;
      throw error;
    }
    return result;
  }
}

export class ComposeProject {
  constructor(project, runner, environment = {}, profiles = ["test", "demo"]) {
    this.project = assertQaProject(project);
    this.runner = runner;
    this.environment = environment;
    this.prefix = [
      "compose",
      "-p",
      project,
      ...profiles.flatMap((profile) => ["--profile", profile]),
    ];
  }

  run(args, options = {}) {
    return this.runner.run("docker", [...this.prefix, ...args], {
      ...options,
      environment: { ...this.environment, ...options.environment },
    });
  }

  async serviceContainer(service) {
    const result = await this.run(["ps", "--quiet", service], {
      label: `container-${service}`,
    });
    const id = result.stdout.trim();
    if (!/^[a-f0-9]{12,64}$/u.test(id)) throw new Error(`No safe container ID for ${service}.`);
    return id;
  }

  async mappedPort(service, internalPort) {
    const result = await this.run(["port", service, String(internalPort)], {
      label: `port-${service}`,
    });
    const match = /:(\d+)\s*$/u.exec(result.stdout.trim());
    if (match?.[1] === undefined) throw new Error(`Unexpected ${service} port mapping.`);
    return Number(match[1]);
  }

  async listOwnedResources(labelPrefix = "resolved-project") {
    const containers = await this.runner.run(
      "docker",
      [
        "ps",
        "--all",
        "--filter",
        `label=com.docker.compose.project=${this.project}`,
        "--format",
        "{{json .}}",
      ],
      { label: `${labelPrefix}-containers` },
    );
    const volumes = await this.runner.run(
      "docker",
      [
        "volume",
        "ls",
        "--filter",
        `label=com.docker.compose.project=${this.project}`,
        "--format",
        "{{json .}}",
      ],
      { label: `${labelPrefix}-volumes` },
    );
    const networks = await this.runner.run(
      "docker",
      [
        "network",
        "ls",
        "--filter",
        `label=com.docker.compose.project=${this.project}`,
        "--format",
        "{{json .}}",
      ],
      { label: `${labelPrefix}-networks` },
    );
    return {
      containers: parseJsonRecords(containers.stdout, "project container inventory"),
      networks: parseJsonRecords(networks.stdout, "project network inventory"),
      project: this.project,
      volumes: parseJsonRecords(volumes.stdout, "project volume inventory"),
    };
  }

  async assertOwnedResources(labelPrefix = "resolved-project") {
    const resolved = await this.listOwnedResources(labelPrefix);
    for (const [kind, entries] of [
      ["container", resolved.containers],
      ["volume", resolved.volumes],
      ["network", resolved.networks],
    ]) {
      for (const entry of entries) {
        const name = entry.Names ?? entry.Name;
        const labels = String(entry.Labels ?? "")
          .split(",")
          .map((label) => label.trim());
        if (
          typeof name !== "string" ||
          (!name.startsWith(`${this.project}-`) && !name.startsWith(`${this.project}_`)) ||
          !labels.includes(`com.docker.compose.project=${this.project}`)
        ) {
          throw new Error(
            `Resolved ${kind} is not exactly owned by ${this.project}: ${JSON.stringify(entry)}`,
          );
        }
      }
    }
    return resolved;
  }

  async assertNoOwnedResources(labelPrefix = "post-teardown") {
    const resolved = await this.listOwnedResources(labelPrefix);
    if (
      resolved.containers.length > 0 ||
      resolved.volumes.length > 0 ||
      resolved.networks.length > 0
    ) {
      throw new Error(`Validated QA teardown left project resources: ${JSON.stringify(resolved)}`);
    }
    return resolved;
  }

  async teardown() {
    const targets = await this.assertOwnedResources("teardown-targets");
    let down;
    let downError;
    try {
      down = await this.run(["down", "--volumes", "--remove-orphans", "--timeout", "20"], {
        allowFailure: true,
        label: "safe-teardown",
      });
    } catch (error) {
      downError = error;
    }
    let removed;
    let removalError;
    try {
      removed = await this.assertNoOwnedResources("post-teardown");
    } catch (error) {
      removalError = error;
    }
    if (downError !== undefined || down?.exitCode !== 0 || removalError !== undefined) {
      const error = new Error(
        `Validated QA teardown failed (down=${downError === undefined ? String(down?.exitCode) : "error"}, absence=${removalError === undefined ? "pass" : "fail"}).`,
      );
      error.evidence = {
        absenceFailure:
          removalError instanceof Error
            ? { message: removalError.message, name: removalError.name }
            : removalError === undefined
              ? null
              : { message: String(removalError), name: "NonErrorThrown" },
        downExitCode: down?.exitCode ?? null,
        downFailure:
          downError instanceof Error
            ? { message: downError.message, name: downError.name }
            : downError === undefined
              ? null
              : { message: String(downError), name: "NonErrorThrown" },
        removed,
        targets,
      };
      throw error;
    }
    return { down, removed, targets };
  }
}

export async function hashWorkspace(root) {
  const runner = new EvidenceCommandRunner(path.join(root, "artifacts", "verification", ".hash"));
  const filesResult = await runner.run(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, label: "workspace-files" },
  );
  const files = filesResult.stdout.split("\0").filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(path.join(root, file)));
    hash.update("\0");
  }
  return { algorithm: "sha256", files: files.length, value: hash.digest("hex") };
}
