// SERVER-ONLY: TXC address scanning for per-order TXC deposits
// (the wrap direction: user sends TXC → we detect it → we pay wTXC).
// Uses the same Esplora endpoint as txc-sign.server.ts.

const ESPLORA =
  process.env.TXC_MEMPOOL_URL?.trim() ||
  "https://api.mempool.texitcoin.org/api/v1";

interface EsploraTx {
  txid: string;
  status: { confirmed: boolean; block_height?: number };
  vin: Array<{ prevout?: { scriptpubkey_address?: string; value: number } }>;
  vout: Array<{ scriptpubkey_address?: string; value: number }>;
}

async function esplora<T>(path: string): Promise<T> {
  const res = await fetch(`${ESPLORA}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Esplora ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function getTxcTipHeight(): Promise<number> {
  const h = await esplora<string>("/blocks/tip/height");
  return typeof h === "number" ? h : parseInt(String(h), 10);
}

export interface IncomingTxcTransfer {
  txid: string;
  fromAddress: string | null;
  amountSats: number;
  blockHeight: number | null;
  confirmations: number;
}

/**
 * Scan an address for incoming payments. Returns aggregated per-tx credits
 * (sum of vouts to this address). Filters out self-spends.
 */
export async function scanTxcIncoming(
  address: string,
  tipHeight?: number,
): Promise<IncomingTxcTransfer[]> {
  const [txs, tip] = await Promise.all([
    esplora<EsploraTx[]>(`/address/${address}/txs`),
    tipHeight ? Promise.resolve(tipHeight) : getTxcTipHeight(),
  ]);
  if (!Array.isArray(txs)) return [];

  const out: IncomingTxcTransfer[] = [];
  for (const tx of txs) {
    // Skip if this address is on the input side (that would be a spend, not receive)
    const isInput = tx.vin.some((v) => v.prevout?.scriptpubkey_address === address);
    if (isInput) continue;

    const amountSats = tx.vout
      .filter((v) => v.scriptpubkey_address === address)
      .reduce((sum, v) => sum + v.value, 0);
    if (amountSats <= 0) continue;

    const firstIn = tx.vin.find((v) => v.prevout?.scriptpubkey_address);
    const fromAddress = firstIn?.prevout?.scriptpubkey_address ?? null;
    const blockHeight = tx.status.confirmed ? tx.status.block_height ?? null : null;
    const confirmations = blockHeight ? Math.max(0, tip - blockHeight + 1) : 0;
    out.push({ txid: tx.txid, fromAddress, amountSats, blockHeight, confirmations });
  }
  return out;
}
