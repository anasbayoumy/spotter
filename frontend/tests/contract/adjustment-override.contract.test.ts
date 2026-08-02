import { apiContracts, programmeSchema } from "@spotter/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ override: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@spotter/backend/server", () => ({
  getBackend: () => Promise.resolve({ adjustments: { override: mocks.override } }),
}));

import { POST } from "../../src/app/api/v1/adjustments/[adjustmentId]/override/route";

const adjustmentId = "00000000-0000-4000-8000-000000001001";
const programme = programmeSchema.parse({
  approvedAt: "2026-08-02T12:00:00.000Z",
  approvedBy: "00000000-0000-4000-8000-000000000001",
  clientId: "00000000-0000-4000-8000-000000000107",
  createdAt: "2026-08-02T12:00:00.000Z",
  generatedBy: "00000000-0000-4000-8000-000000000401",
  id: "00000000-0000-4000-8000-000000000608",
  mesocycle: 1,
  payload: {
    days: [
      {
        dayIndex: 1,
        exercises: [
          {
            family: "horizontal_pull",
            id: "00000000-0000-4000-8000-000000000301",
            loadKg: 30,
            muscleGroups: ["back"],
            name: "Row ergometer intervals",
            notes: null,
            reps: 8,
            restSeconds: 90,
            rpe: 7,
            sets: 4,
          },
        ],
        focus: "Aerobic intervals",
        scheduledDate: "2026-08-03",
      },
    ],
    summary: "Synthetic override result.",
  },
  reviewBand: "blocked",
  status: "published",
  supersededBy: null,
  validFrom: "2026-08-02T12:00:00.000Z",
  version: 2,
  week: 1,
});

function routeContext(): { readonly params: Promise<{ readonly adjustmentId: string }> } {
  return { params: Promise.resolve({ adjustmentId }) };
}

function request(body: unknown): Request {
  return new Request(`http://local/api/v1/adjustments/${adjustmentId}/override`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "idempotency-key": "adjustment-override-contract-001",
    },
    method: "POST",
  });
}

describe("adjustment override route contract", () => {
  beforeEach(() => {
    mocks.override.mockReset();
    mocks.override.mockResolvedValue(programme);
  });

  it("passes a strict reasoned override through the shared envelope", async () => {
    const response = await POST(
      request({ expectedVersion: 1, reason: "  Coach accepts the blocked finding.  " }),
      routeContext(),
    );
    expect(response.status).toBe(200);
    const envelope = apiContracts.adjustments.override.output.parse(await response.json());
    expect(envelope.error).toBeNull();
    expect(envelope.data).toEqual(programme);
    expect(mocks.override).toHaveBeenCalledWith(
      adjustmentId,
      { expectedVersion: 1, reason: "Coach accepts the blocked finding." },
      expect.objectContaining({ idempotencyKey: "adjustment-override-contract-001" }),
    );
  });

  it.each([
    { expectedVersion: 1, reason: "" },
    { expectedVersion: 1, reason: "valid", reviewBand: "clear" },
  ])("rejects missing reasons and server-owned fields", async (body) => {
    const response = await POST(request(body), routeContext());
    expect(response.status).toBe(400);
    expect(apiContracts.adjustments.override.output.parse(await response.json()).error?.code).toBe(
      "validation_failed",
    );
    expect(mocks.override).not.toHaveBeenCalled();
  });
});
