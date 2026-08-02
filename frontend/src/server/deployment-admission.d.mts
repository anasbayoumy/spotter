export type RequestClass = "cron" | "generation" | "mutation" | "read";
export type RequestLimitProfile = "default" | "load_test";
export type AdmissionDenialReason = "generation_queue_full" | "policy_mismatch" | "rate_limited";

export interface AdmissionAcquireMessage {
  readonly correlationId: string;
  readonly profile: RequestLimitProfile;
  readonly requestClass: RequestClass;
  readonly type: "spotter:admission:acquire:v1";
}

export interface AdmissionReleaseMessage {
  readonly admissionId: string;
  readonly type: "spotter:admission:release:v1";
}

export interface AdmissionResultMessage {
  readonly admissionId: string | null;
  readonly correlationId: string;
  readonly granted: boolean;
  readonly reason: AdmissionDenialReason | null;
  readonly type: "spotter:admission:result:v1";
}

export const admissionProtocol: Readonly<{
  acquire: AdmissionAcquireMessage["type"];
  release: AdmissionReleaseMessage["type"];
  result: AdmissionResultMessage["type"];
}>;

export function requestClassFor(path: string, mutation: boolean): RequestClass;
export function requestLimitsFor(
  profile: RequestLimitProfile,
): Readonly<Record<RequestClass, number>>;
export function isAdmissionAcquireMessage(value: unknown): value is AdmissionAcquireMessage;
export function isAdmissionReleaseMessage(value: unknown): value is AdmissionReleaseMessage;
export function isAdmissionResultMessage(value: unknown): value is AdmissionResultMessage;

export class DeploymentAdmissionController {
  public constructor(profile: RequestLimitProfile, now?: () => number);
  public readonly profile: RequestLimitProfile;
  public readonly limits: Readonly<Record<RequestClass, number>>;
  public readonly now: () => number;
  public acquire(
    workerId: number,
    requestClass: RequestClass,
    profile: RequestLimitProfile,
  ):
    | { readonly admissionId: string; readonly granted: true; readonly reason: null }
    | { readonly admissionId: null; readonly granted: true; readonly reason: null }
    | {
        readonly admissionId: null;
        readonly granted: false;
        readonly reason: AdmissionDenialReason;
      };
  public release(workerId: number, admissionId: string): boolean;
  public releaseWorker(workerId: number): number;
  public readonly generationInFlight: number;
}
