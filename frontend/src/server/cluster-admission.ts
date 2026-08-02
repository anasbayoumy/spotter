import { randomUUID } from "node:crypto";

import {
  admissionProtocol,
  isAdmissionResultMessage,
  type AdmissionAcquireMessage,
  type AdmissionReleaseMessage,
  type RequestClass,
  type RequestLimitProfile,
} from "./deployment-admission.mjs";

export interface ClusterAdmissionTransport {
  isConnected(): boolean;
  send(
    message: AdmissionAcquireMessage | AdmissionReleaseMessage,
    callback?: (error: Error | null) => void,
  ): void;
  subscribe(onMessage: (message: unknown) => void, onDisconnect: () => void): () => void;
}

interface PendingAdmission {
  readonly reject: (error: Error) => void;
  readonly resolve: (release: () => void) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class ClusterAdmissionError extends Error {
  public constructor(
    public readonly code: "dependency_unavailable" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "ClusterAdmissionError";
  }
}

export class ClusterAdmissionClient {
  readonly #pending = new Map<string, PendingAdmission>();
  readonly #unsubscribe: () => void;

  public constructor(
    private readonly transport: ClusterAdmissionTransport,
    private readonly timeoutMs = 2_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
      throw new Error("Cluster admission timeout must be between 1 and 10000 ms.");
    }
    this.#unsubscribe = transport.subscribe(
      (message) => {
        this.#handleMessage(message);
      },
      () => {
        this.#failPending("Cluster admission disconnected.");
      },
    );
  }

  public async acquire(
    requestClass: RequestClass,
    profile: RequestLimitProfile,
  ): Promise<() => void> {
    if (!this.transport.isConnected()) {
      throw new ClusterAdmissionError(
        "dependency_unavailable",
        "Cluster admission is unavailable.",
      );
    }
    const correlationId = `${String(process.pid)}:${randomUUID()}`;
    return new Promise<() => void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(correlationId);
        reject(
          new ClusterAdmissionError(
            "dependency_unavailable",
            "Cluster admission exceeded its deadline.",
          ),
        );
      }, this.timeoutMs);
      this.#pending.set(correlationId, { reject, resolve, timeout });
      this.transport.send(
        { correlationId, profile, requestClass, type: admissionProtocol.acquire },
        (error) => {
          if (error === null) return;
          const pending = this.#pending.get(correlationId);
          if (pending === undefined) return;
          clearTimeout(pending.timeout);
          this.#pending.delete(correlationId);
          pending.reject(
            new ClusterAdmissionError(
              "dependency_unavailable",
              "Cluster admission could not be requested.",
            ),
          );
        },
      );
    });
  }

  public close(): void {
    this.#unsubscribe();
    this.#failPending("Cluster admission closed.");
  }

  #failPending(message: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new ClusterAdmissionError("dependency_unavailable", message));
    }
    this.#pending.clear();
  }

  #handleMessage(message: unknown): void {
    if (!isAdmissionResultMessage(message)) return;
    const pending = this.#pending.get(message.correlationId);
    if (pending === undefined) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(message.correlationId);
    if (!message.granted) {
      pending.reject(
        message.reason === "policy_mismatch"
          ? new ClusterAdmissionError(
              "dependency_unavailable",
              "Cluster admission policy is unavailable.",
            )
          : new ClusterAdmissionError("rate_limited", "The request limit was reached."),
      );
      return;
    }
    let released = false;
    pending.resolve(() => {
      if (released || message.admissionId === null) return;
      released = true;
      if (!this.transport.isConnected()) return;
      this.transport.send({ admissionId: message.admissionId, type: admissionProtocol.release });
    });
  }
}
