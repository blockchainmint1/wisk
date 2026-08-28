// SERVER-ONLY: on-chain ISK/wISK spot price derived from the Uniswap V3
// wISK/USDC 0.3% pool. This is the canonical price source now that no CEX
// lists ISK — it reads slot0 directly, so it can never be stale or spoofed
// by a third-party API.

import { Contract, JsonRpcProvider } from "ethers";
import { WISK_CONTRACT, WISK_DECIMALS } from "./wisk.server";

export const WISK_USDC_POOL = "0xF364A7EA901569B4eA3d0e5bFE2cCDDFB1063142";
export const USDC_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const USDC_DECIMALS = 6;
export const POOL_FEE_BPS = 3000; // 0.3%

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128)",
  "function increaseObservationCardinalityNext(uint16 observationCardinalityNext)",
];

let provider: JsonRpcProvider | null = null;
function getProvider(): JsonRpcProvider {
  if (provider) return provider;
  const key = (process.env.ALCHEMY_API_KEY || process.env.ALCHEMY_API)?.trim();
  if (!key) throw new Error("ALCHEMY_API_KEY / ALCHEMY_API is not configured");
  provider = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${key}`, 1);
  return provider;
}

export interface IskPrice {
  /** USD price of 1 ISK / 1 wISK. */
  usd: number;
  source: "uniswap-v3";
  pool: string;
  feeBps: number;
  /** Pool liquidity (raw L value) — a rough depth signal. */
  liquidity: string;
  timestamp: string;
}

let cache: { value: IskPrice; expires: number } | null = null;
const TTL_MS = 20_000;

export async function getIskPrice(): Promise<IskPrice> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.value;

  const pool = new Contract(WISK_USDC_POOL, POOL_ABI, getProvider());
  const [slot0, token0, liquidity] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.liquidity(),
  ]);

  const sqrtPriceX96: bigint = slot0[0];
  // (sqrtPriceX96 / 2^96)^2 = raw price of token1 in token0 units.
  const Q96 = 2 ** 96;
  const raw = (Number(sqrtPriceX96) / Q96) ** 2;

  const wiskIsToken0 =
    String(token0).toLowerCase() === WISK_CONTRACT.toLowerCase();

  // raw = human price of token0 expressed in token1, before decimal scaling.
  const usd = wiskIsToken0
    ? raw * 10 ** (WISK_DECIMALS - USDC_DECIMALS) // wISK priced in USDC
    : 1 / (raw * 10 ** (USDC_DECIMALS - WISK_DECIMALS)); // invert USDC/wISK

  const value: IskPrice = {
    usd: Number(usd.toFixed(8)),
    source: "uniswap-v3",
    pool: WISK_USDC_POOL,
    feeBps: POOL_FEE_BPS,
    liquidity: String(liquidity),
    timestamp: new Date().toISOString(),
  };

  cache = { value, expires: now + TTL_MS };
  return value;
}

/** Convert a Uniswap V3 tick into USD-per-wISK, honouring token ordering. */
function tickToUsd(tick: number, wiskIsToken0: boolean): number {
  // 1.0001^tick = raw price of token0 denominated in token1.
  const raw = Math.pow(1.0001, tick);
  return wiskIsToken0
    ? raw * 10 ** (WISK_DECIMALS - USDC_DECIMALS)
    : 1 / (raw * 10 ** (USDC_DECIMALS - WISK_DECIMALS));
}

export interface IskTwap extends IskPrice {
  /** Seconds actually covered by the average (may be shorter than requested). */
  windowSeconds: number;
  requestedSeconds: number;
  /** True when the pool's oracle history was too short for the full window. */
  truncated: boolean;
  spotUsd: number;
}

const twapCache = new Map<number, { value: IskTwap; expires: number }>();

/**
 * Time-weighted average price over the requested window, read from the pool's
 * built-in observation oracle. Manipulation-resistant: moving a TWAP requires
 * holding the price off-market for the whole window, not one block.
 */
export async function getIskTwap(seconds: number): Promise<IskTwap> {
  const want = Math.max(60, Math.min(86_400, Math.floor(seconds)));
  const now = Date.now();
  const hit = twapCache.get(want);
  if (hit && hit.expires > now) return hit.value;

  const pool = new Contract(WISK_USDC_POOL, POOL_ABI, getProvider());
  const [slot0, token0, liquidity] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.liquidity(),
  ]);
  const wiskIsToken0 = String(token0).toLowerCase() === WISK_CONTRACT.toLowerCase();
  const spotUsd = tickToUsd(Number(slot0[1]), wiskIsToken0);

  // Walk the window down until the oracle has enough history ("OLD" revert).
  let windowSeconds = want;
  let avgTick: number | null = null;
  for (const candidate of [want, 3600, 1800, 600, 300, 60]) {
    if (candidate > want) continue;
    try {
      const [tickCumulatives]: [bigint[]] = await pool.observe([candidate, 0]);
      const delta = tickCumulatives[1] - tickCumulatives[0];
      avgTick = Number(delta) / candidate;
      windowSeconds = candidate;
      break;
    } catch {
      // oracle history shorter than this window — try a shorter one
    }
  }

  const value: IskTwap = {
    usd: Number((avgTick === null ? spotUsd : tickToUsd(avgTick, wiskIsToken0)).toFixed(8)),
    source: "uniswap-v3",
    pool: WISK_USDC_POOL,
    feeBps: POOL_FEE_BPS,
    liquidity: String(liquidity),
    timestamp: new Date().toISOString(),
    windowSeconds: avgTick === null ? 0 : windowSeconds,
    requestedSeconds: want,
    truncated: avgTick === null || windowSeconds < want,
    spotUsd: Number(spotUsd.toFixed(8)),
  };

  twapCache.set(want, { value, expires: now + 20_000 });
  return value;
}

/** Current + next observation slots the pool oracle can store. */
export async function getOracleCardinality() {
  const pool = new Contract(WISK_USDC_POOL, POOL_ABI, getProvider());
  const slot0 = await pool.slot0();
  return { cardinality: Number(slot0[3]), cardinalityNext: Number(slot0[4]) };
}
