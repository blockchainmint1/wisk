// SERVER-ONLY: single source of truth for wallet derivations from
// BRIDGE_MNEMONIC. Powers three wallets off one seed:
//   • EVM operator (m/44'/60'/0'/0/0)     — holds wISK + ETH gas, pays out wISK
//   • EVM per-order deposit  (m/44'/60'/0'/0/N)  — customer sends stables/ETH/wISK here
//   • ISK hot (m/84'/0'/0'/0/0 legacy P2PKH form) — pays out ISK + collects deposits
//
// The mnemonic never leaves this process. Only `.server.ts` files import this.

import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDNodeWallet, Mnemonic, Wallet } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory, type ECPairInterface } from "ecpair";
import * as ecc from "@bitcoinerlab/secp256k1";
import { keccak256 } from "viem";


bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

function getMnemonic(): string {
  const m = process.env.BRIDGE_MNEMONIC?.trim();
  if (!m) throw new Error("BRIDGE_MNEMONIC is not configured");
  return m;
}

// ---- EVM ----
let cachedEvmRoot: HDNodeWallet | null = null;
function getEvmRoot(): HDNodeWallet {
  if (cachedEvmRoot) return cachedEvmRoot;
  const mnemonic = Mnemonic.fromPhrase(getMnemonic());
  cachedEvmRoot = HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0");
  return cachedEvmRoot;
}

/**
 * Derive the EVM child wallet at receive index N. Index 0 = operator wallet
 * (holds wISK + ETH gas, pays out wISK + is the treasury/admin address).
 * N ≥ 1 = per-order customer deposit addresses.
 */
export function deriveEvmWallet(index: number): Wallet {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid EVM HD index: ${index}`);
  }
  const child = getEvmRoot().deriveChild(index);
  return new Wallet(child.privateKey);
}

export function deriveEvmAddress(index: number): `0x${string}` {
  return deriveEvmWallet(index).address as `0x${string}`;
}

export function getOperatorEvmAddress(): `0x${string}` {
  return deriveEvmAddress(0);
}

// ---- ISK (legacy P2PKH via BIP44 for compatibility with existing signer) ----
// We keep P2PKH so the signer in isk-sign.server.ts (nonWitnessUtxo path)
// stays unchanged; only the keypair source moves from ISK_WIF → mnemonic.
const ISK_NETWORK = {
  messagePrefix: "\x19Iskander Signed Message:\n",
  bech32: "isk",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x42,
  scriptHash: 0x32,
  wif: 0xc1,
} as const;

let cachedIskRoot: HDKey | null = null;
function getIskRoot(): HDKey {
  if (cachedIskRoot) return cachedIskRoot;
  const seed = mnemonicToSeedSync(getMnemonic());
  // BIP44 ISK: registered coin_type 696969 (matches the ISK Web Wallet
  // derivation so the same seed yields the same T… address everywhere).
  cachedIskRoot = HDKey.fromMasterSeed(seed).derive("m/44'/696969'/0'/0");
  return cachedIskRoot;
}

/**
 * Derive a ISK keypair at receive index N. Index 0 = hot wallet
 * (holds ISK, pays out). N ≥ 1 = per-order ISK deposit addresses.
 */
export function deriveIskKeypair(index: number): ECPairInterface {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid ISK HD index: ${index}`);
  }
  const child = getIskRoot().deriveChild(index);
  if (!child.privateKey) throw new Error("ISK HD derivation produced no priv");
  return ECPair.fromPrivateKey(Buffer.from(child.privateKey), {
    network: ISK_NETWORK as unknown as bitcoin.networks.Network,
  });
}

export function deriveIskAddress(index: number): string {
  const kp = deriveIskKeypair(index);
  const { address } = bitcoin.payments.p2pkh({
    pubkey: Buffer.from(kp.publicKey),
    network: ISK_NETWORK as unknown as bitcoin.networks.Network,
  });
  if (!address) throw new Error("Failed to derive ISK address");
  return address;
}

export function getIskHotAddressFromMnemonic(): string {
  return deriveIskAddress(0);
}

export function getIskHotKeypair(): ECPairInterface {
  return deriveIskKeypair(0);
}

// Helper: return an EVM address from a raw uncompressed pubkey (used
// occasionally for legacy xpub fallback). Not needed once BRIDGE_MNEMONIC is
// the only source, but kept for symmetry.
export function pubkeyToEvmAddress(uncompressed64: Uint8Array): `0x${string}` {
  if (uncompressed64.length !== 64) throw new Error("expected 64-byte pubkey");
  const hash = keccak256(uncompressed64);
  return ("0x" + hash.slice(-40)) as `0x${string}`;
}

