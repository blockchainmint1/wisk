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
  "function totalSupply() view returns (uint256)",
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
 * Gas policy. Alchemy's `getFeeData()` regularly returns a ZERO priority fee
 * on mainnet; ethers then signs a type-2 tx whose effective miner tip is 0.
 * Builders routinely skip those, so the tx loiters in the mempool until it is
 * evicted — exactly how TX-DC525676's mint vanished. Always pay a real tip.
 */
async function feeOverrides(): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const provider = getProvider();
  const [block, fd] = await Promise.all([provider.getBlock("latest"), provider.getFeeData()]);
  const base = block?.baseFeePerGas ?? 0n;
  const minTip = parseUnits(process.env.GAS_MIN_PRIORITY_GWEI?.trim() || "1", "gwei");
  const nodeTip = fd.maxPriorityFeePerGas ?? 0n;
  const maxPriorityFeePerGas = nodeTip > minTip ? nodeTip : minTip;
  // 2x base headroom so a few busy blocks can't strand the tx either.
  return { maxPriorityFeePerGas, maxFeePerGas: base * 2n + maxPriorityFeePerGas };
}

/**
 * Next safe nonce for the operator wallet, shared by EVERY operator broadcast
 * (wrap mints, unwrap burns, sweeps). The node's pending count alone is not
 * enough: it lags a just-broadcast tx and it forgets an evicted one, so two
 * different code paths can pick the same nonce and silently replace each
 * other. The caller must hold the database-wide `evm_operator` lock, then use
 * the node's pending nonce. Recorded nonces are diagnostic only: a broadcast
 * can be dropped, and treating its old nonce as permanently consumed creates
 * an unfillable gap that prevents every later transaction from mining.
 */
export async function nextOperatorNonce(): Promise<{
  use: number;
  node: number;
  db: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const operator = deriveEvmWallet(0).address;
  const [node, payoutRow, burnRow] = await Promise.all([
    getEvmNonce(operator, "pending"),
    supabaseAdmin
      .from("orders")
      .select("dest_broadcast_nonce")
      .not("dest_broadcast_nonce", "is", null)
      .order("dest_broadcast_nonce", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("orders")
      .select("burn_broadcast_nonce")
      .not("burn_broadcast_nonce", "is", null)
      .order("burn_broadcast_nonce", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const db =
    Math.max(
      payoutRow.data?.dest_broadcast_nonce ?? -1,
      burnRow.data?.burn_broadcast_nonce ?? -1,
    ) + 1;
  return { use: node, node, db };
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

/**
 * Circulating wISK supply. With mint-on-wrap / burn-on-unwrap this number is
 * the exact claim against the ISK reserve — nothing else backs it.
 */
export async function getWiskTotalSupply(): Promise<number> {
  const provider = getProvider();
  const c = new Contract(WISK_CONTRACT, ERC20_ABI, provider);
  const raw: bigint = await c.totalSupply();
  return Number(formatUnits(raw, WISK_DECIMALS));
}

export interface WiskBurnResult {
  txid: string;
  mined?: boolean;
  fromAddress: string;
  amountWisk: number;
  feeSats: number;
}

/**
 * Destroy wISK the operator holds after an unwrap, recording the native ISK
 * address the reserve was released to in the on-chain `Unwrapped` event.
 * Supply drops back to exactly the ISK we still custody.
 */
export async function burnWisk(opts: {
  amountWisk: number;
  iskAddress: string;
  nonce?: number;
  timeoutMs?: number;
  onSubmitted?: (info: { txHash: string; nonce: number }) => Promise<void> | void;
}): Promise<WiskBurnResult> {
  return serialize(async () => {
    if (!Number.isFinite(opts.amountWisk) || opts.amountWisk <= 0) {
      throw new Error(`Invalid wISK burn amount: ${opts.amountWisk}`);
    }
    const timeoutMs = opts.timeoutMs ?? 22_000;
    const provider = getProvider();
    const wallet = deriveEvmWallet(0).connect(provider);
    const contract = new Contract(WISK_CONTRACT, ERC20_ABI, wallet);
    const amountRaw = parseUnits(opts.amountWisk.toFixed(WISK_DECIMALS), WISK_DECIMALS);
    const overrides = {
      ...(await feeOverrides()),
      ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
    };

    const submitted = (async () => {
      const tx = await contract.burnUnwrapped(amountRaw, opts.iskAddress ?? "", overrides);
      return { tx, nonce: Number(tx.nonce) };
    })();
    const timer = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`burnWisk: broadcast timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    );
    const { tx, nonce } = await Promise.race([submitted, timer]);

    if (opts.onSubmitted) {
      try {
        await opts.onSubmitted({ txHash: tx.hash, nonce });
      } catch (e) {
        console.error("[burnWisk] onSubmitted callback failed", e);
      }
    }

    const receipt = await waitBounded<{ gasUsed?: bigint } | null>(tx.wait(1), 20_000);
    return {
      txid: tx.hash,
      mined: receipt !== null,
      fromAddress: wallet.address,
      amountWisk: opts.amountWisk,
      feeSats: Number(receipt?.gasUsed ?? 0n),
    };
  });
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
/**
 * Settlement state of a broadcast: "mined" (receipt exists), "pending" (node
 * still knows it, no receipt yet) or "missing" (dropped/replaced — the tx will
 * never land and the payout must be re-sent).
 */
export async function evmTxState(
  txHash: string,
): Promise<"mined" | "pending" | "missing"> {
  const provider = getProvider();
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) return "mined";
    const tx = await provider.getTransaction(txHash);
    return tx ? "pending" : "missing";
  } catch {
    return "pending";
  }
}

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
    const tx = await wallet.sendTransaction({
      to: opts.toAddress,
      value,
      ...(await feeOverrides()),
    });
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
  const overrides = {
    ...(await feeOverrides()),
    ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
  };
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


