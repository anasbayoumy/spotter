import { Audit } from "lighthouse/core/audits/audit.js";
import BaseGatherer from "lighthouse/core/gather/base-gatherer.js";

/* global document, window */

function normalizedPathname(value) {
  const pathname = new URL(value, "http://performance.invalid").pathname.replace(/\/+$/u, "");
  return pathname === "" ? "/" : pathname;
}

function collectLoadedState(expected) {
  const normalize = (value) =>
    String(value ?? "")
      .replace(/\s+/gu, " ")
      .trim();
  const expectedText = normalize(expected.name);
  const candidates = [...document.querySelectorAll("body *")];
  const match = candidates.find((element) => {
    if (expected.kind === "label") {
      return (
        (element.tagName.toLowerCase() === "label" &&
          normalize(element.textContent) === expectedText) ||
        normalize(element.getAttribute("aria-label")) === expectedText
      );
    }
    if (normalize(element.textContent) !== expectedText) return false;
    const role = element.getAttribute("role");
    const nativeHeading = /^h[1-6]$/iu.test(element.tagName);
    return role === expected.role || (expected.role === "heading" && nativeHeading);
  });
  const visible =
    match !== undefined &&
    (() => {
      const style = window.getComputedStyle(match);
      const rectangle = match.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rectangle.width > 0 &&
        rectangle.height > 0
      );
    })();
  return {
    expectedPath: expected.path,
    finalPath: window.location.pathname,
    marker: { kind: expected.kind, name: expected.name, role: expected.role ?? null },
    match:
      match === undefined
        ? null
        : {
            tagName: match.tagName.toLowerCase(),
            text:
              expected.kind === "label"
                ? normalize(match.getAttribute("aria-label") ?? match.textContent)
                : normalize(match.textContent),
          },
    visible,
  };
}

const defaultPollIntervalMs = 100;
const defaultTimeoutMs = 30_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function validateLoadedStateArtifact(artifact) {
  const expectedPath = normalizedPathname(artifact?.expectedPath ?? "");
  const finalPath = normalizedPathname(artifact?.finalPath ?? "");
  const marker = artifact?.marker;
  const valid =
    expectedPath === finalPath &&
    artifact?.visible === true &&
    artifact?.match !== null &&
    typeof marker?.name === "string" &&
    marker.name.length > 0 &&
    artifact.match?.text === marker.name;
  return {
    ...artifact,
    expectedPath,
    finalPath,
    valid,
  };
}

export class SpotterLoadedStateGatherer extends BaseGatherer {
  meta = { supportedModes: ["navigation"] };

  constructor(target, options = {}) {
    super();
    this.target = target;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
    this.sleep = options.sleep ?? sleep;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  }

  async getArtifact(passContext) {
    const expected = {
      ...this.target.ready,
      path: normalizedPathname(this.target.route),
    };
    const deadline = this.now() + this.timeoutMs;
    for (;;) {
      const artifact = validateLoadedStateArtifact(
        await passContext.driver.executionContext.evaluate(collectLoadedState, {
          args: [expected],
          useIsolation: true,
        }),
      );
      if (artifact.valid) return artifact;
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) return artifact;
      await this.sleep(Math.min(this.pollIntervalMs, remainingMs));
    }
  }
}

export class SpotterLoadedStateAudit extends Audit {
  static get meta() {
    return {
      description:
        "Verifies that this exact measured navigation reached its route-specific loaded state.",
      failureTitle: "The measured route did not expose its loaded-state marker",
      id: "spotter-loaded-state",
      requiredArtifacts: ["SpotterLoadedState"],
      scoreDisplayMode: Audit.SCORING_MODES.BINARY,
      title: "Measured route exposed its loaded-state marker",
    };
  }

  static audit(artifacts) {
    const proof = validateLoadedStateArtifact(artifacts.SpotterLoadedState);
    return {
      details: { items: [proof], type: "debugdata" },
      numericValue: proof.valid ? 1 : 0,
      score: proof.valid ? 1 : 0,
    };
  }
}

export function loadedStateProofFromLighthouse(result, target) {
  const audit = result?.lhr?.audits?.["spotter-loaded-state"];
  const proof = audit?.details?.items?.[0];
  const validated = validateLoadedStateArtifact(proof);
  const expected = {
    marker: {
      kind: target.ready.kind,
      name: target.ready.name,
      role: target.ready.role ?? null,
    },
    path: normalizedPathname(target.route),
  };
  if (
    audit?.score !== 1 ||
    !validated.valid ||
    validated.expectedPath !== expected.path ||
    validated.marker?.kind !== expected.marker.kind ||
    validated.marker?.name !== expected.marker.name ||
    validated.marker?.role !== expected.marker.role
  ) {
    const observed = {
      auditNumericValue: audit?.numericValue ?? null,
      auditScore: audit?.score ?? null,
      expectedPath: validated.expectedPath,
      finalPath: validated.finalPath,
      marker: validated.marker ?? null,
      match: validated.match ?? null,
      valid: validated.valid,
      visible: validated.visible ?? false,
    };
    throw new Error(
      `Lighthouse loaded-state proof failed for ${target.route}. Expected ${JSON.stringify(expected)}; observed ${JSON.stringify(observed)}.`,
    );
  }
  return validated;
}
