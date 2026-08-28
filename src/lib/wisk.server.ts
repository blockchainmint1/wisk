// SERVER-ONLY: wISK ERC-20 helpers on Ethereum mainnet.
// Uses the BRIDGE_MNEMONIC operator wallet (m/44'/60'/0'/0/0) for payouts,
// and Alchemy for reads/broadcasts (same key that powers the EVM scanner).

import { Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
import { deriveEvmWallet } from "./bridge-wallet.server";

export const WISK_CONTRACT = "0xFB38867D064Df981F159b886007F1273a346b0BB";
export const WISK_DECIMALS = 8;
export const WISK_CHAIN_ID = 1; // Ethereum mainnet

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function mintWrapped(address to, uint256 amount, string iskTxid)",
  "function burnUnwrapped(uint256 amount, string iskAddress)",
];

let cachedProvider: JsonRpcProvider | null = null;
function getProvider(): JsonRpcProvider {
  if (cachedProvider) return cachedProvider;
  const key = (process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_API)?.trim();
  if (!key) throw new Error("ALCHEMY_API_KEY / ALCHEMY_API is not configured");
  cachedProvider = new JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${key}`,
    WISK_CHAIN_ID,
  );
  return cachedProvider;
}

export async function getWiskBalance(address: string): Promise<number> {
  const provider = getProvider();
  const c = new Contract(WISK_CONTRACT, ERC20_ABI, provider);
  const raw: bigint = await c.balanceOf(address);
  return Number(formatUnits(raw, WISK_DECIMALS));
}

export interface WiskSendResult {
  txid: string;
  /** True only when a receipt was observed (tx is mined). */
  mined?: boolean;
  fromAddress: string;
  toAddress: string;
  amountWisk: number;
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
 * Sign + broadcast a wISK ERC-20 transfer from the operator wallet (index 0).
 * Waits for 1 confirmation before returning.
 *
 * `onSubmitted` fires the moment `eth_sendRawTransaction` returns — before
 * we start waiting on the receipt — so callers can persist the tx hash
 * immediately and survive a Worker eviction during `tx.wait`.
 */
export async function sendWisk(opts: {
  toAddress: string;
  amountWisk: number;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
  timeoutMs?: number;
  /** Explicit nonce. Pass this when the caller tracks nonces itself (see payout-send). */
  nonce?: number;
}): Promise<WiskSendResult> {
  return serialize(() => sendWiskInner({ ...opts, fromIndex: 0 }));
}

/**
 * Sign + broadcast a wISK ERC-20 transfer from any HD-derived index.
 * The sender must hold enough ETH for gas.
 */
/**
 * Mint brand-new wISK straight to the customer (wrap payouts). The operator
 * wallet holds MINTER_ROLE; supply is created on demand — no inventory.
 * Same broadcast/nonce/onSubmitted semantics as sendWisk.
 */
export async function mintWisk(opts: {
  toAddress: string;
  amountWisk: number;
  /** ISK deposit txid, recorded on-chain in the mint event. */
  iskTxid?: string | null;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
  timeoutMs?: number;
  nonce?: number;
}): Promise<WiskSendResult> {
  return serialize(() => sendWiskInner({ ...opts, fromIndex: 0, mint: true }));
}

export async function sendWiskFrom(opts: {
  fromIndex: number;
  toAddress: string;
  amountWisk: number;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
  timeoutMs?: number;
  /** Return as soon as the tx is broadcast instead of waiting for a receipt. */
  waitForReceipt?: boolean;
}): Promise<WiskSendResult> {
  return serialize(() => sendWiskInner(opts));
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
/**
 * Does this tx hash exist in the node's view (mempool or mined)? A same-nonce
 * loser gets dropped and returns null here — the only reliable way to tell a
 * successful broadcast from a silently-replaced one.
 */
export async function evmTxExists(txHash: string): Promise<boolean> {
  const provider = getProvider();
  try {
    const tx = await provider.getTransaction(txHash);
    return tx !== null;
  } catch {
    return false;
  }
}

export async function getEvmNonce(
  address: string,
  block: "latest" | "pending" = "pending",
): Promise<number> {
  const provider = getProvider();
  return await provider.getTransactionCount(address, block);
}


/**
 * Send native ETH from any HD-derived index. Used to fund gas on a
 * derived address before sweeping wISK out of it.
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

async function sendWiskInner(opts: {
  fromIndex: number;
  toAddress: string;
  amountWisk: number;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
  timeoutMs?: number;
  waitForReceipt?: boolean;
  nonce?: number;
  mint?: boolean;
  iskTxid?: string | null;
}): Promise<WiskSendResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(opts.toAddress)) {
    throw new Error(`Invalid wISK destination address: ${opts.toAddress}`);
  }
  if (!Number.isFinite(opts.amountWisk) || opts.amountWisk <= 0) {
    throw new Error(`Invalid wISK amount: ${opts.amountWisk}`);
  }
  const timeoutMs = opts.timeoutMs ?? 22_000;
  const provider = getProvider();
  const wallet = deriveEvmWallet(opts.fromIndex).connect(provider);
  const contract = new Contract(WISK_CONTRACT, ERC20_ABI, wallet);
  const amountRaw = parseUnits(opts.amountWisk.toFixed(WISK_DECIMALS), WISK_DECIMALS);

  // Hard timeout: without this, a stalled Alchemy pre-flight (estimateGas /
  // getFeeData / getTransactionCount) can silently run past the Cloudflare
  // Worker wall-clock limit and the isolate dies with no error thrown.
  const overrides = opts.nonce !== undefined ? { nonce: opts.nonce } : {};
  const submitted: Promise<{ tx: { hash: string; nonce: bigint | number; wait: (confirms?: number) => Promise<{ gasUsed?: bigint } | null> }; nonce: number }> =
    (async () => {
      const tx = opts.mint
        ? await contract.mintWrapped(opts.toAddress, amountRaw, opts.iskTxid ?? "", overrides)
        : await contract.transfer(opts.toAddress, amountRaw, overrides);
      return { tx, nonce: Number(tx.nonce) };
    })();
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`sendWisk: broadcast timed out after ${timeoutMs}ms`)), timeoutMs),
  );
  const { tx, nonce } = await Promise.race([submitted, timer]);

  // Broadcast succeeded — persist the hash immediately via the callback so
  // that even if `tx.wait(1)` is killed by a worker eviction, the reconciler
  // can complete the order by looking up this hash next tick.
  if (opts.onSubmitted) {
    try {
      await opts.onSubmitted({ txHash: tx.hash, nonce });
    } catch (e) {
      console.error("[sendWisk] onSubmitted callback failed", e);
    }
  }

  const receipt: { gasUsed?: bigint } | null =
    opts.waitForReceipt === false
      ? null
      : await waitBounded<{ gasUsed?: bigint } | null>(tx.wait(1), 20_000);
  return {
    txid: tx.hash,
    fromAddress: wallet.address,
    toAddress: opts.toAddress,
    amountWisk: opts.amountWisk,
    mined: receipt !== null,
    feeSats: Number(receipt?.gasUsed ?? 0n),
  };
}


