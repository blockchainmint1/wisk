// Uniswap V3 pool bootstrap for wISK/USDC.
//
//   bun contracts/create-pool.mjs status          — balances + pool state
//   bun contracts/create-pool.mjs mint-lp         — mint 100,000 wISK to operator (backed by ISK reserve)
//   bun contracts/create-pool.mjs create          — create + initialize the pool at $0.10
//   bun contracts/create-pool.mjs add-liquidity   — approve + mint the full-range position
//
// Requires BRIDGE_MNEMONIC and ALCHEMY_API(_KEY) in the environment.

import {
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Mnemonic,
  formatEther,
  formatUnits,
  parseUnits,
} from "ethers";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // 6 decimals
const WISK = "0xFB38867D064Df981F159b886007F1273a346b0BB"; // 8 decimals
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const NPM = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

const FEE = 500; // 0.05%
const TICK_SPACING = 10;
const MIN_TICK = -887270; // -887272 rounded up to a multiple of 10
const MAX_TICK = 887270;

const USDC_AMOUNT = parseUnits("10000", 6);
const WISK_AMOUNT = parseUnits("100000", 8);
const LP_MINT_WISK = "100000";

// token0 < token1 by address: USDC (0xA0b8…) < wISK (0xFB38…)
const TOKEN0 = USDC;
const TOKEN1 = WISK;
// Pool price = token1/token0 in raw units.
// 1 wISK = 0.10 USDC  ->  1e6 USDC units buy 10e8 = 1e9 wISK units  ->  price = 1000
const PRICE_RAW = 1000n;

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function mintWrapped(address to, uint256 amount, string iskTxid)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  "function liquidity() view returns (uint128)",
];
const NPM_ABI = [
  "function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];

// integer sqrt for bigint
function isqrt(n) {
  if (n < 2n) return n;
  let x = n,
    y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// sqrtPriceX96 = sqrt(price) * 2^96, computed in integer space
function sqrtPriceX96(price) {
  return isqrt(price * (1n << 192n));
}

function env(name, ...alts) {
  for (const k of [name, ...alts]) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  throw new Error(`${name} is not configured`);
}

function wallet() {
  const provider = new JsonRpcProvider(
    `https://eth-mainnet.g.alchemy.com/v2/${env("ALCHEMY_API_KEY", "ALCHEMY_API")}`,
    1,
  );
  const root = HDNodeWallet.fromMnemonic(
    Mnemonic.fromPhrase(env("BRIDGE_MNEMONIC")),
    "m/44'/60'/0'/0",
  );
  return root.deriveChild(0).connect(provider);
}

async function status(signer) {
  const p = signer.provider;
  const usdc = new Contract(USDC, ERC20, p);
  const wisk = new Contract(WISK, ERC20, p);
  const factory = new Contract(FACTORY, FACTORY_ABI, p);
  const pool = await factory.getPool(TOKEN0, TOKEN1, FEE);
  console.log("operator      ", signer.address);
  console.log("ETH           ", formatEther(await p.getBalance(signer.address)));
  console.log("USDC          ", formatUnits(await usdc.balanceOf(signer.address), 6));
  console.log("wISK          ", formatUnits(await wisk.balanceOf(signer.address), 8));
  console.log("wISK supply   ", formatUnits(await wisk.totalSupply(), 8));
  console.log("pool          ", pool);
  if (pool !== "0x0000000000000000000000000000000000000000") {
    const c = new Contract(pool, POOL_ABI, p);
    const s = await c.slot0();
    console.log("pool tick     ", s.tick.toString());
    console.log("pool liquidity", (await c.liquidity()).toString());
  }
  console.log("target sqrtP  ", sqrtPriceX96(PRICE_RAW).toString());
}

async function mintLp(signer) {
  const memo = process.argv[3] || "LP-SEED";
  const wisk = new Contract(WISK, ERC20, signer);
  const tx = await wisk.mintWrapped(signer.address, parseUnits(LP_MINT_WISK, 8), memo);
  console.log("mint tx", tx.hash);
  await tx.wait();
  console.log("minted", LP_MINT_WISK, "wISK to", signer.address);
}

async function create(signer) {
  const npm = new Contract(NPM, NPM_ABI, signer);
  const sp = sqrtPriceX96(PRICE_RAW);
  const tx = await npm.createAndInitializePoolIfNecessary(TOKEN0, TOKEN1, FEE, sp);
  console.log("create tx", tx.hash);
  await tx.wait();
  const factory = new Contract(FACTORY, FACTORY_ABI, signer.provider);
  console.log("pool", await factory.getPool(TOKEN0, TOKEN1, FEE));
}

async function addLiquidity(signer) {
  const usdc = new Contract(USDC, ERC20, signer);
  const wisk = new Contract(WISK, ERC20, signer);

  for (const [c, amount, label] of [
    [usdc, USDC_AMOUNT, "USDC"],
    [wisk, WISK_AMOUNT, "wISK"],
  ]) {
    const allowance = await c.allowance(signer.address, NPM);
    if (allowance < amount) {
      const tx = await c.approve(NPM, amount);
      console.log(`approve ${label}`, tx.hash);
      await tx.wait();
    }
  }

  const npm = new Contract(NPM, NPM_ABI, signer);
  const params = {
    token0: TOKEN0,
    token1: TOKEN1,
    fee: FEE,
    tickLower: MIN_TICK,
    tickUpper: MAX_TICK,
    amount0Desired: USDC_AMOUNT,
    amount1Desired: WISK_AMOUNT,
    amount0Min: (USDC_AMOUNT * 97n) / 100n,
    amount1Min: (WISK_AMOUNT * 97n) / 100n,
    recipient: signer.address,
    deadline: Math.floor(Date.now() / 1000) + 1800,
  };
  const tx = await npm.mint(params);
  console.log("mint position tx", tx.hash);
  const rc = await tx.wait();
  console.log("mined in block", rc.blockNumber);
}

const cmd = process.argv[2] || "status";
const signer = wallet();
if (cmd === "status") await status(signer);
else if (cmd === "mint-lp") await mintLp(signer);
else if (cmd === "create") await create(signer);
else if (cmd === "add-liquidity") await addLiquidity(signer);
else throw new Error(`unknown command: ${cmd}`);
