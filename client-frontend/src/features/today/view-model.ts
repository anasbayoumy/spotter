import type { Session, Today } from "@spotter/contracts";

export type TodayState =
  | { readonly kind: "already-completed"; readonly session: Session }
  | { readonly kind: "due"; readonly session: Session }
  | { readonly kind: "no-programme" }
  | { readonly kind: "rest-day"; readonly nextSession: Session | null };

export function deriveTodayState(today: Today): TodayState {
  if (today.programme === null) return { kind: "no-programme" };
  if (today.session === null) return { kind: "rest-day", nextSession: today.nextSession };
  if (today.session.status === "completed") {
    return { kind: "already-completed", session: today.session };
  }
  return { kind: "due", session: today.session };
}
