import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import logoAsset from "@/assets/honest-money-logo.png.asset.json";

export function SiteHeader({ ticker }: { ticker?: ReactNode }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoAsset.url} alt="honest.money" className="size-6" loading="lazy" width={24} height={24} />
            <span className="font-mono font-bold tracking-tight text-sm">SWAP</span>
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
        <Link
          to="/swap"
          className="px-4 py-2 border border-border font-mono text-xs hover:bg-foreground hover:text-background transition-colors uppercase tracking-widest"
        >
          Launch Swap
        </Link>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-12 mt-24">
      <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between gap-8 opacity-70">
        <div className="text-[10px] font-mono uppercase tracking-widest space-y-4">
          <p className="font-bold text-foreground">Sovereign Protocol</p>
          <p className="max-w-xs leading-relaxed">
            Stablecoins in, native assets out. Liquidity sourced live from Bitmart.
          </p>
          <p className="text-muted-foreground">
            Part of the honest.money ecosystem
          </p>
        </div>
        <div className="flex gap-12 font-mono text-[10px] uppercase tracking-widest">
          <div className="space-y-2">
            <p className="font-bold text-foreground">Resources</p>
            <Link to="/faq" className="block hover:text-accent">FAQ</Link>
            <a href="https://texitcoin.org" className="block hover:text-accent">texitcoin.org</a>
            <a href="https://help.minetxc.com" className="block hover:text-accent">Help Center</a>
          </div>
          <div className="space-y-2">
            <p className="font-bold text-foreground">Status</p>
            <p className="text-success">Network Healthy</p>
            <p>Premium: 5.00%</p>
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
