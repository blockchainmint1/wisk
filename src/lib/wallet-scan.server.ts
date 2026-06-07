// Scan all derived HD deposit addresses for native + stablecoin balances.
// Read-only — uses public RPCs via evm-scan.server.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CHAINS, type ChainKey } from "./chains";
import { deriveDepositAddress } from "./hd.server";

// Prefer Alchemy (we have an API key) — public RPCs rate-limit aggressively
// (HTTP 429) when scanning many addresses across many chains.
const ALCHEMY_HOSTS: Record<ChainKey, string> = {
  ethereum: "eth-mainnet.g.alchemy.com",
  base: "base-mainnet.g.alchemy.com",
  arbitrum: "arb-mainnet.g.alchemy.com",
  polygon: "polygon-mainnet.g.alchemy.com",
  bsc: "bnb-mainnet.g.alchemy.com",
};

const FALLBACK_RPCS: Record<ChainKey, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
};

function rpcUrl(chain: ChainKey): string {
  const envOverride = process.env[`EVM_RPC_${chain.toUpperCase()}`];
  if (envOverride) return envOverride;
  const key = process.env.ALCHEMY_API_KEY;
  if (key) return `https://${ALCHEMY_HOSTS[chain]}/v2/${key}`;
  return FALLBACK_RPCS[chain];
}

