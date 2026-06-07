# Changelog

All notable changes to this project. Newest entries on top. Dates are UTC.

## 2026-06-07

- **Operator console overhaul.** `/admin` now has tabs: Orders, Wallet,
  Settings, Admins, and Audit.
  - **Settings** (new `app_settings` table): live-editable spread (bps),
    order expiry window, min/max order size, kill switch with custom
    reason shown to users, and minimum order size that fires the
    Telegram "new order" alert. Replaces the hardcoded `PREMIUM_BPS`
    constant; quotes and order creation now read from the DB with a 5s
    server cache.
  - **Wallet**: scans every derived HD deposit address (across
    Ethereum, BNB Chain, Base, Arbitrum, Polygon) for native + USDT /
    USDC / DAI balances. Shows per-chain totals, RPC latency, current
    block, and a per-address table linking to the originating order.
    Auto-refreshes every 60s.
  - **Admins**: list current admin accounts, invite a new one by email
    (auto-creates the auth user if needed; magic-link sign-in), and
    revoke. Self-revoke is blocked.
  - **Audit**: viewer for the existing `admin_audit` table; every
    setting change, retry, admin invite/revoke, and Telegram test is
    logged.
  - **Telegram**: "Send test ping" button in Settings → verifies the
    bot can post to `TELEGRAM_CHAT_ID`.
  - Files: `src/routes/admin.tsx`, `src/lib/admin.functions.ts`,
    `src/lib/settings.server.ts` (new),
    `src/lib/wallet-scan.server.ts` (new),
    `src/lib/quote.functions.ts`, `src/lib/orders.functions.ts`,
    migration `app_settings`.

## 2026-06-07

- **Admin login switched to magic link.** Removed password sign-in from
  `/admin`. Admins now enter their email and receive a one-time magic link.
  Seeded `bobby@blockchainmint.com` as an admin — the role is granted
  automatically on first sign-in via an `auth.users` insert trigger.
  - Files: `src/routes/admin.tsx`, migration `grant_admin_to_seed_emails`.

## 2026-06-07

- **Telegram notifications for order lifecycle.** Sends messages to a single
  admin chat (`TELEGRAM_CHAT_ID`) on: order created, deposit detected, deposit
  confirmed, Bitmart buy filled, completed, failed, and expired. Uses the
  Lovable Telegram connector gateway — no raw bot token in the codebase.
  Notifications are best-effort; failures are logged but never break
  fulfillment.
  - Files: `src/lib/telegram.server.ts` (new),
    `src/lib/orders.functions.ts`,
    `src/routes/api/public/hooks/swap-tick.ts`

- **Swap fulfillment: buy on actual deposited amount.** The Bitmart market buy
  now uses the summed USD of all on-chain deposits for the order (supports
  multi-transaction payments), not the quoted/intended amount. `paid_amount_usd`
  is kept in sync as additional transfers arrive. The 5% premium still applies
  to the actual received amount.
  - File: `src/routes/api/public/hooks/swap-tick.ts`

- **Swap form: "Get a wallet" button.** Added a wallet icon button to the right
  of the TXC destination address field linking to
  https://wallet.texitcoin.org, with a tooltip.
  - File: `src/routes/swap.tsx`

- **CHANGELOG.md created.** Keeping a running log of user-visible and
  behavioral changes.
  - File: `CHANGELOG.md` (new)

## 2026-06-01

- **Security: lock down `user_roles` writes.** Added explicit RLS policies so
  only admins can INSERT/UPDATE/DELETE rows in `user_roles` (prevents
  self-elevation to admin). SELECT remains admin-all + self-read.
  - Migration: `20260601161050_*.sql`

- **Initial swap platform build.** End-to-end stablecoin → native TXC swap
  pipeline. Core components:
  - Database: `orders`, `deposits`, `user_roles`, `admin_audit`,
    `hd_address_counter` tables with RLS policies.
  - Bitmart integration: live TXC/USDT spot price, market buy, withdrawal
    polling, wallet balances.
  - EVM scanning: ERC-20 transfer detection on Ethereum, Base, Arbitrum,
    Polygon, BSC via Alchemy RPC.
  - HD deposit addresses: deterministic hot-wallet addresses per order.
  - Swap form (`/swap`): chain + token + amount selection, live quote with 5%
    premium, unique deposit address generation.
  - Order tracking (`/swap/$orderId`): real-time status, QR code, countdown,
    on-chain TX links.
  - Admin dashboard (`/admin`): auth-gated order table, Bitmart balance
    cards, retry action with audit logging.
  - Fulfillment cron (`/api/public/hooks/swap-tick`): pg_cron-driven tick
    that watches deposits, buys TXC, triggers withdrawals, and polls completion.
  - Live price ticker in header.
  - Files: `src/lib/bitmart.server.ts`, `src/lib/evm-scan.server.ts`,
    `src/lib/hd.server.ts`, `src/lib/orders.functions.ts`,
    `src/lib/quote.functions.ts`, `src/lib/admin.functions.ts`,
    `src/routes/swap.tsx`, `src/routes/swap.$orderId.tsx`,
    `src/routes/admin.tsx`, `src/routes/api/public/hooks/swap-tick.ts`,
    `src/components/live-ticker.tsx`, `src/components/site-shell.tsx`

## How to use this log

Append a new dated section at the top each time we ship a user-visible or
behavioral change. Group entries under the date. For each entry include:
- A short bold title describing what changed.
- One or two lines of context (what & why).
- Files / migrations touched (optional but useful).

Skip purely internal refactors with no behavior change.
