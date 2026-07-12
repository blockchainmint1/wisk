import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import logoAsset from "@/assets/honest-money-logo.png.asset.json";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPublicFees } from "@/lib/public-settings.functions";

const fmtPct = (bps: number) => {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
};


export function SiteHeader({ ticker }: { ticker?: ReactNode }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoAsset.url} alt="honest.money" className="size-6" loading="lazy" width={24} height={24} />
            <span className="font-mono font-bold tracking-tight text-sm">WRAP</span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-success animate-pulse-dot" />
              MAINNET_ACTIVE
            </div>
            {ticker ? (
              <div className="flex gap-4 border-l border-border pl-6">{ticker}</div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/swap"
            className="px-4 py-2 border border-border font-mono text-xs hover:bg-foreground hover:text-background transition-colors uppercase tracking-widest"
          >
            Launch Swap
          </Link>
        </div>

      </div>
    </nav>
  );
}

export function SiteFooter() {
  const feesFn = useServerFn(getPublicFees);
  const { data } = useQuery({
    queryKey: ["publicFees"],
    queryFn: () => feesFn(),
    initialData: { wrap_fee_bps: 500, unwrap_fee_bps: 0 },
  });

  const wrapPct = fmtPct(data.wrap_fee_bps ?? 500);
  const unwrapPct = fmtPct(data.unwrap_fee_bps ?? 0);
  const unwrapLabel = data.unwrap_fee_bps === 0 ? "free" : unwrapPct;

  return (
    <footer className="border-t border-border py-12 mt-24">
      <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between gap-8 opacity-70">
        <div className="text-[10px] font-mono uppercase tracking-widest space-y-4">
          <p className="font-bold text-foreground">TXC ↔ wTXC Bridge</p>
          <p className="max-w-xs leading-relaxed">
            Wrap {wrapPct}. Unwrap {unwrapLabel}. No stablecoin on-ramp.
          </p>
          <a href="https://honest.money" className="text-muted-foreground hover:text-accent transition-colors">
            Part of the honest.money ecosystem
          </a>
        </div>
        <div className="flex gap-12 font-mono text-[10px] uppercase tracking-widest">
          <div className="space-y-2">
            <p className="font-bold text-foreground">Resources</p>
            <Link to="/faq" className="block hover:text-accent">FAQ</Link>
            <Link to="/embed-builder" className="block hover:text-accent">Embed Widget</Link>
            <a href="https://texitcoin.org" className="block hover:text-accent">texitcoin.org</a>
            <a href="https://texitcoin.org/build" className="block hover:text-accent">Developers</a>
            <a href="https://help.honest.money" className="block hover:text-accent">Help Center</a>
          </div>
          <div className="space-y-2">
            <p className="font-bold text-foreground">Status</p>
            <p className="text-success">Bridge Online</p>
            <p>Wrap {wrapPct} · Unwrap {unwrapPct}</p>
          </div>

          <div className="space-y-2">
            <p className="font-bold text-foreground">Project</p>
            <Link to="/change-log" className="block hover:text-accent">Change Log</Link>
            <Link to="/privacy" className="block hover:text-accent">Privacy Policy</Link>
            <Link to="/terms" className="block hover:text-accent">Terms of Use</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
