import type { Session } from "@spotter/contracts";

export function selectHistorySessions(sessions: readonly Session[]): readonly Session[] {
  return sessions
    .filter((session) => session.status === "completed" || session.status === "missed")
    .sort(
      (left, right) =>
        right.scheduledFor.localeCompare(left.scheduledFor) || left.id.localeCompare(right.id),
    );
}
