import { createFileRoute, Link } from "@tanstack/react-router";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TEXIT Runner — Swap stables for native TXC" },
      {
        name: "description",
        content:
          "Exit to sovereignty. Swap USDC, USDT, or DAI on Ethereum, Base, Arbitrum, Polygon, or BSC for native TEXITcoin. Live Bitmart pricing, 5% protocol fee.",
      },
      { property: "og:title", content: "TEXIT Runner — Swap stables for native TXC" },
      {
        property: "og:description",
        content: "Stablecoins in. Sovereign TXC out. Live Bitmart liquidity, 5% protocol fee.",
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
            <h1 className="text-6xl md:text-7xl font-extrabold tracking-tighter leading-none mb-6 text-balance">
              EXIT TO <br />
              <span className="text-accent underline decoration-4 underline-offset-8">
                SOVEREIGNTY
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-[42ch] font-medium leading-relaxed text-balance">
              The bridge to native TEXITcoin, Iskander Coin & Zero Chill Units. Send USDC, USDT, pyUSD or any stable from any major EVM chain
              and receive TXC, ISK or ZCU at live Bitmart spot pricing — settled directly to your wallet.
            </p>
            <div className="flex gap-4">
              <Link
                to="/swap"
                className="px-8 py-4 bg-accent text-accent-foreground font-mono font-bold uppercase tracking-widest text-sm hover:brightness-110 transition-all shadow-[0_0_30px_hsl(0_84%_50%/0.3)]"
              >
                Start Swap
              </Link>
              <a
                href="#how"
                className="px-8 py-4 border border-border font-mono text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors"
              >
                How it works
              </a>
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-border pt-8">
              <Stat label="Protocol Fee" value="5.00%" sub="FIXED" />
              <Stat label="Chains" value="5" sub="EVM MAINNETS" />
              <Stat label="Settlement" value="~5 min" sub="TYPICAL" />
            </div>
          </div>

          <div className="relative animate-slide-up [animation-delay:150ms]">
            <div className="absolute -inset-1 bg-accent/20 blur-3xl rounded-3xl -z-10" />
            <div className="bg-secondary border border-border p-1 rounded-2xl">
              <div className="bg-background border border-border rounded-xl p-8 space-y-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  Settlement Flow
                </div>
                <FlowRow num="01" title="Deposit Stable" detail="Send USDC/USDT/DAI to your unique deposit address" />
                <FlowRow num="02" title="Confirm On-Chain" detail="We wait for chain-specific confirmations" />
                <FlowRow num="03" title="Bitmart Spot Buy" detail="Market buy TXC at live price + 5%" />
                <FlowRow num="04" title="Native Withdrawal" detail="TXC sent directly to your destination" active />
              </div>
            </div>
          </div>
        </div>

        <section id="how" className="mt-32 border-t border-border pt-16">
          <h2 className="font-mono text-sm uppercase tracking-[0.3em] font-bold mb-12">
            Operating Principles
          </h2>
          <div className="grid md:grid-cols-3 gap-10">
            <Principle
              n="01"
              title="One direction. Done well."
              body="Stablecoins in, native TXC out. No bridges, no wrapped tokens, no liquidity pools to manage."
            />
            <Principle
              n="02"
              title="Live market pricing."
              body="Every quote is locked from the Bitmart TXC/USDT spot price the moment you confirm. No oracle drift."
            />
            <Principle
              n="03"
              title="Self-sovereign delivery."
              body="TXC settles to the native address you provide. Custody never leaves your control beyond the swap window."
            />
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

function FlowRow({
  num,
  title,
  detail,
  active,
}: {
  num: string;
  title: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-start gap-4">
      <div
        className={`font-mono text-[10px] uppercase tracking-widest pt-1 ${
          active ? "text-accent" : "text-muted-foreground"
        }`}
      >
        {num}
      </div>
      <div className="flex-1 border-l border-border pl-4">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-xs text-muted-foreground font-mono mt-1">{detail}</div>
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
