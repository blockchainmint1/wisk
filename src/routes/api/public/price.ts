// Public, read-only ISK/wISK price feed for other Iskander services.
// GET /api/public/price -> { ok, usd, source, pool, feeBps, liquidity, timestamp }
import { createFileRoute } from "@tanstack/react-router";

/** Accepts "30m", "1h", "600s", or a bare number of seconds. */
function parseDuration(input: string): number {
  const m = /^(\d+)\s*([smh]?)$/i.exec(input.trim());
  if (!m) return 1800;
  const n = Number(m[1]);
  const unit = (m[2] || "s").toLowerCase();
  return unit === "h" ? n * 3600 : unit === "m" ? n * 60 : n;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export const Route = createFileRoute("/api/public/price")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const twapParam = url.searchParams.get("twap");
          const { getIskPrice, getIskTwap } = await import("@/lib/price.server");
          const price = twapParam
            ? await getIskTwap(parseDuration(twapParam))
            : await getIskPrice();
          return Response.json(
            { ok: true, ...price },
            {
              headers: {
                ...CORS,
                "cache-control": "public, max-age=20, s-maxage=20",
              },
            },
          );
        } catch (e) {
          console.error("[api/public/price]", e);
          return Response.json(
            { ok: false, error: "Price unavailable" },
            { status: 503, headers: { ...CORS, "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
