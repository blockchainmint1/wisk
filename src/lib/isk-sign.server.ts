// Iskander (ISK$) local signing + broadcast.
// ISK is a TXC-family chain with TWO address formats:
//   - Legacy P2PKH  → base58, K-prefix (pubKeyHash 0x2d)
//   - Native SegWit P2WPKH → bech32, isk1q… (hrp "isk")
// The hot wallet WIF can correspond to EITHER address; we derive both and
// pick whichever has UTXOs. Recipient address can be either format — the
// network params let bitcoinjs-lib decode both.
//
// All chain calls hit the Esplora-compatible API at mempool.iskandercoin.com.
// We NEVER send the WIF to an RPC node. Mirrors txc-sign.server.ts.
//
// Server-only.

import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "@bitcoinerlab/secp256k1";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// ===== Network params (ISK mainnet) =====
export const ISK_NETWORK: bitcoin.networks.Network = {
  messagePrefix: "\x18Iskander Signed Message:\n",
  bech32: "isk",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x2d, // base58 'K' prefix
  scriptHash: 0x2c,
  wif: 0xad,
};

const ESPLORA = "https://mempool.iskandercoin.com/api";

// ===== Hot-wallet keypair (lazy, server-only) =====
function getWif(): string {
  const wif = process.env.ISK_WIF?.trim();
  if (!wif) throw new Error("ISK_WIF is not configured");
  return wif;
}

function getKeyPair() {
  return ECPair.fromWIF(getWif(), ISK_NETWORK);
}

function getLegacyPayment() {
  const kp = getKeyPair();
  return bitcoin.payments.p2pkh({
    pubkey: Buffer.from(kp.publicKey),
    network: ISK_NETWORK,
  });
}

function getSegwitPayment() {
  const kp = getKeyPair();
  return bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(kp.publicKey),
    network: ISK_NETWORK,
  });
}

export function getIskHotAddresses(): { legacy: string; segwit: string } {
  const legacy = getLegacyPayment().address;
  const segwit = getSegwitPayment().address;
  if (!legacy || !segwit) throw new Error("Failed to derive ISK hot addresses");
  return { legacy, segwit };
}

// ===== Esplora helpers =====
interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number; // sats
  status: { confirmed: boolean; block_height?: number };
}

interface EsploraAddrStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
}

interface EsploraAddress {
  address: string;
  chain_stats: EsploraAddrStats;
  mempool_stats: EsploraAddrStats;
}

