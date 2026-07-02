import { createFileRoute } from "@tanstack/react-router";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { SwapForm } from "@/components/swap-form";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SWAP — The TXC ↔ wTXC bridge & on-ramp" },
      {
        name: "description",
        content:
          "Wrap TXC to wTXC (free), unwrap wTXC back to TXC (1%), or on-ramp from any major stablecoin or ETH on 5 EVM chains. Custodial bridge, live Bitmart pricing, settled direct to your wallet.",
      },
      { property: "og:title", content: "SWAP — The TXC ↔ wTXC bridge & on-ramp" },
      {
        property: "og:description",
        content:
          "Wrap free. Unwrap 1%. On-ramp from stables or ETH. The bridge for TEXITcoin.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://swap.texitcoin.org/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://swap.texitcoin.org/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "SWAP",
          url: "https://swap.texitcoin.org/",
          description:
            "TXC ↔ wTXC bridge with a stablecoin on-ramp across 5 EVM chains.",
        }),
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader ticker={<LiveTicker />} />
      <main className="max-w-7xl mx-auto px-4 py-16 md:py-28">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          <div className="space-y-8 animate-slide-up">
            <div className="inline-flex items-center gap-2 border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em]">
              <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
              TXC ↔ wTXC bridge
            </div>
            <h1 className="text-6xl md:text-7xl font-extrabold tracking-tighter leading-none mb-6 text-balance">
              THE <span className="text-accent underline decoration-4 underline-offset-8">BRIDGE</span> <br />
              FOR wTXC.
            </h1>
            <p className="text-lg text-muted-foreground max-w-[46ch] font-medium leading-relaxed text-balance">
              Move native TXC onto Ethereum as wTXC, or bring it home again. Or on-ramp from any major stablecoin — or ETH itself — on five EVM chains. Custodial, fast, and settled straight to your wallet.
            </p>
            <div className="flex gap-4">
              <a
                href="#how"
                className="px-8 py-4 border border-border font-mono text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
              >
                How it works
              </a>
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-border pt-8">
              <Stat label="Wrap fee" value="0%" sub="TXC → wTXC" />
              <Stat label="Unwrap fee" value="1%" sub="wTXC → TXC" />
              <Stat label="On-ramp" value="+5%" sub="STABLES / ETH" />
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
          <div className="grid md:grid-cols-3 gap-10">
            <Principle
              n="01"
              title="One custodian, no smart-contract magic."
              body="TXC you send is held 1:1 in the operator wallet. wTXC (0x9FC6…bb88) is issued against it. Low-tech, auditable, boring on purpose."
            />
            <Principle
              n="02"
              title="Wrap free. Unwrap 1%."
              body="Wrapping is free forever. Unwrapping charges 1% — that's the bridge's only ongoing cost, and it funds continued operation."
            />
            <Principle
              n="03"
              title="Stables in, TXC or wTXC out."
              body="Prefer to buy in with USDC, USDT, pyUSD, DAI or ETH? The on-ramp fills your order at live Bitmart TXC/USDT pricing plus a 5% protocol fee."
            />
          </div>
        </section>

        <section className="mt-24 border-t border-border pt-16">
          <h2 className="font-mono text-sm uppercase tracking-[0.3em] font-bold mb-8">
            Supported networks
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 font-mono text-xs">
            {[
              { name: "Ethereum", note: "USDC · USDT · pyUSD · DAI · ETH · wTXC" },
              { name: "Base", note: "USDC · USDbC · USDT · ETH" },
              { name: "Arbitrum", note: "USDC · USDC.e · USDT · DAI · ETH" },
              { name: "Polygon", note: "USDC · USDC.e · USDT · DAI" },
              { name: "BNB Chain", note: "USDT · USDC" },
            ].map((c) => (
              <div key={c.name} className="border border-border p-4">
                <div className="text-foreground font-bold uppercase tracking-widest text-[11px]">
                  {c.name}
                </div>
                <div className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
                  {c.note}
                </div>
              </div>
            ))}
          </div>
        </section>
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


function Principle({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] text-accent uppercase tracking-[0.3em]">{n}</div>
      <h3 className="font-bold text-lg tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
