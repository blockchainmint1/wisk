// Server-side merge of static CHAINS + admin-managed `custom_tokens`.
// Cached briefly to keep the swap-tick + scan hot paths cheap.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CHAINS,
  NATIVE_TOKEN_ADDRESS,
  type ChainConfig,
  type ChainKey,
  type TokenConfig,
} from "./chains";

const CACHE_TTL_MS = 30_000;
let cache: { at: number; chains: Record<ChainKey, ChainConfig> } | null = null;

export function invalidateChainsCache() {
  cache = null;
}

async function loadMerged(): Promise<Record<ChainKey, ChainConfig>> {
  const { data, error } = await supabaseAdmin
    .from("custom_tokens")
    .select("chain,symbol,address,decimals,is_native,bitmart_symbol,enabled")
    .eq("enabled", true);
  if (error) {
    console.error("[chains.server] custom_tokens load failed:", error.message);
    return CHAINS;
  }

  // Deep-clone the static map so we don't mutate the export.
  const merged: Record<ChainKey, ChainConfig> = Object.fromEntries(
    Object.entries(CHAINS).map(([k, c]) => [k, { ...c, tokens: [...c.tokens] }]),
  ) as Record<ChainKey, ChainConfig>;

  for (const row of data ?? []) {
    const chainKey = row.chain as ChainKey;
    if (!merged[chainKey]) continue;
    const token: TokenConfig = {
      symbol: row.symbol,
      address: row.is_native
        ? NATIVE_TOKEN_ADDRESS
        : String(row.address).toLowerCase(),
      decimals: row.decimals,
      isNative: row.is_native || undefined,
      bitmartSymbol: row.bitmart_symbol ?? undefined,
    };
    // Last-write-wins if symbol overlaps a static entry (lets admins override).
    const existingIdx = merged[chainKey].tokens.findIndex(
      (t) => t.symbol === token.symbol,
    );
    if (existingIdx >= 0) merged[chainKey].tokens[existingIdx] = token;
    else merged[chainKey].tokens.push(token);
  }

  return merged;
}

export async function getMergedChains(): Promise<Record<ChainKey, ChainConfig>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.chains;
  const chains = await loadMerged();
  cache = { at: Date.now(), chains };
  return chains;
}

export async function getMergedChain(key: string): Promise<ChainConfig> {
  const chains = await getMergedChains();
  const c = chains[key as ChainKey];
  if (!c) throw new Error(`Unknown chain: ${key}`);
  return c;
}

export async function getMergedToken(
  chain: ChainKey,
  symbol: string,
): Promise<TokenConfig> {
  const c = await getMergedChain(chain);
  const t = c.tokens.find((t) => t.symbol === symbol);
  if (!t) throw new Error(`Token ${symbol} not on ${chain}`);
  return t;
}
