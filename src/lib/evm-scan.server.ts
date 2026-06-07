// Scan an EVM chain for ERC-20 Transfer events arriving at a deposit address.
// Uses Alchemy's alchemy_getAssetTransfers — same approach as the EVM XPUB
// project. Single reliable provider beats rotating public RPCs that throttle.
import { CHAINS, type ChainKey } from "./chains";

const ALCHEMY_HOSTS: Record<ChainKey, string> = {
  ethereum: "eth-mainnet.g.alchemy.com",
  base: "base-mainnet.g.alchemy.com",
  arbitrum: "arb-mainnet.g.alchemy.com",
  polygon: "polygon-mainnet.g.alchemy.com",
  bsc: "bnb-mainnet.g.alchemy.com",
};

function alchemyUrl(chain: ChainKey): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_API_KEY is not set");
  return `https://${ALCHEMY_HOSTS[chain]}/v2/${key}`;
}

let rpcId = 0;
async function rpc<T = unknown>(chain: ChainKey, method: string, params: unknown[]): Promise<T> {
  const url = alchemyUrl(chain);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alchemy ${chain} ${method} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`Alchemy ${chain} ${method}: ${json.error.message}`);
  return json.result as T;
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

type AlchemyTransfer = {
  hash: string;
  from: string;
  to: string;
  rawContract: { address: string; value: string; decimal: string };
  blockNum: string; // hex
  uniqueId?: string;
  category: string;
};

/**
 * Find incoming transfers to `toAddress` since `fromBlock`.
 * - If `tokenAddresses` is non-empty, scans ERC-20 transfers for those tokens.
 * - If `includeNative` is true, ALSO scans native coin transfers (ETH/etc.)
 *   via Alchemy's `external` category. Native transfers return with
 *   `token === "native"` and full 18-decimal `amountWei`.
 */
export async function scanIncomingTransfers(opts: {
  chain: ChainKey;
  toAddress: string;
  tokenAddresses: string[];
  fromBlock: number;
  toBlock?: number;
  includeNative?: boolean;
}): Promise<DetectedTransfer[]> {
  const { chain, toAddress, tokenAddresses, fromBlock, includeNative } = opts;

  const baseParams = {
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock: opts.toBlock !== undefined ? "0x" + opts.toBlock.toString(16) : "latest",
    toAddress,
    withMetadata: false,
    excludeZeroValue: true,
    maxCount: "0x3e8", // 1000
    order: "asc",
  } as const;

  const out: DetectedTransfer[] = [];

  if (tokenAddresses.length > 0) {
    const result = await rpc<{ transfers?: AlchemyTransfer[] }>(
      chain,
      "alchemy_getAssetTransfers",
      [{ ...baseParams, contractAddresses: tokenAddresses.map((a) => a.toLowerCase()), category: ["erc20"] }],
    );
    (result.transfers ?? []).forEach((t, i) =>
      out.push({
        chain,
        txHash: t.hash,
        logIndex: i,
        blockNumber: Number.parseInt(t.blockNum, 16),
        token: t.rawContract.address.toLowerCase(),
        from: t.from.toLowerCase(),
        to: t.to.toLowerCase(),
        amountWei: BigInt(t.rawContract.value),
      }),
    );
  }

  if (includeNative) {
    const result = await rpc<{ transfers?: AlchemyTransfer[] }>(
      chain,
      "alchemy_getAssetTransfers",
      [{ ...baseParams, category: ["external"] }],
    );
    (result.transfers ?? []).forEach((t, i) =>
      out.push({
        chain,
        txHash: t.hash,
        // Offset so native indices never collide with ERC-20 indices on the same tx.
        logIndex: 100000 + i,
        blockNumber: Number.parseInt(t.blockNum, 16),
        token: "native",
        from: t.from.toLowerCase(),
        to: t.to.toLowerCase(),
        amountWei: BigInt(t.rawContract.value),
      }),
    );
  }

  return out;
}

export function weiToUsd(amountWei: bigint, decimals: number): number {
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
