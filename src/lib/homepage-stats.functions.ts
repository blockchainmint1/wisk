import { createServerFn } from "@tanstack/react-start";

// --------------------------------------------------------------------------
// Public homepage stats: recent completed swaps + top wISK holders.
// Data is admin-only in Postgres, so we read via supabaseAdmin and only
// return the anonymized subset of fields we're willing to show publicly.
// --------------------------------------------------------------------------

export interface PublicSwapRow {
  publicId: string;
  kind: "wrap" | "unwrap";
  amount: number;
  asset: "ISK" | "wISK";
  destShort: string;
  completedAt: string; // ISO
}

export const getRecentSwaps = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSwapRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("public_id, source_chain, dest_asset, quoted_dest_out, dest_address, updated_at, status")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error || !data) return [];

    const shorten = (addr: string) => {
      if (!addr) return "";
      if (addr.startsWith("0x") && addr.length > 10) {
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
      }
      if (addr.length > 10) return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
      return addr;
    };

    return data.map((o) => {
      const kind: "wrap" | "unwrap" = o.source_chain === "isk" ? "wrap" : "unwrap";
      const asset = (o.dest_asset ?? (kind === "wrap" ? "wISK" : "ISK")) as "ISK" | "wISK";
      return {
        publicId: o.public_id,
        kind,
        amount: Number(o.quoted_dest_out ?? 0),
        asset,
        destShort: shorten(o.dest_address ?? ""),
        completedAt: o.updated_at,
      };
    });
  },
);

// --------------------------------------------------------------------------
// wISK top holders — derived by tallying every ERC-20 Transfer since block 0
// via Alchemy's alchemy_getAssetTransfers, cached in-process for 5 minutes.
// --------------------------------------------------------------------------

export interface PublicHolderRow {
  address: string;
  addressShort: string;
  balance: number;
  isBridge: boolean;
}

interface HolderCache {
  fetchedAt: number;
  rows: PublicHolderRow[];
  totalSupply: number;
  holderCount: number;
}

let holderCache: HolderCache | null = null;
const HOLDER_TTL_MS = 5 * 60 * 1000;

const WISK_CONTRACT = "0xFB38867D064Df981F159b886007F1273a346b0BB";
const WISK_DECIMALS = 8;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

async function alchemyRpc<T>(method: string, params: unknown[]): Promise<T> {
  const key = (process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_API)?.trim();
  if (!key) throw new Error("ALCHEMY_API_KEY / ALCHEMY_API is not set");
  const res = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`Alchemy ${method}: ${json.error.message}`);
  return json.result as T;
}

async function computeHolders(): Promise<HolderCache> {
  type Tr = { from: string; to: string; rawContract: { value: string } };
  const balances = new Map<string, bigint>();
  let pageKey: string | undefined;
  let pages = 0;
  const MAX_PAGES = 20; // 20 * 1000 = 20k transfers cap — safe upper bound

  do {
    const params: Record<string, unknown> = {
      fromBlock: "0x0",
      toBlock: "latest",
      contractAddresses: [WISK_CONTRACT.toLowerCase()],
      category: ["erc20"],
      excludeZeroValue: true,
      withMetadata: false,
      maxCount: "0x3e8",
      order: "asc",
    };
    if (pageKey) params.pageKey = pageKey;
    const result = await alchemyRpc<{ transfers?: Tr[]; pageKey?: string }>(
      "alchemy_getAssetTransfers",
      [params],
    );
    for (const t of result.transfers ?? []) {
      const amt = BigInt(t.rawContract.value);
      const from = t.from.toLowerCase();
      const to = t.to.toLowerCase();
      if (from !== ZERO_ADDR) balances.set(from, (balances.get(from) ?? 0n) - amt);
      if (to !== ZERO_ADDR) balances.set(to, (balances.get(to) ?? 0n) + amt);
    }
    pageKey = result.pageKey;
    pages += 1;
  } while (pageKey && pages < MAX_PAGES);

  const scale = 10n ** BigInt(WISK_DECIMALS);
  const toNum = (v: bigint) => Number(v) / Number(scale);

  const bridgeAddr = process.env.BRIDGE_EVM_ADDRESS?.toLowerCase();

  const rows: PublicHolderRow[] = [];
  let total = 0n;
  for (const [addr, bal] of balances) {
    if (bal <= 0n) continue;
    total += bal;
    rows.push({
      address: addr,
      addressShort: `${addr.slice(0, 6)}…${addr.slice(-4)}`,
      balance: toNum(bal),
      isBridge: bridgeAddr ? addr === bridgeAddr : false,
    });
  }
  rows.sort((a, b) => b.balance - a.balance);

  return {
    fetchedAt: Date.now(),
    rows: rows.slice(0, 15),
    totalSupply: toNum(total),
    holderCount: rows.length,
  };
}

export const getWiskHolders = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    rows: PublicHolderRow[];
    totalSupply: number;
    holderCount: number;
    fetchedAt: string;
  }> => {
    if (!holderCache || Date.now() - holderCache.fetchedAt > HOLDER_TTL_MS) {
      try {
        holderCache = await computeHolders();
      } catch {
        if (!holderCache) {
          return { rows: [], totalSupply: 0, holderCount: 0, fetchedAt: new Date().toISOString() };
        }
      }
    }
    return {
      rows: holderCache.rows,
      totalSupply: holderCache.totalSupply,
      holderCount: holderCache.holderCount,
      fetchedAt: new Date(holderCache.fetchedAt).toISOString(),
    };
  },
);

// --------------------------------------------------------------------------
// Proof of reserves: circulating wISK supply vs native ISK the bridge holds.
// Mint-on-wrap / burn-on-unwrap means these two numbers should always match;
// publishing them makes the 1:1 claim checkable by anyone, not just trusted.
// --------------------------------------------------------------------------

export interface ProofOfReserves {
  supply: number;
  reserve: number;
  /** reserve - supply. Negative = under-collateralised (should never happen). */
  delta: number;
  healthy: boolean;
  contract: string;
  fetchedAt: string;
}

let porCache: { at: number; value: ProofOfReserves } | null = null;
const POR_TTL_MS = 2 * 60 * 1000;

export const getProofOfReserves = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProofOfReserves | null> => {
    if (porCache && Date.now() - porCache.at < POR_TTL_MS) return porCache.value;
    try {
      const [{ getWiskTotalSupply, WISK_CONTRACT: contract }, hdMod, signMod] =
        await Promise.all([
          import("@/lib/wisk.server"),
          import("@/lib/isk-hd-balance.server"),
          import("@/lib/isk-sign.server"),
        ]);
      const [supply, totals] = await Promise.all([
        getWiskTotalSupply(),
        hdMod.getIskHdTotal(signMod.getIskHotAddress()),
      ]);
      const reserve = Number(totals.totalConfirmed ?? 0);
      const delta = reserve - supply;
      const value: ProofOfReserves = {
        supply,
        reserve,
        delta,
        // Tiny dust tolerance for in-flight payouts / rounding.
        healthy: delta >= -0.0001,
        contract,
        fetchedAt: new Date().toISOString(),
      };
      porCache = { at: Date.now(), value };
      return value;
    } catch {
      return porCache?.value ?? null;
    }
  },
);
