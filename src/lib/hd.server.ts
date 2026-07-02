// SERVER-ONLY: derives EVM receive addresses.
//
// Preferred: BRIDGE_MNEMONIC (full seed) → derives per-order deposit
// addresses AND the operator wallet (index 0). This lets us later sweep
// wTXC that customers send to their per-order deposit addresses in the
// unwrap direction, since we hold the private key.
//
// Fallback: EVM_XPUB (extended pubkey, no signing) for backwards compat
// with the previous deployment style. Sweeping is not possible in this mode.

import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak256 } from "viem";
import { deriveEvmAddress } from "./bridge-wallet.server";

let cachedXpubRoot: HDKey | null = null;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function tryGetXpubRoot(): HDKey | null {
  if (cachedXpubRoot) return cachedXpubRoot;
  const raw = process.env.EVM_XPUB;
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (!cleaned.startsWith("xpub") || !BASE58_RE.test(cleaned)) return null;
  try {
    cachedXpubRoot = HDKey.fromExtendedKey(cleaned);
    return cachedXpubRoot;
  } catch {
    return null;
  }
}

/**
 * Derive a receive address at the given index. Index 0 = operator/treasury,
 * N ≥ 1 = per-order customer deposit addresses.
 */
export function deriveDepositAddress(index: number): `0x${string}` {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid HD index: ${index}`);
  }
  // Prefer the mnemonic-backed derivation whenever it's available.
  if (process.env.BRIDGE_MNEMONIC?.trim()) {
    return deriveEvmAddress(index);
  }
  const root = tryGetXpubRoot();
  if (!root) {
    throw new Error(
      "No EVM key material configured: set BRIDGE_MNEMONIC (preferred) or EVM_XPUB",
    );
  }
  const child = root.derive(`m/0/${index}`);
  if (!child.publicKey) throw new Error("HD derivation produced no public key");
  const point = secp256k1.Point.fromBytes(child.publicKey);
  const uncompressed = point.toBytes(false);
  const hash = keccak256(uncompressed.slice(1));
  return ("0x" + hash.slice(-40)) as `0x${string}`;
}
