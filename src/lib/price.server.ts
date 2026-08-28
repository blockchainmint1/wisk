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

  // Adjust for decimals, then orient to USDC-per-wISK.
  const usd = wiskIsToken0
    ? raw * 10 ** (WISK_DECIMALS - USDC_DECIMALS)
    : (1 / raw) * 10 ** (USDC_DECIMALS - WISK_DECIMALS) * 10 ** 0;

  const value: IskPrice = {
    usd: Number(
      (wiskIsToken0 ? usd : (1 / raw) * 10 ** (WISK_DECIMALS - USDC_DECIMALS)).toFixed(8),
    ),
    source: "uniswap-v3",
    pool: WISK_USDC_POOL,
    feeBps: POOL_FEE_BPS,
    liquidity: String(liquidity),
    timestamp: new Date().toISOString(),
  };

  cache = { value, expires: now + TTL_MS };
  return value;
}
