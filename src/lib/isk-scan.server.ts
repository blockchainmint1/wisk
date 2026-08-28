// SERVER-ONLY: ISK address scanning for per-order ISK deposits
// (the wrap direction: user sends ISK → we detect it → we pay wISK).
// Uses the same Esplora endpoint as isk-sign.server.ts.

const ESPLORA =
  process.env.ISK_MEMPOOL_URL?.trim() ||
  "https://api.mempool.iskandercoin.com/api/v1";

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

export async function getIskTipHeight(): Promise<number> {
  const h = await esplora<string>("/blocks/tip/height");
  return typeof h === "number" ? h : parseInt(String(h), 10);
}

export interface IncomingIskTransfer {
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
export async function scanIskIncoming(
  address: string,
  tipHeight?: number,
): Promise<IncomingIskTransfer[]> {
  const [txs, tip] = await Promise.all([
    esplora<EsploraTx[]>(`/address/${address}/txs`),
    tipHeight ? Promise.resolve(tipHeight) : getIskTipHeight(),
  ]);
  if (!Array.isArray(txs)) return [];

  const out: IncomingIskTransfer[] = [];
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
