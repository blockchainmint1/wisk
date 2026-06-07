// Client-only persistence of the user's recent swaps in localStorage.
// Lets users return to in-flight orders even after closing the tab.
// They can clear at any time.

const KEY = "swap_history_v1";
const MAX = 20;

export type SwapHistoryEntry = {
  publicId: string;
  destAsset: string;
  sourceAmountUsd: number;
  createdAt: string; // ISO
};

function safeRead(): SwapHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is SwapHistoryEntry =>
        e && typeof e.publicId === "string" && typeof e.destAsset === "string",
    );
  } catch {
    return [];
  }
}

function safeWrite(entries: SwapHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    window.dispatchEvent(new Event("swap-history-changed"));
  } catch {
    // Ignore quota errors etc.
  }
}

export function getSwapHistory(): SwapHistoryEntry[] {
  return safeRead();
}

export function recordSwap(entry: SwapHistoryEntry) {
  const existing = safeRead().filter((e) => e.publicId !== entry.publicId);
  const next = [entry, ...existing].slice(0, MAX);
  safeWrite(next);
}

export function removeSwap(publicId: string) {
  safeWrite(safeRead().filter((e) => e.publicId !== publicId));
}

export function clearSwapHistory() {
  safeWrite([]);
}
