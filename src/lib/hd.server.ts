// HD wallet derivation for EVM deposit addresses (server-only).
// Mnemonic stays in HD_WALLET_MNEMONIC env var; we only derive public addresses.
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { computeAddress } from "ethers";

const ETH_ACCOUNT_PATH = "m/44'/60'/0'";

function getMnemonic(): string {
  const m = process.env.HD_WALLET_MNEMONIC;
  if (!m) throw new Error("HD_WALLET_MNEMONIC is not configured");
  const cleaned = m.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(cleaned, wordlist)) {
    throw new Error("HD_WALLET_MNEMONIC is invalid");
  }
  return cleaned;
}

function accountNode(): HDKey {
  const seed = mnemonicToSeedSync(getMnemonic());
  return HDKey.fromMasterSeed(seed).derive(ETH_ACCOUNT_PATH);
}

function toHex(b: Uint8Array): string {
  return "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Derive nth receiving address at m/44'/60'/0'/0/n */
export function deriveDepositAddress(index: number): string {
  const node = accountNode().deriveChild(0).deriveChild(index);
  if (!node.publicKey) throw new Error("Failed to derive public key");
  return computeAddress(toHex(node.publicKey));
}
