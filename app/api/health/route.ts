export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ ok: true, time: new Date().toISOString() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export function HEAD(): Response {
  return new Response(null, { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } });
}
