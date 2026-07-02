// SERVER-ONLY: wTXC ERC-20 helpers on Ethereum mainnet.
// Uses the BRIDGE_MNEMONIC operator wallet (m/44'/60'/0'/0/0) for payouts,
// and Alchemy for reads/broadcasts (same key that powers the EVM scanner).

import { Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import { deriveEvmWallet, getOperatorEvmAddress } from "./bridge-wallet.server";

export const WTXC_CONTRACT = "0x9FC65df3997073B8551Ffd617154B5102fACbb88";
export const WTXC_DECIMALS = 8;
export const WTXC_CHAIN_ID = 1; // Ethereum mainnet

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

let cachedProvider: JsonRpcProvider | null = null;
function getProvider(): JsonRpcProvider {
  if (cachedProvider) return cachedProvider;
  const key = (process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_API)?.trim();
  if (!key) throw new Error("ALCHEMY_API_KEY / ALCHEMY_API is not configured");
  cachedProvider = new JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${key}`,
    WTXC_CHAIN_ID,
  );
  return cachedProvider;
}

export async function getWtxcBalance(address: string): Promise<number> {
  const provider = getProvider();
  const c = new Contract(WTXC_CONTRACT, ERC20_ABI, provider);
  const raw: bigint = await c.balanceOf(address);
  return Number(formatUnits(raw, WTXC_DECIMALS));
}

export interface WtxcSendResult {
  txid: string;
  fromAddress: string;
  toAddress: string;
  amountWtxc: number;
  feeSats: number; // gas used * price, in wei→gwei approximated; kept as 0 for schema fit
}

// In-process nonce serializer so back-to-back payouts don't collide.
let sendChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = sendChain.then(fn, fn);
  sendChain = next.catch(() => undefined);
  return next;
}

/**
 * Sign + broadcast a wTXC ERC-20 transfer from the operator wallet.
 * Waits for 1 confirmation before returning so the caller can persist
 * the tx hash + status atomically.
 */
export async function sendWtxc(opts: {
  toAddress: string;
  amountWtxc: number;
}): Promise<WtxcSendResult> {
  return serialize(() => sendWtxcInner(opts));
}

async function sendWtxcInner(opts: {
  toAddress: string;
  amountWtxc: number;
}): Promise<WtxcSendResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(opts.toAddress)) {
    throw new Error(`Invalid wTXC destination address: ${opts.toAddress}`);
  }
  if (!Number.isFinite(opts.amountWtxc) || opts.amountWtxc <= 0) {
    throw new Error(`Invalid wTXC amount: ${opts.amountWtxc}`);
  }
  const provider = getProvider();
  const wallet = deriveEvmWallet(0).connect(provider);
  const contract = new Contract(WTXC_CONTRACT, ERC20_ABI, wallet);
  const amountRaw = parseUnits(opts.amountWtxc.toFixed(WTXC_DECIMALS), WTXC_DECIMALS);

  const tx = await contract.transfer(opts.toAddress, amountRaw);
  const receipt = await tx.wait(1);
  return {
    txid: tx.hash,
    fromAddress: getOperatorEvmAddress(),
    toAddress: opts.toAddress,
    amountWtxc: opts.amountWtxc,
    feeSats: Number(receipt?.gasUsed ?? 0n),
  };
}
