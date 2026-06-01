
# TXC Swap Site — Build Plan

A swap on-ramp where users pay stablecoins (USDC/USDT/DAI) on supported EVM chains and receive native TXC delivered to their TEXITcoin address. We quote at Bitmart spot price + 5% premium, watch a unique HD-derived EVM deposit address per order, then place a market buy on Bitmart and trigger a withdrawal to the user's TXC address.

## Scope (v1)

- One direction only: stables → TXC (no sell-side).
- Native TXC payout only (wTXC handled by existing texitcoin.org/wtxc site).
- Quote freshness window (e.g. 10 min) — after expiry, user must re-quote.

## User flow

1. User lands on `/swap`, enters: send amount, source chain, stablecoin, destination TXC address.
2. App fetches live TXC/USDT price from Bitmart, applies 5% premium, displays TXC out + breakdown.
3. User confirms → backend creates an order, derives next unused EVM address from HD wallet, returns deposit address + QR + countdown.
4. Order status page polls backend: `awaiting_payment` → `payment_detected` → `confirmed` → `buying_on_bitmart` → `withdrawing` → `completed` (with TXC tx hash).
5. Deposit watcher (cron-triggered server route) scans recent orders' addresses across chains for incoming stablecoin transfers. On confirmation, locks the fill price, places Bitmart market buy, then schedules withdrawal.
6. Admin dashboard (`/_authenticated/admin`) shows all orders, balances, Bitmart account state, manual refund/retry controls.

## Architecture

```text
src/routes/
  index.tsx                       landing / how-it-works
  swap.tsx                        quote + order creation UI
  swap.$orderId.tsx               order status (polling)
  login.tsx                       admin email/password
  _authenticated.tsx              admin gate
  _authenticated.admin.tsx        admin dashboard
  api/public/cron.watch.ts        deposit watcher cron endpoint (signature-verified)
  api/public/cron.fulfill.ts      bitmart buy + withdrawal cron
src/lib/
  hd.ts                           EVM HD derivation (BIP44 m/44'/60'/0'/0/n) — port from EVM Wallet project
  chains.ts                       chain configs (Ethereum, Base, Arbitrum, Polygon, BSC) + stablecoin contracts
  evm-scan.ts                     RPC helpers: scan ERC-20 Transfer events to an address
  bitmart.server.ts               signed Bitmart REST client (ticker, market buy, withdraw, balance)
  quote.functions.ts              getQuote serverFn
  orders.functions.ts             createOrder, getOrder, listOrders serverFns
  admin.functions.ts              admin-only retry/refund/balance serverFns
```

## Database (Lovable Cloud)

- `orders` — id, created_at, status, source_chain, source_token, source_amount_wei, deposit_address, deposit_index, dest_txc_address, quoted_txc, quoted_rate, premium_pct, expires_at, paid_tx_hash, bitmart_order_id, withdrawal_id, txc_tx_hash, error.
- `hd_address_counter` — single-row sequence for the next unused derivation index.
- `deposits` — chain, tx_hash, token, from, to, amount_wei, block_number, confirmations, order_id.
- `admin_audit` — manual action log.
- `app_role` enum + `user_roles` table for admin gate (per security rules — never store role on profile).
- RLS: all tables locked down; user-facing reads go through serverFns using `supabaseAdmin`; admin reads gated by `has_role(auth.uid(), 'admin')`.

## Secrets needed

- `BITMART_API_KEY`, `BITMART_API_SECRET`, `BITMART_API_MEMO`
- `HD_WALLET_MNEMONIC` (treasury xpub for deriving deposit addresses — server-only)
- `EVM_RPC_ETHEREUM`, `EVM_RPC_BASE`, `EVM_RPC_ARBITRUM`, `EVM_RPC_POLYGON`, `EVM_RPC_BSC` (or default to public endpoints)
- `CRON_SECRET` (HMAC for `/api/public/cron.*`)
- `TXC_WITHDRAW_MIN`, `PREMIUM_BPS=500` (config, can be env or DB row)

## Pricing

`txcOut = (usdIn / bitmartTxcUsdtPrice) / 1.05` quoted at order time and locked into row until `expires_at`. Show fee breakdown: spot, 5% premium, Bitmart trading fee passthrough estimate, TXC network fee.

## Fulfillment loop (cron, ~30s)

1. **Watch**: for each `awaiting_payment` order, query its chain RPC for ERC-20 `Transfer(_, deposit_address, amount)` of the expected token. Require N confirmations per chain. Update to `confirmed`.
2. **Buy**: for each `confirmed` order, call Bitmart `submit-order` (market buy TXC/USDT) sized to the received USD value minus our premium retained. Save `bitmart_order_id`. Wait for fill → `bought`.
3. **Withdraw**: call Bitmart withdraw with `dest_txc_address`. Save `withdrawal_id`, poll until on-chain hash returns → `completed`.
4. Any step error → `failed_<step>` with detail; admin can retry.

The cron endpoint lives at `api/public/cron.tick.ts`, verified by `x-cron-signature` HMAC, callable by pg_cron at the stable `project--{id}.lovable.app` URL.

## Design

Use the existing `mTXC Hash Dash` / texico-revamped design language — dark, fintech, monospace numerics, TXC orange accent. Will generate 3 directions via design tool before building.

## Auth

Admin-only login (email/password) on `/login` → `_authenticated` layout gate → admin dashboard. Public swap flow has no user auth — orders are addressable by opaque `orderId` only.

## Technical details

- HD derivation: `@scure/bip32` + `@scure/bip39` + `ethers.computeAddress`, derive `m/44'/60'/0'/0/n`, ported verbatim from `EVM Wallet` project's `src/lib/wallet/hd.ts`.
- Mnemonic stays server-only (in `HD_WALLET_MNEMONIC`); private keys are never needed — we only receive funds at these addresses and sweep separately via admin tools later.
- Bitmart signing: HMAC-SHA256 of `timestamp#memo#queryString` per their v2 spec.
- RPC scanning: use `eth_getLogs` filtered to the stablecoin contract `Transfer` topic with `topic2 = padded(deposit_address)`; chunk by recent blocks since `order.created_at`.
- Worker-safe: no `child_process`, no native bindings; ethers v6, viem, or raw `fetch` to RPC.
- Server functions return plain DTOs; admin operations go through `supabaseAdmin`.

## Out of scope (v1, can follow up)

- Sell side (TXC → stables).
- wTXC delivery path.
- Sweeping deposited stablecoins to a cold treasury (manual via admin for now).
- KYC.
