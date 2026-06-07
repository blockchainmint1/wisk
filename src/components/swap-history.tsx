import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { clearSwapHistory, getSwapHistory, removeSwap, type SwapHistoryEntry } from "@/lib/swap-history";

function useSwapHistory(): SwapHistoryEntry[] {
  const [entries, setEntries] = useState<SwapHistoryEntry[]>([]);

  useEffect(() => {
    const sync = () => setEntries(getSwapHistory());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("swap_history")) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("swap-history-changed", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("swap-history-changed", sync);
    };
  }, []);

  return entries;
}

function fmtAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function SwapHistory() {
  const entries = useSwapHistory();
  if (entries.length === 0) return null;

  return (
    <div className="bg-secondary/40 border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
          Your recent swaps
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("Clear all swap history from this browser?")) clearSwapHistory();
          }}
          className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-accent"
        >
          Clear all
        </button>
      </div>
      <ul className="divide-y divide-border/50">
        {entries.map((e) => (
          <li key={e.publicId} className="flex items-center gap-3 py-2 text-xs font-mono">
            <Link
              to="/swap/$orderId"
              params={{ orderId: e.publicId }}
              className="flex-1 min-w-0 hover:text-accent transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground">{e.publicId}</span>
                <span className="text-muted-foreground shrink-0">{fmtAgo(e.createdAt)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                ${e.sourceAmountUsd.toFixed(2)} → {e.destAsset}
              </div>
            </Link>
            <button
              type="button"
              onClick={() => removeSwap(e.publicId)}
              aria-label={`Remove ${e.publicId}`}
              className="text-muted-foreground hover:text-accent text-sm leading-none px-1"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="text-[10px] font-mono text-muted-foreground">
        Stored only in this browser. Clear any time.
      </div>
    </div>
  );
}
