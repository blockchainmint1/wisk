// Public, read-only ISK/wISK price feed for other Iskander services.
// GET /api/public/price -> { ok, usd, source, pool, feeBps, liquidity, timestamp }
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export const Route = createFileRoute("/api/public/price")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        try {
          const { getIskPrice } = await import("@/lib/price.server");
          const price = await getIskPrice();
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
