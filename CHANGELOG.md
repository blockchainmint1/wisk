# Changelog

All notable changes to this project. Newest entries on top. Dates are UTC.

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

- **Security: lock down `user_roles` writes.** Added explicit RLS policies so
  only admins can INSERT/UPDATE/DELETE rows in `user_roles` (prevents
  self-elevation to admin). SELECT remains admin-all + self-read.
  - Migration: `20260601161050_*.sql`

## How to use this log

Append a new dated section at the top each time we ship a user-visible or
behavioral change. Group entries under the date. For each entry include:
- A short bold title describing what changed.
- One or two lines of context (what & why).
- Files / migrations touched (optional but useful).

Skip purely internal refactors with no behavior change.
