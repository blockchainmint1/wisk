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
export const TXC_NETWORK: bitcoin.networks.Network = {
  messagePrefix: "\x19Texitcoin Signed Message:\n",
  bech32: "", // legacy P2PKH only — no bech32 on TXC
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x42, // base58 'T' prefix
  scriptHash: 0x32,
  wif: 0xc1,
};

const ESPLORA = "https://mempool.texitcoin.org/api";

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
  return esplora<EsploraUtxo[]>(`/address/${address}/utxo`);
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

/**
 * Build, sign and broadcast a TXC payment using the WIF in TXC_WIF.
 * Fee is deducted from the change output (recipient receives exactly `amountTxc`).
 * Coin selection: accumulate confirmed UTXOs (largest first) until target met.
 */
export async function sendTxc(opts: {
  toAddress: string;
  amountTxc: number; // whole TXC, will be converted to sats
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

  // Get UTXOs (confirmed only) and sort largest first
  const utxos = (await getUtxos(fromAddress))
    .filter((u) => u.status.confirmed)
    .sort((a, b) => b.value - a.value);

  if (!utxos.length) {
    throw new Error(`No confirmed UTXOs at hot wallet ${fromAddress}`);
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