async function esplora<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ESPLORA}${path}`, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Esplora ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function getIskAddressBalanceSats(address: string): Promise<{
  confirmed: number;
  unconfirmed: number;
}> {
  const a = await esplora<EsploraAddress>(`/address/${address}`);
  const confirmed = a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum;
  const unconfirmed = a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum;
  return { confirmed, unconfirmed };
}

async function getUtxos(address: string): Promise<EsploraUtxo[]> {
  // Esplora can transiently return non-JSON (HTML error page) which our
  // esplora() helper passes through as a string. Retry once, then validate.
  let last: unknown = null;
  for (let i = 0; i < 2; i++) {
    const r = await esplora<unknown>(`/address/${address}/utxo`);
    if (Array.isArray(r)) return r as EsploraUtxo[];
    last = r;
    await new Promise((res) => setTimeout(res, 400));
  }
  throw new Error(
    `Esplora /address/${address}/utxo did not return an array: ${
      typeof last === "string" ? last.slice(0, 200) : JSON.stringify(last).slice(0, 200)
    }`,
  );
}

async function getRawTxHex(txid: string): Promise<string> {
  return esplora<string>(`/tx/${txid}/hex`);
}

interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

async function getFeeRateSatsPerVb(): Promise<number> {
  try {
    const fees = await esplora<RecommendedFees>("/v1/fees/recommended");
    const rate = Math.max(Math.min(fees.halfHourFee || fees.hourFee || 2, 200), 1);
    return rate;
  } catch {
    return 2;
  }
}

// ===== Pick hot wallet =====
// Prefer SegWit if it has any UTXOs; fall back to legacy. Cache for the
// process lifetime since the WIF doesn't change. If both have funds, SegWit
// wins (cheaper to spend).
type HotKind = "p2wpkh" | "p2pkh";
interface ResolvedHot {
  kind: HotKind;
  address: string;
  output: Buffer;
}
let resolvedHot: ResolvedHot | null = null;

async function resolveHot(): Promise<ResolvedHot> {
  if (resolvedHot) return resolvedHot;
  const sw = getSegwitPayment();
  const lg = getLegacyPayment();
  const [swUtxos, lgUtxos] = await Promise.all([
    getUtxos(sw.address!).catch(() => []),
    getUtxos(lg.address!).catch(() => []),
  ]);
  const pick: ResolvedHot =
    swUtxos.length > 0 || lgUtxos.length === 0
      ? { kind: "p2wpkh", address: sw.address!, output: Buffer.from(sw.output!) }
      : { kind: "p2pkh", address: lg.address!, output: Buffer.from(lg.output!) };
  resolvedHot = pick;
  return pick;
}

// ===== Send =====
export interface IskSendResult {
  txid: string;
  fromAddress: string;
  fromKind: HotKind;
  toAddress: string;
  amountSats: number;
  feeSats: number;
  feeRate: number;
  vsize: number;
  inputsUsed: number;
}

// Same in-process serializer as TXC: prevents two concurrent sends from
// racing on the same UTXO list and producing mempool-conflict broadcasts.
// Also ensures the second call's UTXO fetch already sees the first call's
// unconfirmed change output.
let sendChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = sendChain.then(fn, fn);
  sendChain = next.catch(() => undefined);
  return next;
}

/**
 * Build, sign and broadcast an ISK payment using the WIF in ISK_WIF.
 * Fee is deducted from the change output (recipient receives exactly `amountIsk`).
 * Selects from BOTH confirmed and unconfirmed UTXOs (our own change), so
 * back-to-back payouts can chain without "No confirmed UTXOs" errors.
 */
export async function sendIsk(opts: {
  toAddress: string;
  amountIsk: number; // whole ISK, will be converted to sats
}): Promise<IskSendResult> {
  return serialize(() => sendIskInner(opts));
}

async function sendIskInner(opts: {
  toAddress: string;
  amountIsk: number;
}): Promise<IskSendResult> {
  const COIN = 100_000_000;
  const amountSats = Math.round(opts.amountIsk * COIN);
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    throw new Error(`Invalid ISK amount: ${opts.amountIsk}`);
  }

  // Validate destination against ISK network (accepts both K… and isk1q…)
  try {
    bitcoin.address.toOutputScript(opts.toAddress, ISK_NETWORK);
  } catch {
    throw new Error(`Invalid ISK destination address: ${opts.toAddress}`);
  }

  const hot = await resolveHot();
  const kp = getKeyPair();

  const allUtxos = await getUtxos(hot.address);
  const utxos = allUtxos.slice().sort((a, b) => b.value - a.value);
  if (!utxos.length) {
    throw new Error(`No UTXOs at ISK hot wallet ${hot.address}`);
  }

  const feeRate = await getFeeRateSatsPerVb();

  // Rough vsize estimate. Output: assume 34 (worst case for P2PKH recipient).
  const inputVbytes = hot.kind === "p2wpkh" ? 68 : 148;
  const estimateVsize = (numIn: number, numOut: number) =>
    11 + numIn * inputVbytes + numOut * 34;

  let selected: EsploraUtxo[] = [];
  let inputSum = 0;
  let fee = 0;
  let needsChange = true;

  for (const u of utxos) {
    selected.push(u);
    inputSum += u.value;
    fee = estimateVsize(selected.length, 2) * feeRate;
    if (inputSum >= amountSats + fee) {
      const change = inputSum - amountSats - fee;
      if (change < 546) {
        fee = estimateVsize(selected.length, 1) * feeRate;
        if (inputSum >= amountSats + fee) {
          needsChange = false;
          break;
        }
      } else {
        needsChange = true;
        break;
      }
    }
  }

  if (inputSum < amountSats + fee) {
    throw new Error(
      `Insufficient ISK balance: have ${inputSum} sats, need ${amountSats + fee} (incl. fee ${fee})`,
    );
  }

  const change = needsChange ? inputSum - amountSats - fee : 0;

  const psbt = new bitcoin.Psbt({ network: ISK_NETWORK });

  // For legacy inputs we need the full prev-tx hex. For SegWit we only need
  // witnessUtxo. Fetch prev hex only when needed.
  const prevTxHexes =
    hot.kind === "p2pkh"
      ? await Promise.all(selected.map((u) => getRawTxHex(u.txid)))
      : [];

  for (let i = 0; i < selected.length; i++) {
    const u = selected[i];
    if (hot.kind === "p2wpkh") {
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        witnessUtxo: { script: hot.output, value: BigInt(u.value) },
      });
    } else {
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        nonWitnessUtxo: Buffer.from(prevTxHexes[i], "hex"),
      });
    }
  }

  psbt.addOutput({ address: opts.toAddress, value: BigInt(amountSats) });
  if (needsChange) {
    psbt.addOutput({ script: hot.output, value: BigInt(change) });
  }

  const signer = {
    publicKey: Buffer.from(kp.publicKey),
    sign: (hash: Buffer) => Buffer.from(kp.sign(hash)),
  };
  for (let i = 0; i < selected.length; i++) {
    psbt.signInput(i, signer);
  }
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  const txHex = tx.toHex();
  const vsize = tx.virtualSize();

  const txid = await esplora<string>("/tx", {
    method: "POST",
    body: txHex,
    headers: { "content-type": "text/plain" },
  });

  return {
    txid: typeof txid === "string" ? txid.trim() : tx.getId(),
    fromAddress: hot.address,
    fromKind: hot.kind,
    toAddress: opts.toAddress,
    amountSats,
    feeSats: fee,
    feeRate,
    vsize,
    inputsUsed: selected.length,
  };
}
