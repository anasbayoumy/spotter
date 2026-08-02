import { performance } from "node:perf_hooks";

export function percentile(values, quantile) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
}

export function summarize(values) {
  if (values.length === 0) throw new Error("Cannot summarize an empty measurement set.");
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    total += value;
  }
  return {
    samples: values.length,
    minimumMs: minimum,
    meanMs: total / values.length,
    p50Ms: percentile(values, 0.5),
    p90Ms: percentile(values, 0.9),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maximumMs: maximum,
  };
}

export function medianRun(runs, selector) {
  if (runs.length !== 3)
    throw new Error("Release performance evidence requires exactly three runs.");
  return [...runs].sort((left, right) => selector(left) - selector(right))[1];
}

export function summarizeByPath(measurements) {
  const grouped = new Map();
  for (const measurement of measurements) {
    const bucket = grouped.get(measurement.path) ?? {
      errors: 0,
      latencies: [],
      statusCounts: {},
      validationErrors: 0,
    };
    bucket.latencies.push(measurement.durationMs);
    const status = String(measurement.status);
    bucket.statusCounts[status] = (bucket.statusCounts[status] ?? 0) + 1;
    if (measurement.error !== undefined) bucket.errors += 1;
    if (measurement.validationError === true) bucket.validationErrors += 1;
    grouped.set(measurement.path, bucket);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([route, bucket]) => [
        route,
        {
          ...summarize(bucket.latencies),
          errorCount: bucket.errors,
          errorRate: bucket.errors / bucket.latencies.length,
          statusCounts: bucket.statusCounts,
          validationErrorCount: bucket.validationErrors,
        },
      ]),
  );
}

export class HttpLoadRunner {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async request(specification) {
    const started = performance.now();
    let response;
    let body;
    let error;
    try {
      response = await fetch(`${this.baseUrl}${specification.path}`, {
        body: specification.body === undefined ? undefined : JSON.stringify(specification.body),
        headers: {
          ...this.defaultHeaders,
          ...(specification.body === undefined ? {} : { "content-type": "application/json" }),
          ...specification.headers,
        },
        method: specification.method ?? "GET",
        signal: AbortSignal.timeout(specification.timeoutMs ?? 10_000),
      });
      const text = await response.text();
      try {
        body = text.length === 0 ? null : JSON.parse(text);
      } catch {
        body = text;
      }
      if (!response.ok) error = `HTTP ${String(response.status)}`;
    } catch (requestError) {
      error = requestError instanceof Error ? requestError.message : String(requestError);
    }
    const result = {
      body,
      durationMs: performance.now() - started,
      error,
      requestId: response?.headers.get("x-request-id") ?? null,
      status: response?.status ?? 0,
    };
    try {
      specification.validate?.(result);
    } catch (validationError) {
      result.error =
        validationError instanceof Error
          ? `Response validation: ${validationError.message}`
          : `Response validation: ${String(validationError)}`;
      result.validationError = true;
    }
    return result;
  }

  async batch(options) {
    if (options.specifications.length === 0) {
      throw new Error("A measured request batch cannot be empty.");
    }
    const virtualUsers = Math.min(options.virtualUsers, options.specifications.length);
    if (!Number.isSafeInteger(virtualUsers) || virtualUsers < 1) {
      throw new Error("A measured request batch requires at least one virtual user.");
    }
    const startedAt = new Date();
    const results = Array.from({ length: options.specifications.length });
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: virtualUsers }, async () => {
        while (nextIndex < options.specifications.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await this.request(options.specifications[index]);
        }
      }),
    );
    const latencies = results.map((result) => result.durationMs);
    const errors = results.flatMap((result, index) =>
      result.error === undefined
        ? []
        : [
            {
              error: result.error,
              index,
              path: options.specifications[index].path,
              requestId: result.requestId,
              status: result.status,
            },
          ],
    );
    return {
      ...summarize(latencies),
      durationMs: Date.now() - startedAt.getTime(),
      errorCount: errors.length,
      errorRate: errors.length / results.length,
      errors,
      validationErrorCount: results.filter((result) => result.validationError === true).length,
      finishedAt: new Date().toISOString(),
      results,
      scenario: options.name,
      startedAt: startedAt.toISOString(),
      virtualUsers,
    };
  }

  async load(options) {
    const startedAt = new Date();
    const deadline = performance.now() + options.durationMs;
    const latencies = [];
    const errors = [];
    const pathMeasurements = [];
    const statusCounts = {};
    let validationErrorCount = 0;
    let sequence = 0;
    await Promise.all(
      Array.from({ length: options.virtualUsers }, (_, virtualUser) =>
        (async () => {
          while (performance.now() < deadline) {
            const current = sequence;
            sequence += 1;
            const specification = options.scenario({ sequence: current, virtualUser });
            const result = await this.request(specification);
            latencies.push(result.durationMs);
            pathMeasurements.push({
              durationMs: result.durationMs,
              error: result.error,
              path: specification.path,
              status: result.status,
              validationError: result.validationError,
            });
            const status = String(result.status);
            statusCounts[status] = (statusCounts[status] ?? 0) + 1;
            if (result.error !== undefined) {
              if (result.validationError === true) validationErrorCount += 1;
              errors.push({
                error: result.error,
                path: specification.path,
                requestId: result.requestId,
                status: result.status,
              });
            }
          }
        })(),
      ),
    );
    const summary = summarize(latencies);
    return {
      ...summary,
      durationMs: new Date().getTime() - startedAt.getTime(),
      errorCount: errors.length,
      errorRate: errors.length / latencies.length,
      errors: errors.slice(0, 100),
      finishedAt: new Date().toISOString(),
      pathMetrics: summarizeByPath(pathMeasurements),
      scenario: options.name,
      startedAt: startedAt.toISOString(),
      statusCounts,
      validationErrorCount,
      virtualUsers: options.virtualUsers,
    };
  }
}
