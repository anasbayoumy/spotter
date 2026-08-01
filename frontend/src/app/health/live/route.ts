export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(
    { status: "ok" },
    {
      headers: { "cache-control": "no-store" },
      status: 200,
    },
  );
}
