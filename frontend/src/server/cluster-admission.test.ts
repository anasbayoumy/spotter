import { describe, expect, it, vi } from "vitest";

import { ClusterAdmissionClient, type ClusterAdmissionTransport } from "./cluster-admission";
import { admissionProtocol, type AdmissionAcquireMessage } from "./deployment-admission.mjs";

class FakeTransport implements ClusterAdmissionTransport {
  public connected = true;
  public readonly messages: unknown[] = [];
  public callbackError: Error | null = null;
  #onDisconnect = (): void => undefined;
  #onMessage: (message: unknown) => void = (): void => undefined;

  public isConnected(): boolean {
    return this.connected;
  }

  public send(message: unknown, callback?: (error: Error | null) => void): void {
    this.messages.push(message);
    callback?.(this.callbackError);
  }

  public subscribe(onMessage: (message: unknown) => void, onDisconnect: () => void): () => void {
    this.#onMessage = onMessage;
    this.#onDisconnect = onDisconnect;
    return (): void => {
      this.#onMessage = (): void => undefined;
      this.#onDisconnect = (): void => undefined;
    };
  }

  public disconnect(): void {
    this.connected = false;
    this.#onDisconnect();
  }

  public respond(message: unknown): void {
    this.#onMessage(message);
  }
}

function acquisition(transport: FakeTransport): AdmissionAcquireMessage {
  const message = transport.messages[0];
  expect(message).toMatchObject({ type: admissionProtocol.acquire });
  return message as AdmissionAcquireMessage;
}

describe("cluster admission client", () => {
  it("acquires and releases a primary-owned generation slot exactly once", async () => {
    const transport = new FakeTransport();
    const client = new ClusterAdmissionClient(transport);
    const pending = client.acquire("generation", "default");
    const request = acquisition(transport);
    transport.respond({
      admissionId: "generation:1:1",
      correlationId: request.correlationId,
      granted: true,
      reason: null,
      type: admissionProtocol.result,
    });

    const release = await pending;
    release();
    release();
    expect(transport.messages).toHaveLength(2);
    expect(transport.messages[1]).toEqual({
      admissionId: "generation:1:1",
      type: admissionProtocol.release,
    });
    client.close();
  });

  it("maps primary denials without granting local fallback capacity", async () => {
    const transport = new FakeTransport();
    const client = new ClusterAdmissionClient(transport);
    const pending = client.acquire("read", "default");
    const request = acquisition(transport);
    transport.respond({
      admissionId: null,
      correlationId: request.correlationId,
      granted: false,
      reason: "rate_limited",
      type: admissionProtocol.result,
    });

    await expect(pending).rejects.toMatchObject({ code: "rate_limited" });
    client.close();
  });

  it("fails closed on send error, disconnect, and timeout", async () => {
    vi.useFakeTimers();
    const sendFailure = new FakeTransport();
    sendFailure.callbackError = new Error("closed");
    await expect(
      new ClusterAdmissionClient(sendFailure).acquire("read", "default"),
    ).rejects.toMatchObject({ code: "dependency_unavailable" });

    const disconnected = new FakeTransport();
    const disconnectClient = new ClusterAdmissionClient(disconnected);
    const pendingDisconnect = disconnectClient.acquire("read", "default");
    disconnected.disconnect();
    await expect(pendingDisconnect).rejects.toMatchObject({ code: "dependency_unavailable" });

    const silent = new FakeTransport();
    const timeoutClient = new ClusterAdmissionClient(silent, 25);
    const pendingTimeout = timeoutClient.acquire("read", "default");
    const timeoutExpectation = expect(pendingTimeout).rejects.toMatchObject({
      code: "dependency_unavailable",
    });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutExpectation;
    timeoutClient.close();
    disconnectClient.close();
    vi.useRealTimers();
  });
});
