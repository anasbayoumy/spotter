import { sessionSchema, todaySchema, type Session, type Today } from "@spotter/contracts";
import { describe, expect, it } from "vitest";

import { selectHistorySessions } from "./history/view-model";
import { assertPublishedToday } from "./today/contract";
import { deriveTodayState } from "./today/view-model";

const ids = {
  approvedBy: "00000000-0000-4000-8000-000000000001",
  client: "00000000-0000-4000-8000-000000000002",
  coach: "00000000-0000-4000-8000-000000000003",
  exercise: "00000000-0000-4000-8000-000000000004",
  programme: "00000000-0000-4000-8000-000000000005",
  session: "00000000-0000-4000-8000-000000000006",
} as const;

function session(patch: Readonly<Partial<Session>> = {}): Session {
  return sessionSchema.parse({
    actual: null,
    clientId: ids.client,
    id: ids.session,
    notes: null,
    performedAt: null,
    planned: [
      {
        family: "horizontal_pull",
        id: ids.exercise,
        muscleGroups: ["back"],
        name: "Cable row",
        notes: null,
        reps: 10,
        restSeconds: 90,
        rpe: 7,
        sets: 1,
      },
    ],
    programmeId: ids.programme,
    rpe: null,
    scheduledFor: "2026-08-03",
    status: "scheduled",
    version: 1,
    ...patch,
  });
}

function today(patch: Readonly<Partial<Today>> = {}): Today {
  return todaySchema.parse({
    clientId: ids.client,
    localDate: "2026-08-03",
    nextSession: null,
    outstandingMessage: null,
    programme: {
      approvedAt: "2026-08-01T06:00:00.000Z",
      approvedBy: ids.approvedBy,
      clientId: ids.client,
      createdAt: "2026-08-01T05:00:00.000Z",
      generatedBy: ids.coach,
      id: ids.programme,
      mesocycle: 1,
      payload: {
        days: [
          {
            dayIndex: 1,
            exercises: session().planned,
            focus: "Pull strength",
            scheduledDate: "2026-08-03",
          },
        ],
        summary: "A synthetic approved plan.",
      },
      reviewBand: "clear",
      status: "published",
      supersededBy: null,
      validFrom: "2026-08-01T06:00:00.000Z",
      version: 1,
      week: 1,
    },
    session: null,
    timezone: "Africa/Cairo",
    ...patch,
  });
}

describe("Today client states", () => {
  it("distinguishes no plan, rest, due, and already completed", () => {
    expect(deriveTodayState(today({ programme: null }))).toEqual({ kind: "no-programme" });
    expect(deriveTodayState(today())).toEqual({ kind: "rest-day", nextSession: null });
    expect(deriveTodayState(today({ session: session() }))).toMatchObject({ kind: "due" });
    expect(
      deriveTodayState(
        today({
          session: session({
            actual: [
              {
                exerciseId: ids.exercise,
                sets: [{ completed: true, loadKg: 20, reps: 10, rpe: 7, setIndex: 1 }],
              },
            ],
            performedAt: "2026-08-03T07:00:00.000Z",
            rpe: 7,
            status: "completed",
          }),
        }),
      ),
    ).toMatchObject({ kind: "already-completed" });
  });

  it("fails closed for draft/superseded content or sessions outside the published programme", () => {
    const published = today();
    if (published.programme === null) throw new Error("Test programme is required.");
    const programme = published.programme;
    expect(() =>
      assertPublishedToday({
        ...published,
        programme: {
          ...programme,
          approvedAt: null,
          approvedBy: null,
          status: "draft",
          validFrom: null,
        },
      }),
    ).toThrow(/not currently published/u);
    expect(() =>
      assertPublishedToday({
        ...published,
        programme: {
          ...programme,
          supersededBy: "00000000-0000-4000-8000-000000000098",
        },
      }),
    ).toThrow(/not currently published/u);
    expect(() =>
      assertPublishedToday({
        ...published,
        session: session({ programmeId: "00000000-0000-4000-8000-000000000099" }),
      }),
    ).toThrow(/outside the current published programme/u);
    expect(() =>
      assertPublishedToday({
        ...published,
        nextSession: session({ programmeId: "00000000-0000-4000-8000-000000000097" }),
      }),
    ).toThrow(/outside the current published programme/u);
  });

  it("rejects orphan Today sessions and returns a valid published read model unchanged", () => {
    const published = today();
    expect(assertPublishedToday(published)).toBe(published);
    expect(() =>
      assertPublishedToday({ ...published, programme: null, session: session() }),
    ).toThrow(/without a current published programme/u);
    expect(() =>
      assertPublishedToday({ ...published, nextSession: session(), programme: null }),
    ).toThrow(/without a current published programme/u);
  });
});

describe("History ordering", () => {
  it("includes only completed/missed sessions in stable newest-first order", () => {
    const result = selectHistorySessions([
      session({ id: "00000000-0000-4000-8000-000000000011", scheduledFor: "2026-08-04" }),
      session({
        id: "00000000-0000-4000-8000-000000000012",
        scheduledFor: "2026-08-01",
        status: "missed",
      }),
      session({
        actual: [
          {
            exerciseId: ids.exercise,
            sets: [{ completed: true, loadKg: null, reps: 10, rpe: null, setIndex: 1 }],
          },
        ],
        id: "00000000-0000-4000-8000-000000000013",
        performedAt: "2026-08-02T06:00:00.000Z",
        rpe: 7,
        scheduledFor: "2026-08-02",
        status: "completed",
      }),
    ]);
    expect(result.map(({ scheduledFor }) => scheduledFor)).toEqual(["2026-08-02", "2026-08-01"]);
  });

  it("uses stable ID order when two history records share a date", () => {
    const result = selectHistorySessions([
      session({
        id: "00000000-0000-4000-8000-000000000022",
        scheduledFor: "2026-08-01",
        status: "missed",
      }),
      session({
        id: "00000000-0000-4000-8000-000000000021",
        scheduledFor: "2026-08-01",
        status: "missed",
      }),
    ]);
    expect(result.map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000021",
      "00000000-0000-4000-8000-000000000022",
    ]);
  });
});
