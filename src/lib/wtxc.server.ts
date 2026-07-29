// SERVER-ONLY: wTXC ERC-20 helpers on Ethereum mainnet.
// Uses the BRIDGE_MNEMONIC operator wallet (m/44'/60'/0'/0/0) for payouts,
// and Alchemy for reads/broadcasts (same key that powers the EVM scanner).

import { Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import { deriveEvmWallet } from "./bridge-wallet.server";

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
  // Never let a hung send (e.g. a receipt wait that outlives the RPC) block
  // every subsequent send in this isolate — cap how long the queue waits.
  sendChain = Promise.race([
    next.catch(() => undefined),
    new Promise((r) => setTimeout(r, 45_000)),
  ]);
  return next;
}

/** Await a receipt but never hang forever; resolves null on timeout. */
async function waitBounded<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}


/**
 * Sign + broadcast a wTXC ERC-20 transfer from the operator wallet (index 0).
 * Waits for 1 confirmation before returning.
 *
 * `onSubmitted` fires the moment `eth_sendRawTransaction` returns — before
 * we start waiting on the receipt — so callers can persist the tx hash
 * immediately and survive a Worker eviction during `tx.wait`.
 */
export async function sendWtxc(opts: {
  toAddress: string;
  amountWtxc: number;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
  timeoutMs?: number;
}): Promise<WtxcSendResult> {
  return serialize(() => sendWtxcInner({ ...opts, fromIndex: 0 }));
}

/**
 * Sign + broadcast a wTXC ERC-20 transfer from any HD-derived index.
 * The sender must hold enough ETH for gas.
 */
export async function sendWtxcFrom(opts: {
  fromIndex: number;
  toAddress: string;
  amountWtxc: number;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
  timeoutMs?: number;
  /** Return as soon as the tx is broadcast instead of waiting for a receipt. */
  waitForReceipt?: boolean;
}): Promise<WtxcSendResult> {
  return serialize(() => sendWtxcInner(opts));
}


/** Native ETH balance for an address (raw wei + formatted string). */
export async function getEthBalance(address: string): Promise<{ wei: bigint; eth: number }> {
  const provider = getProvider();
  const wei = await provider.getBalance(address);
  return { wei, eth: Number(formatUnits(wei, 18)) };
}

/**
 * Current transaction-count for an address. `pending` includes txs sitting
 * in the mempool; `latest` counts only mined. Comparing a recorded
 * pre-attempt pending nonce against a later reading tells us whether our
 * broadcast actually made it out.
 */
export async function getEvmNonce(
  address: string,
  block: "latest" | "pending" = "pending",
): Promise<number> {
  const provider = getProvider();
  return await provider.getTransactionCount(address, block);
}


/**
 * Send native ETH from any HD-derived index. Used to fund gas on a
 * derived address before sweeping wTXC out of it.
 */
export async function sendEthFrom(opts: {
  fromIndex: number;
  toAddress: string;
  amountEth: number;
}): Promise<{ txid: string; fromAddress: string; toAddress: string; amountEth: number }> {
  return serialize(async () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(opts.toAddress)) {
      throw new Error(`Invalid ETH destination address: ${opts.toAddress}`);
    }
    if (!Number.isFinite(opts.amountEth) || opts.amountEth <= 0) {
      throw new Error(`Invalid ETH amount: ${opts.amountEth}`);
    }
    const provider = getProvider();
    const wallet = deriveEvmWallet(opts.fromIndex).connect(provider);
    const value = parseUnits(opts.amountEth.toFixed(18), 18);
    const tx = await wallet.sendTransaction({ to: opts.toAddress, value });
    // Bounded: broadcast is what matters; a slow receipt must not hang the isolate.
    await waitBounded(tx.wait(1), 20_000);
    return {
      txid: tx.hash,
      fromAddress: wallet.address,
      toAddress: opts.toAddress,
      amountEth: opts.amountEth,
    };
  });
}

async function sendWtxcInner(opts: {
  fromIndex: number;
  toAddress: string;
  amountWtxc: number;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
  timeoutMs?: number;
  waitForReceipt?: boolean;
}): Promise<WtxcSendResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(opts.toAddress)) {
    throw new Error(`Invalid wTXC destination address: ${opts.toAddress}`);
  }
  if (!Number.isFinite(opts.amountWtxc) || opts.amountWtxc <= 0) {
    throw new Error(`Invalid wTXC amount: ${opts.amountWtxc}`);
  }
  const timeoutMs = opts.timeoutMs ?? 22_000;
  const provider = getProvider();
  const wallet = deriveEvmWallet(opts.fromIndex).connect(provider);
  const contract = new Contract(WTXC_CONTRACT, ERC20_ABI, wallet);
  const amountRaw = parseUnits(opts.amountWtxc.toFixed(WTXC_DECIMALS), WTXC_DECIMALS);

  // Hard timeout: without this, a stalled Alchemy pre-flight (estimateGas /
  // getFeeData / getTransactionCount) can silently run past the Cloudflare
  // Worker wall-clock limit and the isolate dies with no error thrown.
  const submitted: Promise<{ tx: Awaited<ReturnType<typeof contract.transfer>>; nonce: number }> =
    (async () => {
      const tx = await contract.transfer(opts.toAddress, amountRaw);
      return { tx, nonce: Number(tx.nonce) };
    })();
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`sendWtxc: broadcast timed out after ${timeoutMs}ms`)), timeoutMs),
  );
  const { tx, nonce } = await Promise.race([submitted, timer]);

  // Broadcast succeeded — persist the hash immediately via the callback so
  // that even if `tx.wait(1)` is killed by a worker eviction, the reconciler
  // can complete the order by looking up this hash next tick.
  if (opts.onSubmitted) {
    try {
      await opts.onSubmitted({ txHash: tx.hash, nonce });
    } catch (e) {
      console.error("[sendWtxc] onSubmitted callback failed", e);
    }
  }

  const receipt =
    opts.waitForReceipt === false ? null : await waitBounded(tx.wait(1), 20_000);
  return {
    txid: tx.hash,
    fromAddress: wallet.address,
    toAddress: opts.toAddress,
    amountWtxc: opts.amountWtxc,
    feeSats: Number(receipt?.gasUsed ?? 0n),
  };
}


