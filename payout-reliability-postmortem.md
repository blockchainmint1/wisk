# EVM Payout Reliability — Postmortem & Required Fixes

Written from the wISK Wrap incident (Sep 2026). Applies to **any** app in the
ecosystem that broadcasts Ethereum transactions from a single shared operator
wallet across multiple serverless workers: wTXC Wrap, wZCU Wrap, swap.HME,
TSD Swap, CAN Swap.

---

## 1. What happened

Customers reported missing payouts. Orders were marked `sent` / `completed`
in the database, with a transaction hash, but the transaction was never mined.

Three independent defects combined:

1. **No miner tip.** Outgoing transactions were signed with whatever the node
   suggested, which at times was effectively a zero priority fee. The
   transaction was accepted into the mempool, sat there, and was eventually
   dropped.
2. **Nonce collisions.** Mints, burns, sweeps and gas top-ups each picked their
   own nonce. Two parallel worker invocations could grab the same nonce, so one
   transaction silently replaced the other. A later burn literally evicted a
   customer payout that was still waiting to be mined.
3. **No post-send verification.** "Broadcast accepted" was treated as "done".
   Nothing ever went back and asked the chain whether the transaction actually
   landed. So a dropped transaction stayed marked complete forever.

A fourth issue amplified it: the stuck-order reconciler only scanned ~1 hour of
blocks, and recorded-but-unmatched nonces were treated as permanently consumed.
That created an unfillable nonce gap — every later payout attempt failed, hit
the retry cap, and spammed Telegram with no path to recovery.

**Impact on wISK:** 8 orders stranded, several duplicate-risk broadcasts, one
near-miss double payout (a stale duplicate had to be cancelled with a high-tip
zero-value transaction at the same nonce).

---

## 2. The fixes (all live in wISK Wrap)

### 2.1 Always pay a real miner tip
`feeOverrides()` in `src/lib/wisk.server.ts`:

- `maxPriorityFeePerGas = max(node suggested tip, GAS_MIN_PRIORITY_GWEI)`
  (floor defaults to 1 gwei)
- `maxFeePerGas = 2 × baseFee + tip` (headroom for base-fee spikes)

Never let ethers pick fees unattended for customer-facing sends.

### 2.2 One shared nonce ledger for the operator wallet
- A single `nextOperatorNonce()` helper used by **every** operation that spends
  from the operator wallet: mint, burn, sweep, gas funding, cancellations.
- It returns the node's **pending** nonce. Recorded DB nonces are diagnostic
  only — never treat a recorded nonce as permanently consumed, or you create a
  gap you can never fill.
- Serialize the actual broadcast with a **database-level advisory lock**
  (`try_acquire_wallet_lock('evm_operator', 90s, holder)`), not an in-process
  mutex. Serverless workers do not share memory.

### 2.3 Persist the hash at submit time
Broadcast with an `onSubmitted` callback that writes `dest_tx_hash` and
`dest_broadcast_nonce` to the order **before** waiting for a receipt. Worker
runtimes kill long requests; if you only save after the receipt, you lose the
hash and re-send blind.

### 2.4 Verify every completed payout against the chain
A `verifyCompletedPayouts` phase runs on each cron tick:

- Pick completed orders older than ~3 min with a `dest_tx_hash` and no
  `dest_verified_at`.
- `mined` → stamp `dest_verified_at`.
- `pending` → leave alone.
- `missing` (not in mempool, not in a block) → roll back to `confirmed`, clear
  the hash, alert. The normal payout path re-sends it.

This is the single highest-value change. Without it, a dropped transaction is
invisible forever.

### 2.5 Idempotent payout endpoint
The payout hook only acts on orders in `sending` with `dest_tx_hash IS NULL`.
Duplicate cron ticks cannot double-pay.

### 2.6 Alert hygiene + recovery
- Persist a `retry_cap_alerted` event row before alerting. In-memory cooldowns
  don't survive worker eviction, so the alert fires every tick otherwise.
- Cap retries, but make the capped state recoverable (requeue after backoff),
  not terminal.

### 2.7 Cancelling a stale broadcast
If a duplicate is sitting in the mempool and would pay the customer twice, send
a 0-value transaction to yourself **at the same nonce** with a much higher tip.
That replaces it. Do not just ignore it.

---

## 3. Per-app status (as audited Sep 2026)

| App | Shared nonce ledger | DB-level send lock | Min tip floor | Post-send verification | Verdict |
|---|---|---|---|---|---|
| **wISK Wrap** | yes | yes | yes | yes | fixed |
| **wTXC Wrap** | no | no | no | no | **vulnerable — port all of §2** |
| **wZCU Wrap** | no | no | no | no | **vulnerable — port all of §2** |
| **swap.HME** | no | no | no | no | **vulnerable — different payout code, needs its own pass** |
| **TSD Swap** | no (ethers default) | no | no | no (confirms *deposits* only) | **exposed, lower blast radius** |
| **CAN Swap** | no (shares TSD relayer code) | no | no | no | **exposed, lower blast radius** |

### Why TSD / CAN look different
They confirm **inbound deposits** to the required confirmation count before
minting, which is good and unrelated. On the **outbound** side they call
`token.transfer(...)` and let ethers pick both nonce and fees, then trust the
returned hash. They have avoided the wISK failure so far mainly because their
payouts run sequentially from one desk rather than from several parallel
workers racing for the same nonce — that's luck of the architecture, not a
safeguard. A fee spike or two concurrent sends would reproduce the same bug.

**It is not better. It is the same gap with a smaller exposure surface.**
Minimum recommended change for TSD and CAN: add the tip floor (§2.1) and the
post-send verification sweep (§2.4).

---

## 4. Port checklist

- [ ] Fee floor on every outbound send (`GAS_MIN_PRIORITY_GWEI`, default 1 gwei)
- [ ] Single `nextOperatorNonce()` used by mint / burn / sweep / gas / cancel
- [ ] DB advisory lock around the broadcast, keyed on the wallet
- [ ] Persist tx hash + nonce at submit time, not after the receipt
- [ ] `dest_verified_at` column + verification phase on the cron tick
- [ ] Payout endpoint idempotent on `status='sending' AND dest_tx_hash IS NULL`
- [ ] Retry-cap alert deduped via a persisted event row
- [ ] Capped orders recoverable, not terminal
- [ ] Reconciler block-scan window derived from order age, not a fixed 1 hour

Reference implementation: **wISK Wrap** —
`src/lib/wisk.server.ts`, `src/routes/api/public/hooks/payout-send.ts`,
`src/routes/api/public/hooks/swap-tick.ts`,
`src/routes/api/public/hooks/burn-unwrapped.ts`.
