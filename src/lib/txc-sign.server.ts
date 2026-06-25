// TEXITcoin (TXC) local signing + broadcast.
// We NEVER send the WIF to the TXC RPC node. UTXOs, fees and broadcasts go
// through the public Esplora-compatible endpoint at mempool.texitcoin.org.
// Chain params confirmed from texitcoin.org/build → Chain Params tab.
//
// Server-only.

import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "@bitcoinerlab/secp256k1";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// ===== Network params (TXC mainnet) =====
// bech32 hrp is "txc" — segwit addresses look like txc1q…
// Verified against live mempool.texitcoin.org v0_p2wpkh outputs.
export const TXC_NETWORK: bitcoin.networks.Network = {
  messagePrefix: "\x19Texitcoin Signed Message:\n",
  bech32: "txc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x42, // base58 'T' prefix
  scriptHash: 0x32,
  wif: 0xc1,
};

// New mempool.texitcoin.org deployment exposes Esplora-compatible reads only
// under /api/v1. The legacy /api path now serves the SPA HTML and would cause
// JSON.parse to fall through to a string, producing
// "allUtxos.slice(...).sort is not a function" downstream. Override via env
// when their broadcast endpoint lands.
const ESPLORA =
  process.env.TXC_MEMPOOL_URL?.trim() || "https://mempool.texitcoin.org/api/v1";

// ===== Hot-wallet keypair (lazy, server-only) =====
function getWif(): string {
  const wif = process.env.TXC_WIF?.trim();
  if (!wif) throw new Error("TXC_WIF is not configured");
  return wif;
}

function getKeyPair() {
  return ECPair.fromWIF(getWif(), TXC_NETWORK);
}

export function getTxcHotAddress(): string {
  const kp = getKeyPair();
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(kp.publicKey),
    network: TXC_NETWORK,
  });
  if (!address) throw new Error("Failed to derive TXC hot address");
  return address;
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

export async function getTxcAddressBalanceSats(address: string): Promise<{
  confirmed: number;
  unconfirmed: number;
}> {
  const a = await esplora<EsploraAddress>(`/address/${address}`);
  const confirmed =
    a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum;
  const unconfirmed =
    a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum;
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
    // halfHourFee is a good default; clamp to a safe range.
    const rate = Math.max(
      Math.min(fees.halfHourFee || fees.hourFee || 2, 200),
      1,
    );
    return rate;
  } catch {
    return 2; // sub-cent on TXC
  }
}

// ===== Send =====
export interface TxcSendResult {
  txid: string;
  fromAddress: string;
  toAddress: string;
  amountSats: number;
  feeSats: number;
  feeRate: number;
  vsize: number;
  inputsUsed: number;
}

// In-process serializer. Two concurrent sendTxc() calls would otherwise
// fetch the same UTXO list and try to spend the same input — the second
// broadcast then fails with "txn-mempool-conflict" / "missing inputs".
// Chaining sends through a single promise also ensures the second call's
// /address/.../utxo fetch already includes the first call's unconfirmed
// change output, so we never get "No confirmed UTXOs" after a recent send.
let sendChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = sendChain.then(fn, fn);
  // Don't let one failure poison the chain.
  sendChain = next.catch(() => undefined);
  return next;
}

/**
 * Build, sign and broadcast a TXC payment using the WIF in TXC_WIF.
 * Fee is deducted from the change output (recipient receives exactly `amountTxc`).
 * Coin selection: accumulate UTXOs (largest first) — includes unconfirmed
 * change from our own previous sends so back-to-back payouts can chain.
 */
export async function sendTxc(opts: {
  toAddress: string;
  amountTxc: number; // whole TXC, will be converted to sats
}): Promise<TxcSendResult> {
  return serialize(() => sendTxcInner(opts));
}

async function sendTxcInner(opts: {
  toAddress: string;
  amountTxc: number;
}): Promise<TxcSendResult> {
  const COIN = 100_000_000;
  const amountSats = Math.round(opts.amountTxc * COIN);
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    throw new Error(`Invalid TXC amount: ${opts.amountTxc}`);
  }

  // Validate destination address against our network
  try {
    bitcoin.address.toOutputScript(opts.toAddress, TXC_NETWORK);
  } catch {
    throw new Error(`Invalid TXC destination address: ${opts.toAddress}`);
  }

  const kp = getKeyPair();
  const fromPayment = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(kp.publicKey),
    network: TXC_NETWORK,
  });
  const fromAddress = fromPayment.address!;
  const fromScript = fromPayment.output!;

  // Include BOTH confirmed and unconfirmed UTXOs. Unconfirmed entries are
  // almost always our own change from a recent payout — safe to spend
  // (we're the only signer on this address) and required for back-to-back
  // sends. Largest first for fewer inputs.
  const allUtxos = await getUtxos(fromAddress);
  const utxos = allUtxos.slice().sort((a, b) => b.value - a.value);

  if (!utxos.length) {
    throw new Error(`No UTXOs at hot wallet ${fromAddress}`);
  }


  const feeRate = await getFeeRateSatsPerVb();

  // Rough vsize for P2PKH: 10 (overhead) + 148/input + 34/output
  const estimateVsize = (numIn: number, numOut: number) =>
    10 + numIn * 148 + numOut * 34;

  // Coin selection
  let selected: EsploraUtxo[] = [];
  let inputSum = 0;
  let fee = 0;
  let needsChange = true;

  for (const u of utxos) {
    selected.push(u);
    inputSum += u.value;
    // Try with change first, fall back to no-change if dust
    fee = estimateVsize(selected.length, 2) * feeRate;
    if (inputSum >= amountSats + fee) {
      const change = inputSum - amountSats - fee;
      if (change < 546) {
        // Dust — bundle into fee, no change output
        fee = estimateVsize(selected.length, 1) * feeRate;
        if (inputSum >= amountSats + fee) {
          needsChange = false;
          break;
        }
        // else keep selecting
      } else {
        needsChange = true;
        break;
      }
    }
  }

  if (inputSum < amountSats + fee) {
    throw new Error(
      `Insufficient TXC balance: have ${inputSum} sats, need ${amountSats + fee} (incl. fee ${fee})`,
    );
  }

  const change = needsChange ? inputSum - amountSats - fee : 0;

  // Build tx (legacy P2PKH inputs — need full prev tx hex)
  const psbt = new bitcoin.Psbt({ network: TXC_NETWORK });

  // Fetch all previous raw transactions in parallel
  const prevTxHexes = await Promise.all(
    selected.map((u) => getRawTxHex(u.txid)),
  );

  for (let i = 0; i < selected.length; i++) {
    const u = selected[i];
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      nonWitnessUtxo: Buffer.from(prevTxHexes[i], "hex"),
    });
  }

  psbt.addOutput({ address: opts.toAddress, value: BigInt(amountSats) });
  if (needsChange) {
    psbt.addOutput({ script: fromScript, value: BigInt(change) });
  }

  // Sign all inputs
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

  // Broadcast via Esplora
  const txid = await esplora<string>("/tx", {
    method: "POST",
    body: txHex,
    headers: { "content-type": "text/plain" },
  });

  return {
    txid: typeof txid === "string" ? txid.trim() : tx.getId(),
    fromAddress,
    toAddress: opts.toAddress,
    amountSats,
    feeSats: fee,
    feeRate,
    vsize,
    inputsUsed: selected.length,
  };
}
