import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { SwapForm } from "@/components/swap-form";
import { getPublicFees } from "@/lib/public-settings.functions";
import {
  getRecentSwaps,
  getWiskHolders,
  type PublicSwapRow,
  type PublicHolderRow,
} from "@/lib/homepage-stats.functions";

const UNISWAP_URL =
  "https://app.uniswap.org/#/swap?outputCurrency=0xFB38867D064Df981F159b886007F1273a346b0BB&theme=dark";
const WISK_CONTRACT = "0xFB38867D064Df981F159b886007F1273a346b0BB";

const fmtAmount = (n: number) =>
  n >= 1
    ? n.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : n.toLocaleString(undefined, { maximumFractionDigits: 8 });

const fmtRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const fmtPct = (bps: number) => {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
};

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      return await getPublicFees();
    } catch {
      return { wrap_fee_bps: 500, unwrap_fee_bps: 0 };
    }
  },
  head: () => ({
    meta: [
      { title: "wISK Wrap — The ISK ↔ wISK Bridge" },
      {
        name: "description",
        content:
          "Wrap native Iskander Coin into wISK on Ethereum, or unwrap it back to ISK. One for one, minted on deposit and burned on unwrap, settled straight to your wallet.",
      },
      { property: "og:title", content: "wISK Wrap — The ISK ↔ wISK Bridge" },
      {
        property: "og:description",
        content:
          "Wrap native Iskander Coin into wISK on Ethereum and unwrap it back, one for one.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://wisk.iskandercoin.com/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://wisk.iskandercoin.com/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "SWAP",
          url: "https://wisk.iskandercoin.com/",
          description: "ISK ↔ wISK custodial bridge.",
        }),
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { wrap_fee_bps, unwrap_fee_bps } = Route.useLoaderData();
  const wrapPct = fmtPct(wrap_fee_bps);
  const unwrapPct = fmtPct(unwrap_fee_bps);
  const unwrapLabel = unwrap_fee_bps === 0 ? "free" : unwrapPct;
  const wrapLabel = wrap_fee_bps === 0 ? "free" : wrapPct;

  return (
    <div className="min-h-screen">
      <SiteHeader ticker={<LiveTicker />} />
      <main className="max-w-7xl mx-auto px-4 py-16 md:py-28">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          <div className="space-y-8 animate-slide-up">
            <div className="inline-flex items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em]">
              <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
              ISK ↔ wISK bridge
            </div>
            <h1 className="text-6xl md:text-7xl font-extrabold tracking-tighter leading-none mb-6 text-balance">
              THE <span className="text-accent underline decoration-4 underline-offset-8">BRIDGE</span> <br />
              FOR wISK.
            </h1>
            <p className="text-lg text-muted-foreground max-w-[46ch] font-medium leading-relaxed text-balance">
              Move native ISK onto Ethereum as wISK, or bring it home again. Custodial, fast, and settled straight to your wallet.
            </p>
            <div className="flex gap-4">
              <a
                href="#how"
                className="px-8 py-4 border border-border font-mono text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
              >
                How it works
              </a>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-8">
              <Stat label="Wrap fee" value={wrapPct} sub="ISK → wISK" />
              <Stat label="Unwrap fee" value={unwrapPct} sub="wISK → ISK" />
            </div>
          </div>

          <div className="animate-slide-up [animation-delay:150ms]">
            <SwapForm compact />
          </div>
        </div>

        <section id="how" className="mt-32 border-t border-border pt-16">
          <h2 className="font-mono text-sm uppercase tracking-[0.3em] font-bold mb-12">
            How the bridge works
          </h2>
          <div className="grid md:grid-cols-2 gap-10">
            <Principle
              n="01"
              title="Minted on deposit. Burned on unwrap."
              body={
                <>
                  There is no pre-mined float. ISK you send is held 1:1 in the operator wallet and{" "}
                  <a
                    href="https://iskandercoin.com/wisk"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline hover:text-accent transition-colors"
                  >
                    wISK (0xFB38…b0BB)
                  </a>{" "}
                  is minted against it — so total supply is always a live proof-of-reserves number.
                  Unwrap and it's burned. Boring on purpose.
                </>
              }
            />
            <Principle
              n="02"
              title={`Wrap ${wrapLabel}. Unwrap ${unwrapLabel}.`}
              body={`Wrapping charges ${wrapPct} and unwrapping charges ${unwrapPct}. That's the bridge's only ongoing cost, and it funds continued operation.`}
            />
          </div>
        </section>

        <RecentSwapsSection />
        <HoldersSection />
        <UniswapSection />
      </main>
      <SiteFooter />

    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
        {label}
      </div>
      <div className="font-mono text-xl">
        {value} <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}


function Principle({ n, title, body }: { n: string; title: string; body: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] text-accent uppercase tracking-[0.3em]">{n}</div>
      <h3 className="font-bold text-lg tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function SectionHeader({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
      <div>
        <div className="font-mono text-[10px] text-accent uppercase tracking-[0.3em] mb-2">{eyebrow}</div>
        <h2 className="font-bold text-2xl tracking-tight">{title}</h2>
      </div>
      {right ? <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{right}</div> : null}
    </div>
  );
}

function RecentSwapsSection() {
  const fetchFn = useServerFn(getRecentSwaps);
  const { data, isLoading } = useQuery({
    queryKey: ["homepage", "recent-swaps"],
    queryFn: () => fetchFn(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const rows: PublicSwapRow[] = data ?? [];

  return (
    <section className="mt-32 border-t border-border pt-16">
      <SectionHeader eyebrow="Live" title="Recent wraps & unwraps" right={rows.length ? `${rows.length} shown` : ""} />
      <div className="border border-border overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="bg-muted/40">
            <tr className="text-left text-muted-foreground uppercase tracking-widest text-[10px]">
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3 hidden sm:table-cell">Recipient</th>
              <th className="px-4 py-3 hidden md:table-cell">Order</th>
              <th className="px-4 py-3 text-right">When</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No swaps yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.publicId} className="border-t border-border">
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 border ${r.kind === "wrap" ? "border-accent text-accent" : "border-success text-success"}`}>
                      {r.kind.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">{fmtAmount(r.amount)} <span className="text-muted-foreground">{r.asset}</span></td>
                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{r.destShort}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{r.publicId}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{fmtRelative(r.completedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HoldersSection() {
  const fetchFn = useServerFn(getWiskHolders);
  const { data, isLoading } = useQuery({
    queryKey: ["homepage", "wisk-holders"],
    queryFn: () => fetchFn(),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const rows: PublicHolderRow[] = data?.rows ?? [];
  const supply = data?.totalSupply ?? 0;
  const holderCount = data?.holderCount ?? 0;

  return (
    <section className="mt-24 border-t border-border pt-16">
      <SectionHeader
        eyebrow="On-chain"
        title="wISK holders"
        right={supply ? `${fmtAmount(supply)} wISK · ${holderCount} holders` : ""}
      />
      <div className="border border-border overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="bg-muted/40">
            <tr className="text-left text-muted-foreground uppercase tracking-widest text-[10px]">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">Share</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No holders yet.</td></tr>
            ) : (
              rows.map((h, i) => {
                const share = supply > 0 ? (h.balance / supply) * 100 : 0;
                return (
                  <tr key={h.address} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-3">
                      <a
                        href={`https://etherscan.io/token/${WISK_CONTRACT}?a=${h.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent transition-colors"
                      >
                        {h.addressShort}
                      </a>
                      {h.isBridge ? (
                        <span className="ml-2 px-1.5 py-0.5 border border-border text-[9px] uppercase tracking-widest text-muted-foreground">
                          Bridge
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">{fmtAmount(h.balance)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">{share.toFixed(2)}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UniswapSection() {
  return (
    <section className="mt-24 border-t border-border pt-16">
      <SectionHeader eyebrow="DEX" title="Trade wISK on Uniswap" />
      <div className="grid md:grid-cols-[1.2fr_1fr] gap-8 border border-border p-6">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed max-w-[52ch]">
            Already holding ETH, USDC, or USDT on Ethereum? Swap straight into wISK on
            Uniswap. Verify the contract address before you accept the token — copycats
            reuse the ticker.
          </p>
          <div className="flex gap-3 flex-wrap">
            <a
              href={UNISWAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 border border-border font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
            >
              Open on Uniswap →
            </a>
            <a
              href="https://iskandercoin.com/wisk"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 border border-border font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
            >
              Full details
            </a>
          </div>
        </div>
        <div className="space-y-3 font-mono text-xs">
          <DetailRow label="Token" value="wISK — Wrapped Iskander Coin" />
          <DetailRow
            label="Contract"
            value={
              <a
                href={`https://etherscan.io/token/${WISK_CONTRACT}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent transition-colors break-all"
              >
                {WISK_CONTRACT}
              </a>
            }
          />
          <DetailRow label="Network" value="Ethereum mainnet" />
          <DetailRow label="Decimals" value="8" />
          <DetailRow label="Backing" value="1:1 native ISK in custody" />
        </div>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 border-b border-border pb-2 last:border-b-0">
      <div className="text-muted-foreground uppercase tracking-widest text-[10px]">{label}</div>
      <div>{value}</div>
    </div>
  );
}

