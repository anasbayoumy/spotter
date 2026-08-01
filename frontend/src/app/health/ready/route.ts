import { getBackendReadiness } from "@spotter/backend/server";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const health = await getBackendReadiness();
    if (!health.ready) {
      return Response.json(
        { status: "unavailable" },
        { headers: { "cache-control": "no-store" }, status: 503 },
      );
    }
    return Response.json(
      { dependencies: { database: "ready", schema: "ready" }, status: "ready" },
      { headers: { "cache-control": "no-store" }, status: 200 },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}
