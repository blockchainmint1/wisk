import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

const BASE = "https://wisk.iskandercoin.com";
const POOL = "0xF364A7EA901569B4eA3d0e5bFE2cCDDFB1063142";
const CONTRACT = "0xFB38867D064Df981F159b886007F1273a346b0BB";

const TITLE = "wISK API — Public ISK Price & TWAP Endpoints";
const DESCRIPTION =
  "Free, CORS-open JSON endpoints for the Iskander Coin (ISK) price: live spot from the wISK/USDC Uniswap V3 pool plus a manipulation-resistant TWAP.";

export const Route = createFileRoute("/api/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BASE}/api` },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: `${BASE}/api` }],
  }),
  component: ApiPage,
});

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-muted/40 border border-border rounded-md p-4 overflow-x-auto text-[11px] font-mono leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Row({ name, type, desc }: { name: string; type: string; desc: string }) {
  return (
    <tr className="border-b border-border/60 align-top">
      <td className="py-2 pr-4 font-mono text-xs text-foreground whitespace-nowrap">{name}</td>
      <td className="py-2 pr-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground whitespace-nowrap">
        {type}
      </td>
      <td className="py-2 text-xs text-muted-foreground leading-relaxed">{desc}</td>
    </tr>
  );
}

function LiveProbe() {
  const [spot, setSpot] = useState<string>("…");
  const [twap, setTwap] = useState<string>("…");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/api/public/price").then((r) => r.json()),
          fetch("/api/public/price?twap=30m").then((r) => r.json()),
        ]);
        if (!alive) return;
        setSpot(a?.ok ? `$${Number(a.usd).toFixed(6)}` : "unavailable");
        setTwap(
          b?.ok
            ? `$${Number(b.usd).toFixed(6)} · ${Math.round((b.windowSeconds ?? 0) / 60)}m window`
            : "unavailable",
        );
      } catch {
        if (alive) {
          setSpot("unavailable");
          setTwap("unavailable");
        }
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {[
        { label: "Spot", value: spot },
        { label: "30m TWAP", value: twap },
      ].map((x) => (
        <div key={x.label} className="border border-border rounded-md p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {x.label}
          </div>
          <div className="text-2xl font-extrabold tracking-tighter mt-1">{x.value}</div>
        </div>
      ))}
    </div>
  );
}

function ApiPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 py-16 md:py-24">
        <div className="mb-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Developers
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter leading-none">
            Public <span className="text-accent">API</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-4 max-w-prose leading-relaxed">
            One endpoint, no API key, no rate-limit signup, CORS open to everyone. The ISK price is
            read straight from the{" "}
            <a
              href={`https://app.uniswap.org/explore/pools/ethereum/${POOL}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              wISK/USDC 0.3% Uniswap V3 pool
            </a>{" "}
            on Ethereum mainnet — there is no third-party price API in the path.
          </p>
        </div>

        <section className="mb-14">
          <h2 className="text-base font-bold tracking-tight mb-4">Live right now</h2>
          <LiveProbe />
        </section>

        <section className="mb-14">
          <h2 className="text-base font-bold tracking-tight mb-2">Spot price</h2>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Current pool price from <code className="font-mono">slot0()</code>. Cached 20 seconds at
            the edge. Use this for display: tickers, wallets, dashboards.
          </p>
          <Code>{`GET ${BASE}/api/public/price`}</Code>
          <div className="h-3" />
          <Code>{`{
  "ok": true,
  "usd": 0.10074192,
  "source": "uniswap-v3",
  "pool": "${POOL}",
  "feeBps": 3000,
  "liquidity": "316227766016",
  "timestamp": "2026-08-28T14:00:00.000Z"
}`}</Code>
        </section>

        <section className="mb-14">
          <h2 className="text-base font-bold tracking-tight mb-2">TWAP (time-weighted average)</h2>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            Add <code className="font-mono">?twap=</code> to get the average price over a window,
            computed from the pool's built-in observation oracle. Because it averages across every
            block in the window, a single large trade barely moves it — an attacker would have to
            hold a fake price for the whole window and eat arbitrage the entire time. Use this for
            anything settlement-critical: collateral, invoicing, payouts.
          </p>
          <Code>{`GET ${BASE}/api/public/price?twap=30m
GET ${BASE}/api/public/price?twap=1h
GET ${BASE}/api/public/price?twap=600s   # or a bare number of seconds`}</Code>
          <div className="h-3" />
          <Code>{`{
  "ok": true,
  "usd": 0.10074277,
  "windowSeconds": 1800,
  "requestedSeconds": 1800,
  "truncated": false,
  "spotUsd": 0.10074277,
  "source": "uniswap-v3",
  "pool": "${POOL}",
  "feeBps": 3000,
  "liquidity": "316227766016",
  "timestamp": "2026-08-28T14:00:00.000Z"
}`}</Code>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Windows run from 60 seconds to 24 hours. If the pool's oracle can't reach back as far as
            you asked, the endpoint automatically falls back to the longest window it can prove
            (1h → 30m → 10m → 5m → 1m) and returns{" "}
            <code className="font-mono">truncated: true</code> with the{" "}
            <code className="font-mono">windowSeconds</code> it actually used. Always read{" "}
            <code className="font-mono">windowSeconds</code>, not the one you requested.
          </p>
        </section>

        <section className="mb-14">
          <h2 className="text-base font-bold tracking-tight mb-4">Response fields</h2>
          <table className="w-full text-left">
            <tbody>
              <Row name="ok" type="bool" desc="False on failure; the body then carries `error` and the status is 503." />
              <Row name="usd" type="number" desc="ISK price in USD. Spot, or the TWAP average when ?twap is set." />
              <Row name="spotUsd" type="number" desc="TWAP responses only — the instantaneous price alongside the average, so you can measure divergence." />
              <Row name="windowSeconds" type="number" desc="TWAP responses only — the window actually averaged. 0 means the oracle had no usable history and `usd` fell back to spot." />
              <Row name="requestedSeconds" type="number" desc="TWAP responses only — the window you asked for." />
              <Row name="truncated" type="bool" desc="TWAP responses only — true when windowSeconds is shorter than requestedSeconds." />
              <Row name="source" type="string" desc='Always "uniswap-v3".' />
              <Row name="pool" type="address" desc="The Uniswap V3 pool the quote came from." />
              <Row name="feeBps" type="number" desc="Pool fee tier in hundredths of a bip — 3000 = 0.3%." />
              <Row name="liquidity" type="string" desc="Raw pool L value. A rough depth signal; not a dollar figure." />
              <Row name="timestamp" type="string" desc="ISO-8601 time the quote was computed server-side." />
            </tbody>
          </table>
        </section>

        <section className="mb-14">
          <h2 className="text-base font-bold tracking-tight mb-4">Examples</h2>
          <Code>{`# curl
curl -s '${BASE}/api/public/price?twap=30m'

# JavaScript
const r = await fetch('${BASE}/api/public/price?twap=30m');
const { ok, usd, windowSeconds } = await r.json();

# Python
import requests
p = requests.get('${BASE}/api/public/price', timeout=10).json()['usd']`}</Code>
        </section>

        <section className="mb-14">
          <h2 className="text-base font-bold tracking-tight mb-4">Notes & limits</h2>
          <ul className="text-xs text-muted-foreground leading-relaxed space-y-2 list-disc pl-5">
            <li>
              No key, no auth, CORS <code className="font-mono">*</code>. Responses are cached 20
              seconds — polling faster than that just hits cache.
            </li>
            <li>
              A <code className="font-mono">503</code> with{" "}
              <code className="font-mono">{`{"ok": false}`}</code> means the upstream node was
              unreachable. Retry with backoff; don't treat it as a price of zero.
            </li>
            <li>
              Pool depth is finite. Treat spot as a market print, not an oracle — for anything that
              settles money, use the TWAP.
            </li>
            <li>
              Reading the chain yourself is always an option: wISK is{" "}
              <a
                href={`https://etherscan.io/token/${CONTRACT}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                {CONTRACT}
              </a>
              , and DexScreener mirrors the same pair at{" "}
              <code className="font-mono break-all">
                api.dexscreener.com/latest/dex/pairs/ethereum/{POOL}
              </code>
              .
            </li>
            <li>
              Everything about the Iskander Coin blockchain and the Omni layer 2 lives at{" "}
              <a
                href="https://texitcoin.org/build"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                texitcoin.org/build
              </a>
              .
            </li>
          </ul>
        </section>

        <div className="mt-16 border-t border-border pt-8 flex justify-between items-center text-[10px] font-mono uppercase tracking-widest">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            ← Home
          </Link>
          <Link to="/faq" className="text-accent hover:underline">
            FAQ →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
