# Plan: TXC ⇄ wTXC Bridge + On-Ramp

## What this project becomes

One unified swap UI with three flows:

1. **Wrap** — user sends TXC → receives wTXC on Ethereum. **Free** (we cover ETH gas).
2. **Unwrap** — user sends wTXC (ERC-20) on Ethereum → receives TXC. **1% fee** (retained by treasury).
3. **On-ramp** — user sends stables (USDT/USDC/DAI/etc.) or native ETH on any supported EVM chain → receives **either TXC or wTXC** (their choice). Same Bitmart-buy + local-hot-wallet-payout model already in production.

ISK$ is removed entirely. The existing "buy TXC with stables" flow is kept and extended to also allow wTXC as the destination.

## What's kept (already built, no changes needed)

- HD deposit-index allocation w/ recycling (`allocate_hd_index`)
- Unique per-order EVM deposit addresses (already works for 5 chains)
- Bitmart replenishment + reconciliation
- Local TXC hot-wallet signing/payout with unconfirmed-change chaining + mutex
- Admin dashboard (orders, search, reconcile, hot wallet balances, tokens, market)
- Recent-swap history in localStorage
- Embed builder + `/embed` route
- Stuck-order Telegram alerts
- Custom tokens registry

## What's removed

- All ISK$ code paths: `src/lib/isk-sign.server.ts`, ISK$ branches in `swap-tick.ts`, ISK columns in admin, ISK asset in destination pickers, `ISK$` from `custom_tokens`/asset enums.
- Docs/copy mentioning ISK.

## What's added

### 1. wTXC ERC-20 integration

- Contract: `0x9FC65df3997073B8551Ffd617154B5102fACbb88` on Ethereum mainnet.
- No mint/burn — pure custodial transfer from operator wallet.
- New helper `src/lib/wtxc.server.ts`:
  - `getWtxcBalance(address)` — reads `balanceOf` via existing Alchemy RPC.
  - `sendWtxc(to, amount)` — signs ERC-20 `transfer` from operator wallet, submits via Alchemy.
  - `scanWtxcDeposits(depositAddress, sinceBlock)` — extends the existing EVM scanner to also index wTXC token transfers to per-order addresses on Ethereum.

### 2. Bridge operator wallet (new dedicated seed)

- New secret `BRIDGE_MNEMONIC` (user-supplied via `add_secret`).
- Derivation paths off that one seed:
  - **TXC hot wallet** (BIP84 m/84'/0'/0'/0/0 legacy + segwit) — used for TXC payouts on wrap AND on-ramp→TXC.
  - **EVM operator wallet** (m/44'/60'/0'/0/0) — holds wTXC + ETH gas; used for wTXC payouts on unwrap AND on-ramp→wTXC.
  - **Per-order EVM deposit addresses** (m/44'/60'/0'/0/N) — reuses existing HD-index counter.
- No `BRIDGE_OPERATOR_PRIVATE_KEY` needed — derived from `BRIDGE_MNEMONIC` at runtime, server-side only.

### 3. Destination-asset picker

- `src/lib/destinations.ts` gets two options: `TXC` and `wTXC`.
- `wTXC` validates as `0x`+40 hex checksum address.
- `TXC` continues to accept legacy `T…` + `txc1q…` segwit.
- Order schema: `dest_asset` enum becomes `"TXC" | "wTXC"` (drop `"ISK$"`).

### 4. Order flow updates in `swap-tick.ts`

Three source→dest matrices, all landing in the same tick loop:

```text
Source            Dest    Fee     Payout path
─────────────────────────────────────────────────────
Stables/ETH  →   TXC     0%      Bitmart buy TXC/USDT → local TXC hot wallet payout   (existing)
Stables/ETH  →   wTXC    0%      Bitmart buy TXC/USDT → operator wTXC transfer         (new)
TXC          →   wTXC    0%      Detect TXC deposit → operator wTXC transfer            (new)
wTXC         →   TXC     1%      Detect wTXC deposit → local TXC hot wallet payout      (new)
```

- "Bitmart buy" for `stables → wTXC` is identical to existing TXC path; only the payout leg changes.
- For `TXC → wTXC` and `wTXC → TXC` there is no Bitmart leg — 1:1 quote (minus fee where applicable).

### 5. Quote logic

- `getQuote(sourceAsset, destAsset, amount)`:
  - Bridge legs (`TXC↔wTXC`): 1:1 minus fee. Wrap = free. Unwrap = 1%.
  - On-ramp legs: unchanged Bitmart price feed.
- Admin can override fee `bps` per direction in `app_settings` (new keys `wrap_fee_bps`, `unwrap_fee_bps`) with the existing settings UI.

### 6. UI

- `/` (index) — updated hero: "Swap TXC, wTXC, and stables". Three-way asset picker.
- Order detail page unchanged shape; explorer link routes to `mempool.texitcoin.org` for TXC or `etherscan.io/tx/…` for wTXC.
- Admin orders table: replace ISK column with wTXC; TXC column stays.
- Footer keeps honest.money / terms / privacy / manifesto.

### 7. Secrets

- Prompt user for: `BRIDGE_MNEMONIC` (12/24 words).
- Reuse existing Alchemy/Bitmart/Telegram/Supabase secrets.
- Nothing else needed — old `TXC_HD_MNEMONIC` / `TXC_HOT_WIF` / `ISK_*` become unused; I'll delete them at the end after confirming the bridge path is live.

## Technical details

- New table? No. `orders` already has `dest_asset`/`dest_address`/`source_asset` after our earlier rename migration. I'll just widen the enum and drop ISK.
- Migrations:
  1. Update `orders.dest_asset` and `orders.source_asset` check constraints (drop `ISK$`, add `wTXC`).
  2. Delete ISK rows/tokens from `custom_tokens`.
  3. Add `app_settings.wrap_fee_bps` (default 0), `app_settings.unwrap_fee_bps` (default 100).
- `wtxc.server.ts` uses `ethers` (already a dep) — `Wallet.fromPhrase(BRIDGE_MNEMONIC).derivePath(...)` to derive the operator EOA at request time.
- EVM scanner: add ERC-20 `Transfer` log filter for the wTXC contract on Ethereum only, matched to per-order deposit addresses. Same 3-conf rule as USDT/USDC.
- Native ETH continues to work as an on-ramp source (already built).

## Security

- Old operator key was compromised via server access. New key never leaves `BRIDGE_MNEMONIC` env var; derived on-demand in `.server.ts` files only, never logged, never returned from server functions.
- No admin action exposes the seed. Admin can see balances only.
- Existing `swap_tick_no_auth` header check stays.
- Add scan pass at the end.

## Rollout order

1. Prompt for `BRIDGE_MNEMONIC` (add_secret).
2. Migration: enum widening + ISK removal + fee settings.
3. `wtxc.server.ts` + extend EVM scanner.
4. Update `destinations.ts`, `chains.ts`, `swap-tick.ts` (add wrap/unwrap branches, drop ISK).
5. Update UI: index picker, admin table (wTXC column replaces ISK).
6. Update copy: home, FAQ, README.
7. Delete ISK files.
8. Verify with a test wrap + unwrap once you fund the operator wallet.

## What I need from you

- Paste the 12/24-word **BRIDGE_MNEMONIC** into the secure secret prompt I'll open right after you approve this plan.
- Fund the derived operator EOA with wTXC + a little ETH for gas, and the derived TXC hot wallet with TXC. I'll show you both addresses as soon as the seed is set.
