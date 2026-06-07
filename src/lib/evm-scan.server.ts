// Scan an EVM chain for ERC-20 Transfer events arriving at a deposit address.
import { CHAINS, type ChainKey } from "./chains";

// Fallback list per chain — tried in order, with the next one used on HTTP 429
// or 5xx. Free public endpoints throttle aggressively from Workers, so we
// rotate. Operators can override with `EVM_RPC_<CHAIN>` (comma-separated for
// multiple).
const DEFAULT_RPCS: Record<ChainKey, string[]> = {
  ethereum: [
    "https://eth.drpc.org",
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
    "https://ethereum.publicnode.com",
    "https://1rpc.io/eth",
    "https://eth.llamarpc.com",
  ],
  base: [
    "https://base.drpc.org",
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
    "https://base.llamarpc.com",
  ],
  arbitrum: [
    "https://arbitrum.drpc.org",
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arbitrum.llamarpc.com",
  ],
  polygon: [
    "https://polygon.drpc.org",
    "https://polygon-rpc.com",
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygon.llamarpc.com",
  ],
  bsc: [
    "https://bsc.drpc.org",
    "https://bsc-dataseed.binance.org",
    "https://bsc-rpc.publicnode.com",
  ],
};

function rpcUrls(chain: ChainKey): string[] {
  const envKey = `EVM_RPC_${chain.toUpperCase()}`;
  const env = process.env[envKey];
  if (env) {
    return env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_RPCS[chain];
}

let rpcId = 0;
async function rpc<T = unknown>(chain: ChainKey, method: string, params: unknown[]): Promise<T> {
  const urls = rpcUrls(chain);
  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`RPC ${chain} ${method} via ${url} HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`RPC ${chain} ${method} via ${url} HTTP ${res.status}`);
      const json = (await res.json()) as { result?: T; error?: { message: string } };
      if (json.error) {
        // Treat rate-limit-ish messages as retryable.
        const msg = json.error.message || "";
        if (/rate|limit|throttle|too many/i.test(msg)) {
          lastErr = new Error(`RPC ${chain} ${method} via ${url}: ${msg}`);
          continue;
        }
        throw new Error(`RPC ${chain} ${method} via ${url}: ${msg}`);
      }
      return json.result as T;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error(`RPC ${chain} ${method}: all endpoints failed`);
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function padAddress(addr: string): string {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export interface DetectedTransfer {
  chain: ChainKey;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  token: string; // contract address (lowercase)
  from: string;
  to: string;
  amountWei: bigint;
}

export async function getBlockNumber(chain: ChainKey): Promise<number> {
  const hex = await rpc<string>(chain, "eth_blockNumber", []);
  return Number.parseInt(hex, 16);
}

/** Find ERC-20 Transfers to `toAddress` since `fromBlock` for any of the given token contracts. */
export async function scanIncomingTransfers(opts: {
  chain: ChainKey;
  toAddress: string;
  tokenAddresses: string[];
  fromBlock: number;
  toBlock?: number;
}): Promise<DetectedTransfer[]> {
  const { chain, toAddress, tokenAddresses, fromBlock } = opts;
  const toBlock = opts.toBlock ?? (await getBlockNumber(chain));

  // Most public RPCs cap eth_getLogs to ~10k blocks; chunk just in case.
  const CHUNK = 8000;
  const out: DetectedTransfer[] = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK + 1) {
    const end = Math.min(start + CHUNK, toBlock);
    const logs = await rpc<
      Array<{
        address: string;
        topics: string[];
        data: string;
        transactionHash: string;
        logIndex: string;
        blockNumber: string;
      }>
    >(chain, "eth_getLogs", [
      {
        fromBlock: "0x" + start.toString(16),
        toBlock: "0x" + end.toString(16),
        address: tokenAddresses.map((a) => a.toLowerCase()),
        topics: [TRANSFER_TOPIC, null, padAddress(toAddress)],
      },
    ]);
    for (const log of logs) {
      out.push({
        chain,
        txHash: log.transactionHash,
        logIndex: Number.parseInt(log.logIndex, 16),
        blockNumber: Number.parseInt(log.blockNumber, 16),
        token: log.address.toLowerCase(),
        from: "0x" + log.topics[1].slice(26),
        to: "0x" + log.topics[2].slice(26),
        amountWei: BigInt(log.data || "0x0"),
      });
    }
  }
  return out;
}

export function weiToUsd(amountWei: bigint, decimals: number): number {
  // Use 6-decimal fixed math to avoid float drift.
  if (decimals <= 6) {
    const scale = 10n ** BigInt(decimals);
    return Number(amountWei) / Number(scale);
  }
  const reduced = amountWei / 10n ** BigInt(decimals - 6);
  return Number(reduced) / 1_000_000;
}

export function chainStartScanBlock(chain: ChainKey, currentBlock: number): number {
  // Rough "last hour" window per chain.
  const blocksPerHour: Record<ChainKey, number> = {
    ethereum: 300,
    base: 1800,
    arbitrum: 14400,
    polygon: 1800,
    bsc: 1200,
  };
  return Math.max(0, currentBlock - (blocksPerHour[chain] ?? 600));
}

export { CHAINS };