let rpcId = 0;
async function rpcCall<T>(chain: ChainKey, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(chain), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${chain} ${method} HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${chain} ${method}: ${json.error.message}`);
  return json.result as T;
}

// ERC20 balanceOf selector
function balanceOfData(addr: string): string {
  return "0x70a08231" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function hexToBig(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function fmtUnits(wei: bigint, decimals: number): number {
  if (wei === 0n) return 0;
  const divisor = 10n ** BigInt(decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  return Number(whole) + Number(frac) / Number(divisor);
}

export interface AddressBalance {
  index: number;
  address: string;
  chain: ChainKey;
  chainName: string;
  native: number; // ETH/BNB/MATIC etc
  nativeSymbol: string;
  tokens: Array<{ symbol: string; balance: number }>;
  totalUsd: number; // sum of stablecoins (treats them as $1)
  linkedOrderId: string | null;
}

export interface WalletScanResult {
  generatedAt: string;
  totalAddresses: number;
  scannedAddresses: number;
  chains: Array<{
    chain: ChainKey;
    chainName: string;
    blockNumber: number | null;
    latencyMs: number | null;
    error: string | null;
    nativeSymbol: string;
    totalNative: number;
    totalStableUsd: number;
  }>;
  addresses: AddressBalance[];
  errors: string[];
}

const NATIVE_SYMBOL: Record<ChainKey, string> = {
  ethereum: "ETH",
  base: "ETH",
  arbitrum: "ETH",
  polygon: "MATIC",
  bsc: "BNB",
};

async function scanChain(
  chain: ChainKey,
  addresses: Array<{ index: number; address: string }>,
): Promise<{
  blockNumber: number | null;
  latencyMs: number | null;
  error: string | null;
  rows: AddressBalance[];
}> {
  const cfg = CHAINS[chain];
  const start = Date.now();
  let blockNumber: number | null = null;
  try {
    const hex = await rpcCall<string>(chain, "eth_blockNumber", []);
    blockNumber = Number.parseInt(hex, 16);
  } catch (err) {
    return {
      blockNumber: null,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "RPC error",
      rows: [],
    };
  }

  const rows: AddressBalance[] = [];
  for (const { index, address } of addresses) {
    try {
      const [nativeHex, ...tokenHexes] = await Promise.all([
        rpcCall<string>(chain, "eth_getBalance", [address, "latest"]),
        ...cfg.tokens.map((t) =>
          rpcCall<string>(chain, "eth_call", [
            { to: t.address, data: balanceOfData(address) },
            "latest",
          ]),
        ),
      ]);

      const native = fmtUnits(hexToBig(nativeHex), 18);
      const tokens = cfg.tokens.map((t, i) => ({
        symbol: t.symbol,
        balance: fmtUnits(hexToBig(tokenHexes[i] ?? "0x0"), t.decimals),
      }));
      const totalUsd = tokens.reduce((sum, t) => sum + t.balance, 0);

      rows.push({
        index,
        address,
        chain,
        chainName: cfg.name,
        native,
        nativeSymbol: NATIVE_SYMBOL[chain],
        tokens,
        totalUsd,
        linkedOrderId: null,
      });
    } catch (err) {
      console.warn(`[wallet-scan] ${chain} ${address} failed`, err);
    }
  }

  return {
    blockNumber,
    latencyMs: Date.now() - start,
    error: null,
    rows,
  };
}

export async function scanHdWallet(opts: {
  chains?: ChainKey[];
  maxAddresses?: number;
}): Promise<WalletScanResult> {
  const chains = opts.chains ?? (["ethereum", "bsc"] as ChainKey[]);
  const maxAddresses = opts.maxAddresses ?? 100;

  // Get next index → all derived indexes are 0..nextIndex-1
  const { data: counterRow } = await supabaseAdmin
    .from("hd_address_counter")
    .select("next_index")
    .eq("id", 1)
    .maybeSingle();
  // Index 0 = admin/treasury. Customer deposits start at index 1, so the
  // total number of *ever-derived* addresses is max(nextIndex, 1) — index 0
  // is always implicitly derived as the treasury.
  const nextIndex = counterRow?.next_index ?? 1;
  const totalAddresses = Math.max(nextIndex, 1);

  // Cap how many we actually scan (newest first for relevance) but ALWAYS
  // include index 0 (admin treasury) regardless of the window.
  const startIdx = Math.max(0, nextIndex - maxAddresses);
  const indexesSet = new Set<number>([0]);
  for (let i = startIdx; i < nextIndex; i++) indexesSet.add(i);
  const indexes: Array<{ index: number; address: string }> = Array.from(indexesSet)
    .sort((a, b) => a - b)
    .map((i) => ({ index: i, address: deriveDepositAddress(i).toLowerCase() }));

  // Pull open-order linkage in one shot
  const { data: orderRows } = await supabaseAdmin
    .from("orders")
    .select("deposit_address,public_id,status")
    .in(
      "deposit_address",
      indexes.map((x) => x.address),
    );
  const orderByAddr = new Map<string, { public_id: string; status: string }>();
  for (const row of orderRows ?? []) {
    orderByAddr.set(row.deposit_address, { public_id: row.public_id, status: row.status });
  }

  // Scan each chain in parallel
  const scans = await Promise.all(chains.map((c) => scanChain(c, indexes)));

  const addresses: AddressBalance[] = [];
  const chainSummaries: WalletScanResult["chains"] = [];
  const errors: string[] = [];

  scans.forEach((scan, idx) => {
    const chain = chains[idx];
    const cfg = CHAINS[chain];
    if (scan.error) errors.push(`${cfg.name}: ${scan.error}`);
    const totalNative = scan.rows.reduce((s, r) => s + r.native, 0);
    const totalStableUsd = scan.rows.reduce((s, r) => s + r.totalUsd, 0);
    chainSummaries.push({
      chain,
      chainName: cfg.name,
      blockNumber: scan.blockNumber,
      latencyMs: scan.latencyMs,
      error: scan.error,
      nativeSymbol: NATIVE_SYMBOL[chain],
      totalNative,
      totalStableUsd,
    });
    for (const row of scan.rows) {
      const linked = orderByAddr.get(row.address);
      row.linkedOrderId = linked ? `${linked.public_id} (${linked.status})` : null;
      // Keep zero-balance rows ONLY for the admin treasury (index 0); skip
      // every other empty derived address to keep the payload small.
      if (row.index === 0 || row.native > 0 || row.totalUsd > 0) addresses.push(row);
    }
  });

  addresses.sort((a, b) => b.totalUsd - a.totalUsd);

  return {
    generatedAt: new Date().toISOString(),
    totalAddresses,
    scannedAddresses: indexes.length,
    chains: chainSummaries,
    addresses,
    errors,
  };
}
