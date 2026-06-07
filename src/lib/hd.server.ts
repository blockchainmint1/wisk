// SERVER-ONLY: derives EVM receive addresses from an xpub.
// Private keys never touch the server — only the extended public key is loaded.
// Index 0 is reserved for the admin/treasury address; customer deposit
// addresses are allocated starting at index 1 (see next_hd_index() in DB).

import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak256 } from "viem";

let cachedRoot: HDKey | null = null;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function getRoot(): HDKey {
  if (cachedRoot) return cachedRoot;
  const raw = process.env.EVM_XPUB;
  if (!raw) throw new Error("EVM_XPUB env var is not set");

  // Strip surrounding quotes and ALL whitespace (newlines included).
  const cleaned = raw.replace(/\s+/g, "").replace(/^["']|["']$/g, "");

  if (!cleaned.startsWith("xpub")) {
    throw new Error(
      `EVM_XPUB is not a valid extended public key (must start with "xpub", got "${cleaned.slice(0, 8)}…")`,
    );
  }
  if (!BASE58_RE.test(cleaned)) {
    throw new Error(
      "EVM_XPUB contains invalid characters (not base58). Re-copy the xpub — it must not contain 0, O, I, l, spaces, or quotes.",
    );
  }

  try {
    cachedRoot = HDKey.fromExtendedKey(cleaned);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`EVM_XPUB could not be decoded: ${msg}`);
  }
  return cachedRoot;
}

/**
 * Derive a receive address at the given index.
 * Assumes the xpub is at the account level (m/44'/60'/0'), as exported by
 * Ledger Live and most EVM wallets. We append the BIP44 receive chain (0)
 * plus the address index, so the derived address matches Ledger Live's
 * displayed addresses at m/44'/60'/0'/0/index.
 *
 * The same address works on every EVM chain (Ethereum, Base, Arbitrum,
 * Polygon, BNB, etc.).
 *
 * Index 0 is the admin / treasury address. Customer deposit allocations
 * start at index 1 and rotate upward via `next_hd_index()` in the database.
 */
export function deriveDepositAddress(index: number): `0x${string}` {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid HD index: ${index}`);
  }
  const root = getRoot();
  const child = root.derive(`m/0/${index}`);
  if (!child.publicKey) throw new Error("HD derivation produced no public key");

  // Decompress to 65-byte uncompressed pubkey (0x04 || X || Y)
  const uncompressed = secp256k1.ProjectivePoint.fromHex(child.publicKey).toRawBytes(false);
  // Drop the 0x04 prefix, keccak256 the 64-byte (X||Y), take last 20 bytes
  const hash = keccak256(uncompressed.slice(1));
  return ("0x" + hash.slice(-40)) as `0x${string}`;
}
