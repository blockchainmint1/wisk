// Fulfillment cron tick — called by pg_cron every minute.
// Customer flow (ISK and wISK):
//   awaiting_payment → payment_detected → confirmed → sending → completed
//   Payout is signed + broadcast locally from our hot/operator wallet using
//   the quoted amount. Fully DeFi — no exchange is involved anywhere.
// Auth: route lives under /api/public/* which bypasses Lovable's site auth.

import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  chainStartScanBlock,
  getBlockNumber,
  scanIncomingTransfers,
  scanOutgoingTransfers,
  weiToUsd,
} from "@/lib/evm-scan.server";
import { isNativeToken, isWiskSource, type ChainKey } from "@/lib/chains";
import { getMergedChain, getMergedToken } from "@/lib/chains.server";
import { getDestination } from "@/lib/destinations";
import { notifyOrderEvent, logOrderEvent, sendAdminAlert } from "@/lib/telegram.server";
import { getSettings } from "@/lib/settings.server";
import { sendIsk } from "@/lib/isk-sign.server";
import { WISK_CONTRACT, WISK_DECIMALS, getEvmNonce } from "@/lib/wisk.server";
import { getOperatorEvmAddress } from "@/lib/bridge-wallet.server";
import { scanIskIncoming, getIskTipHeight } from "@/lib/isk-scan.server";


async function notifyById(
  event: Parameters<typeof notifyOrderEvent>[0],
  orderId: string,
) {
  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,source_chain,source_token,source_amount_usd,paid_amount_usd,dest_asset,dest_address,quoted_dest_out,paid_tx_hash,dest_tx_hash,dest_fee_sats,dest_from_address,error_message",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return;
  // Sum on-chain source amount from deposits so Telegram can display the
  // real received amount in the source token (wISK, ETH, USDC, …) rather
  // than a USD-derived approximation.
  const { data: deps } = await supabaseAdmin
    .from("deposits")
    .select("amount_source")
    .eq("order_id", orderId);
  const paidAmountSource = (deps ?? []).reduce(
    (sum, d) => sum + Number(d.amount_source ?? 0),
    0,
  );
  void notifyOrderEvent(event, {
    ...data,
    paid_amount_source: paidAmountSource > 0 ? paidAmountSource : null,
  });
}


interface OrderRow {
  id: string;
  public_id: string;
  status: string;
  source_chain: string;
  source_token: string;
  source_amount_usd: number;
  deposit_address: string;
  dest_address: string;
  dest_asset: string;
  premium_bps: number;
  quoted_dest_out: number;
  quoted_dest_per_usd: number;
  expires_at: string;
  paid_amount_usd: number | null;
  withdrawal_id: string | null;
  deposit_start_block: number | null;
}
/**
 * A deposit tx mined before the order's start block cannot possibly belong
 * to this order — deposit addresses are recycled no sooner than 1h after
 * their last order, and ISK blocks are ~3min, so any legit deposit lands at
 * or after `order.deposit_start_block`. Anything older is just an old
 * on-chain tx sitting at a recycled address; we silently ignore it.
 *
 * We DO log the block once per (order, tx) for audit — but never alert.
 * Repeated ticks on the same stale tx are dropped so the timeline stays clean.
 */
async function maybeLogStaleDeposit(
  orderId: string,
  _publicId: string,
  chain: string,
  txHash: string,
  txBlock: number,
  orderStartBlock: number,
) {
  const { data: existing } = await supabaseAdmin
    .from("order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("event", "stale_deposit_ignored")
    .contains("details", { tx_hash: txHash })
    .limit(1)
    .maybeSingle();
  if (existing) return;

  await logOrderEvent(orderId, "note", "stale_deposit_ignored", {
    chain,
    tx_hash: txHash,
    tx_block: txBlock,
    order_start_block: orderStartBlock,
  });
}




async function failOrder(orderId: string, message: string) {
  await supabaseAdmin
    .from("orders")
    .update({ status: "failed", error_message: message })
    .eq("id", orderId);
  await logOrderEvent(orderId, "error", "failed", { message });
  await notifyById("failed", orderId);
}

// Errors from the ISK payout path that provably happen BEFORE any raw tx is
// accepted by the network, so re-broadcasting cannot double-pay:
//  • txn-mempool-conflict / missingorspent — our tx was REJECTED because an
//    input was already spent by another of our txs; nothing of ours landed.
//  • insufficient balance / no UTXOs — coin selection never built a tx.
//  • hot-wallet lock timeout — we never got as far as signing.
//  • Esplora read failures during UTXO/fee/prevtx fetch.
const ISK_RETRYABLE = [
  "txn-mempool-conflict",
  "missingorspent",
  "insufficient isk balance",
  "no utxos at hot wallet",
  "did not return an array",
  "timed out waiting for isk hot-wallet lock",
  "wallet lock acquire failed",
  "bad-txns-inputs-missingorspent",
];
const MAX_ISK_SEND_ATTEMPTS = 12;

function isRetryableIskSendError(message: string) {
  const m = message.toLowerCase();
  return ISK_RETRYABLE.some((s) => m.includes(s));
}

/**
 * A ISK payout blew up before broadcast. Roll the order back to `confirmed`
 * so the next tick tries again, instead of parking it in terminal `failed`
 * (which no reconciler ever picks up — the reconciler only handles wISK).
 */
async function requeueIskPayout(
  orderId: string,
  attempts: number,
  message: string,
) {
  await supabaseAdmin
    .from("orders")
    .update({ status: "confirmed", error_message: message })
    .eq("id", orderId);
  await logOrderEvent(orderId, "note", "retry_scheduled", {
    reason: "isk_send_pre_broadcast_error",
    attempts_used: attempts,
    message,
  });
}


async function expireStale() {
  // Auto-accept any pending underpayment whose quote window has closed —
  // the customer chose not to top up in time, so pay out what they sent.
  const { data: autoAccepted } = await supabaseAdmin
    .from("orders")
    .update({ underpayment_ack: "accepted" })
    .eq("underpayment_ack", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  for (const row of autoAccepted ?? []) {
    await logOrderEvent(row.id, "note", "underpayment_auto_accepted", {
      reason: "quote_expired",
    });
  }

  const { data: expired } = await supabaseAdmin
    .from("orders")
    .update({ status: "expired" })
    .eq("status", "awaiting_payment")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  for (const row of expired ?? []) {
    await logOrderEvent(row.id, "state", "expired", {});
    await notifyById("expired", row.id);
  }
}

/**
 * Detect orders that are still mid-flight (not awaiting_payment, completed,
 * failed, or expired) past the expiry window + 5 min grace, and alert once.
 * These are payment_detected / confirmed / sending /
 * bought / withdrawing orders that should have finished and didn't.
 */
async function detectStuck() {
  const settings = await getSettings();
  const cutoffMs = (settings.expiry_minutes + 5) * 60_000;
  const cutoff = new Date(Date.now() - cutoffMs).toISOString();

  const { data: stuck } = await supabaseAdmin
    .from("orders")
    .select("id,status,created_at")
    .not("status", "in", "(awaiting_payment,completed,failed,expired)")
    .is("stuck_notified_at", null)
    .lt("created_at", cutoff)
    .limit(20)
    .returns<Array<{ id: string; status: string; created_at: string }>>();
  if (!stuck?.length) return { stuck: 0 };

  for (const o of stuck) {
    const ageMin = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60_000);
    await supabaseAdmin
      .from("orders")
      .update({ stuck_notified_at: new Date().toISOString() })
      .eq("id", o.id);
    await logOrderEvent(o.id, "error", "stuck", { status: o.status, age_minutes: ageMin });
    await notifyById("stuck", o.id);
  }
  return { stuck: stuck.length };
}

/**
 * Recover orders stranded in `sending` because the sender broadcast the
 * on-chain transfer but the DB write flipping the order to `completed` was
 * lost (worker eviction, RPC timeout mid-flight). We scan the operator
 * wallet's recent outbound wISK transfers and, if we find a unique match on
 * (dest_address, amount), record the tx hash and mark completed.
 *
 * SAFETY: this only reconciles state — it never re-broadcasts. If no match
 * is found the order stays in `sending` and the stuck watchdog alerts admins
 * for manual review. Amount tolerance is 1 wei-decimal (rounding safety on
 * `Number` → `parseUnits`).
 */
async function reconcileStuckSending() {
  // Look for wISK payouts that have been in `sending` for >3 min. Cap to 10 per tick.
  const cutoff = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data: stuck } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,dest_address,quoted_dest_out,dest_tx_hash,dest_broadcast_nonce,send_attempts,updated_at",
    )
    .eq("status", "sending")
    .eq("dest_asset", "wISK")
    .lt("updated_at", cutoff)
    .limit(10)
    .returns<
      Array<{
        id: string;
        public_id: string;
        dest_address: string;
        quoted_dest_out: number;
        dest_tx_hash: string | null;
        dest_broadcast_nonce: number | null;
        send_attempts: number | null;
        updated_at: string;
      }>
    >();
  if (!stuck?.length) return { reconciled: 0, retried: 0 };

  // Retries here are provably safe (no recorded tx hash + operator has zero
  // unmined txs), so a low cap only strands orders that need a human. Keep it
  // generous — each retry costs one extra Worker invocation, nothing on-chain.
  const MAX_ATTEMPTS = 12;
  let reconciled = 0;
  let retried = 0;
  try {
    const operator = getOperatorEvmAddress();
    const currentBlock = await getBlockNumber("ethereum");
    const fromBlock = chainStartScanBlock("ethereum", currentBlock);
    const transfers = await scanOutgoingTransfers({
      chain: "ethereum",
      fromAddress: operator,
      tokenAddresses: [WISK_CONTRACT],
      fromBlock,
      toBlock: currentBlock,
    });

    // Read the operator's pending + latest nonce ONCE. When they are equal,
    // nothing of ours is sitting unmined in the mempool — so a missing
    // outbound transfer in the scan above proves this order never went out.
    // (The old "pending nonce hasn't advanced past our recorded one" test is
    // unusable: the nonce is shared across every payout, so one successful
    // send permanently strands every other order attempted at that nonce.)
    let currentPendingNonce: number | null = null;
    let currentLatestNonce: number | null = null;
    try {
      currentPendingNonce = await getEvmNonce(operator, "pending");
      currentLatestNonce = await getEvmNonce(operator, "latest");
    } catch (e) {
      console.warn("[reconcile] could not read operator nonce", e);
    }


    for (const o of stuck) {
      const dest = o.dest_address.toLowerCase();
      const expectedRaw = BigInt(Math.round(Number(o.quoted_dest_out) * 10 ** WISK_DECIMALS));

      // 1) Prefer matching by the tx hash we recorded at broadcast_submitted.
      let match = o.dest_tx_hash
        ? transfers.find((t) => t.txHash.toLowerCase() === o.dest_tx_hash!.toLowerCase())
        : undefined;

      // 2) Otherwise match by (dest_address, amount) with ±1 unit tolerance.
      if (!match) {
        const candidates = transfers.filter(
          (t) =>
            t.to === dest &&
            (t.amountWei === expectedRaw ||
              t.amountWei === expectedRaw - 1n ||
              t.amountWei === expectedRaw + 1n),
        );
        if (candidates.length > 1) {
          await logOrderEvent(o.id, "error", "reconcile_ambiguous", {
            candidates: candidates.map((m) => m.txHash),
          });
          void sendAdminAlert(
            `Ambiguous reconcile for ${o.public_id}`,
            `Found ${candidates.length} outbound wISK txs from operator to ${dest} matching ${o.quoted_dest_out}. Resolve manually.`,
            `reconcile-ambiguous-${o.public_id}`,
          );
          continue;
        }
        match = candidates[0];
      }

      if (match) {
        await supabaseAdmin
          .from("orders")
          .update({
            status: "completed",
            dest_tx_hash: match.txHash,
            dest_from_address: operator,
            error_message: null,
          })
          .eq("id", o.id);
        await logOrderEvent(o.id, "payout", "reconciled", {
          tx_hash: match.txHash,
          block: match.blockNumber,
          source: o.dest_tx_hash ? "submitted_hash_lookup" : "operator_outbound_scan",
        });
        await notifyById("completed", o.id);
        reconciled += 1;
        continue;
      }

      // 3) No on-chain match. Decide whether to retry.
      // Safe to retry only when we can PROVE nothing was broadcast for THIS
      // order:
      //   - no submitted tx hash recorded, AND
      //   - the operator has no unmined txs (pending nonce === latest nonce),
      //     so the scan above saw every broadcast we ever made, AND
      //   - we're under the retry cap.
      const attempts = o.send_attempts ?? 0;
      const noPendingInFlight =
        currentPendingNonce !== null &&
        currentLatestNonce !== null &&
        currentPendingNonce === currentLatestNonce;
      const safeToRetry = !o.dest_tx_hash && noPendingInFlight && attempts < MAX_ATTEMPTS;

      if (safeToRetry) {
        // Roll back to `confirmed` so settleConfirmed picks it up next tick.
        await supabaseAdmin
          .from("orders")
          .update({ status: "confirmed" })
          .eq("id", o.id);
        await logOrderEvent(o.id, "note", "retry_scheduled", {
          reason: "no_broadcast_detected",
          attempts_used: attempts,
          recorded_nonce: o.dest_broadcast_nonce,
          current_pending_nonce: currentPendingNonce,
          current_latest_nonce: currentLatestNonce,
        });

        retried += 1;
        continue;
      }

      // Otherwise: ambiguous (nonce advanced but no matching transfer found)
      // or exceeded retry cap. Alert admin once via existing stuck watchdog;
      // do not double-alert here.
      if (attempts >= MAX_ATTEMPTS) {
        void sendAdminAlert(
          `Payout retry cap for ${o.public_id}`,
          `Order ${o.public_id} has reached ${attempts} send attempts with no on-chain match. Investigate manually.`,
          `retry-cap-${o.public_id}`,
        );
      }
    }
  } catch (e) {
    console.error("[reconcile] scan failed", e);
    throw e;
  }
  return { reconciled, retried };
}


async function watchDeposits() {
  const { data: orders } = await supabaseAdmin

    .from("orders")
    .select(
      "id,public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_address,dest_asset,premium_bps,quoted_dest_out,quoted_dest_per_usd,expires_at,paid_amount_usd,withdrawal_id,deposit_start_block",
    )
    .in("status", ["awaiting_payment", "payment_detected"])
    .neq("source_chain", "isk")
    .returns<OrderRow[]>();
  if (!orders?.length) return { detected: 0 };

  const byChain = new Map<ChainKey, OrderRow[]>();
  for (const o of orders) {
    const k = o.source_chain as ChainKey;
    if (!byChain.has(k)) byChain.set(k, []);
    byChain.get(k)!.push(o);
  }

  let detected = 0;
  for (const [chainKey, group] of byChain) {
    try {
      const chain = await getMergedChain(chainKey);
      const currentBlock = await getBlockNumber(chainKey);
      const fromBlock = chainStartScanBlock(chainKey, currentBlock);

      // Resolve every order's token up-front so the inner loop stays sync.
      const tokenByOrderId = new Map<string, Awaited<ReturnType<typeof getMergedToken>>>();
      for (const o of group) {
        tokenByOrderId.set(o.id, await getMergedToken(chainKey, o.source_token));
      }

      // Split orders by source token kind. ERC-20 orders share a batched
      // contract-address filter; native (ETH) orders each scan external txs.
      const erc20Orders = group.filter((o) => !isNativeToken(tokenByOrderId.get(o.id)!));
      const tokenAddresses = Array.from(
        new Set(erc20Orders.map((o) => tokenByOrderId.get(o.id)!.address)),
      );

      for (const order of group) {
        const orderToken = tokenByOrderId.get(order.id)!;
        const orderIsNative = isNativeToken(orderToken);
        const transfers = await scanIncomingTransfers({
          chain: chainKey,
          toAddress: order.deposit_address,
          tokenAddresses: orderIsNative ? [] : tokenAddresses,
          fromBlock,
          toBlock: currentBlock,
          includeNative: orderIsNative,
        });
        if (!transfers.length) continue;

        // No USD pricing anywhere — native amounts are reported as-is.
        const nativeSpot = 0;

        for (const t of transfers) {
          let usd: number;
          let sourceTokenAmount: number;
          if (orderIsNative) {
            if (t.token !== "native") continue;
            const nativeAmt = Number(t.amountWei) / 1e18;
            usd = nativeAmt * nativeSpot;
            sourceTokenAmount = nativeAmt;
          } else {
            if (t.token !== orderToken.address.toLowerCase()) continue;
            usd = weiToUsd(t.amountWei, orderToken.decimals);
            sourceTokenAmount = Number(t.amountWei) / 10 ** orderToken.decimals;
          }
          const confirmations = currentBlock - t.blockNumber + 1;

          // BLOCK-HEIGHT GUARD: reject any deposit mined before the order
          // was created. Second-layer defence against HD address recycling:
          // even if the (chain,tx_hash,log_index) dedupe row is missing,
          // a stale on-chain tx at a recycled address can't credit a fresh
          // order because its block predates the order's start snapshot.
          //
          // NOTE: the *common* cause of this is innocent — a customer got a
          // recycled address that happened to have an old deposit sitting on
          // it. So we DO NOT admin-alert on every hit (that just spams the
          // channel). We log the event once per (order, tx) for audit, and
          // only page when the SAME tx has been blocked against 2+ distinct
          // orders — that's the actual replay-attack signal.
          if (
            order.deposit_start_block != null &&
            t.blockNumber < order.deposit_start_block
          ) {
            await maybeLogStaleDeposit(order.id, order.public_id, chainKey, t.txHash, t.blockNumber, order.deposit_start_block);
            continue;
          }


          // REPLAY GUARD: reject any on-chain deposit whose (chain,tx_hash,
          // log_index) was already credited to a DIFFERENT order. HD deposit
          // addresses are recycled after 1h, so without this check the scanner
          // would credit a stale tx (from a prior order at the same address)
          // to a freshly-created order.
          const { data: existingDep } = await supabaseAdmin
            .from("deposits")
            .select("order_id")
            .eq("chain", chainKey)
            .eq("tx_hash", t.txHash)
            .eq("log_index", t.logIndex)
            .maybeSingle();
          if (existingDep && existingDep.order_id !== order.id) {
            await sendAdminAlert(
              "Replay blocked",
              `${chainKey} tx ${t.txHash} at ${order.deposit_address} was already credited to order ${existingDep.order_id}; refusing to credit ${order.public_id}.`,
              `replay:${t.txHash}:${t.logIndex}`,
            );
            await logOrderEvent(order.id, "note", "replay_blocked", {
              tx_hash: t.txHash,
              original_order_id: existingDep.order_id,
            });
            continue;
          }

          await supabaseAdmin.from("deposits").upsert(
            {
              order_id: order.id,
              chain: chainKey,
              tx_hash: t.txHash,
              log_index: t.logIndex,
              token: t.token,
              from_address: t.from,
              to_address: t.to,
              amount_usd: usd,
              amount_source: sourceTokenAmount,
              block_number: t.blockNumber,
              confirmations,
            },
            { onConflict: "chain,tx_hash,log_index" },
          );

          const { data: allDeposits } = await supabaseAdmin
            .from("deposits")
            .select("amount_usd, amount_source")
            .eq("order_id", order.id);
          const totalPaidUsd = (allDeposits ?? []).reduce(
            (sum, d) => sum + Number(d.amount_usd ?? 0),
            0,
          );
          const totalPaidSource = (allDeposits ?? []).reduce(
            (sum, d) => sum + Number(d.amount_source ?? 0),
            0,
          );

          // Payout math:
          //  - Unwrap (wISK → ISK): 1:1 minus the locked unwrap fee. USD is
          //    NOT in the formula — the wISK deposited on-chain IS the source
          //    of truth. This is a swap, not a trade.
          //  - Everything else (stables / ETH → ISK/wISK): still price-based;
          //    reprice at the locked USD → dest rate the customer accepted.
          const isUnwrap = isWiskSource(
            order.source_chain as ChainKey,
            order.source_token,
          );
          let repricedIskOut: number;
          if (isUnwrap) {
            // premium_bps was stored as -unwrap_fee_bps at creation time.
            const feeBps = Math.abs(Number(order.premium_bps ?? 0));
            const feeMul = 1 - feeBps / 10_000;
            repricedIskOut = +(totalPaidSource * feeMul).toFixed(8);
          } else {
            repricedIskOut = +(
              totalPaidUsd * Number(order.quoted_dest_per_usd)
            ).toFixed(8);
          }
          const originalIskOut = Number(order.quoted_dest_out);
          const repriced = Math.abs(repricedIskOut - originalIskOut) > 0.00000001;

          if (order.status === "awaiting_payment") {
            await supabaseAdmin
              .from("orders")
              .update({
                status: "payment_detected",
                paid_tx_hash: t.txHash,
                paid_amount_usd: totalPaidUsd,
                quoted_dest_out: repricedIskOut,
              })
              .eq("id", order.id);
            order.status = "payment_detected";
            order.paid_amount_usd = totalPaidUsd;
            order.quoted_dest_out = repricedIskOut;
            await logOrderEvent(order.id, "state", "payment_detected", {
              tx_hash: t.txHash,
              confirmations,
              original_payout: originalIskOut,
              repriced_payout: repricedIskOut,
            });
            await notifyById("payment_detected", order.id);
          } else {
            await supabaseAdmin
              .from("orders")
              .update({
                paid_amount_usd: totalPaidUsd,
                quoted_dest_out: repricedIskOut,
              })
              .eq("id", order.id);
            order.paid_amount_usd = totalPaidUsd;
            order.quoted_dest_out = repricedIskOut;
            if (repriced) {
            await logOrderEvent(order.id, "note", "repriced", {
                additional_tx: t.txHash,
                original_payout: originalIskOut,
                repriced_payout: repricedIskOut,
              });
            }
          }

          if (
            order.status === "payment_detected" &&
            confirmations >= chain.confirmations
          ) {
            await supabaseAdmin
              .from("orders")
              .update({ status: "confirmed" })
              .eq("id", order.id);
            await logOrderEvent(order.id, "state", "confirmed", { confirmations });
            await notifyById("payment_confirmed", order.id);
            detected += 1;
          }
        }
      }
    } catch (e) {
      console.error(`[watch] chain ${chainKey} failed`, e);
    }
  }
  return { detected };
}

/**
 * Wrap direction (source = native ISK → dest = wISK).
 * Scan each awaiting/detected ISK-source order's deposit address on the
 * Iskander Coin chain, price the sats at the live spot, and advance the order
 * state exactly like watchDeposits() does for EVM.
 */
async function watchIskDeposits() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,status,source_amount_usd,deposit_address,premium_bps,quoted_dest_out,quoted_dest_per_usd,original_quoted_dest_out,underpayment_ack,deposit_start_block",
    )
    .in("status", ["awaiting_payment", "payment_detected"])
    .eq("source_chain", "isk")
    .returns<
      Array<{
        id: string;
        public_id: string;
        status: string;
        source_amount_usd: number;
        deposit_address: string;
        premium_bps: number;
        quoted_dest_out: number;
        quoted_dest_per_usd: number;
        original_quoted_dest_out: number | null;
        underpayment_ack: string | null;
        deposit_start_block: number | null;
      }>
    >();
  if (!orders?.length) return { detected: 0 };

  // ISK deposits: pay out on mempool sighting (0-conf). The bridge hot
  // wallet is the only signer on the deposit address, so we can safely
  // spend the incoming UTXO before it confirms.
  const REQUIRED_CONFIRMATIONS = 0;
  let detected = 0;
  let tip = 0;
  try {
    tip = await getIskTipHeight();
  } catch (e) {
    console.error("[watch-isk] tip failed", e);
    return { detected: 0 };
  }
  // No USD accounting anywhere — wrap payout math is pure 1:1 minus the
  // locked wrap fee.
  const iskSpot = 0;

  for (const order of orders) {
    try {
      const transfers = await scanIskIncoming(order.deposit_address, tip);
      if (!transfers.length) continue;

      for (const t of transfers) {
        const iskAmount = t.amountSats / 1e8;
        const usd = iskAmount * iskSpot;

        // BLOCK-HEIGHT GUARD: reject any ISK deposit mined before the order
        // was created. Same reasoning as EVM path — usually innocent address
        // reuse, so no admin alert unless it hits 2+ orders (see helper).
        const txBlock = t.blockHeight ?? 0;
        if (
          order.deposit_start_block != null &&
          txBlock > 0 &&
          txBlock < order.deposit_start_block
        ) {
          await maybeLogStaleDeposit(order.id, order.public_id, "isk", t.txid, txBlock, order.deposit_start_block);
          continue;
        }


        // REPLAY GUARD: reject any ISK tx that was already credited to a
        // different order (address recycling means the same on-chain deposit
        // must never be counted twice).
        const { data: existingDep } = await supabaseAdmin
          .from("deposits")
          .select("order_id")
          .eq("chain", "isk")
          .eq("tx_hash", t.txid)
          .eq("log_index", 0)
          .maybeSingle();
        if (existingDep && existingDep.order_id !== order.id) {
          await sendAdminAlert(
            "Replay blocked",
            `ISK tx ${t.txid} at ${order.deposit_address} was already credited to order ${existingDep.order_id}; refusing to credit ${order.public_id}.`,
            `replay:isk:${t.txid}`,
          );
          await logOrderEvent(order.id, "note", "replay_blocked", {
            tx_hash: t.txid,
            original_order_id: existingDep.order_id,
          });
          continue;
        }


        await supabaseAdmin.from("deposits").upsert(
          {
            order_id: order.id,
            chain: "isk",
            tx_hash: t.txid,
            log_index: 0,
            token: "ISK",
            from_address: t.fromAddress ?? "",
            to_address: order.deposit_address,
            amount_usd: usd,
            amount_source: iskAmount,
            block_number: t.blockHeight ?? 0,
            confirmations: t.confirmations,
          },
          { onConflict: "chain,tx_hash,log_index" },
        );

        const { data: allDeposits } = await supabaseAdmin
          .from("deposits")
          .select("amount_usd, amount_source")
          .eq("order_id", order.id);
        const totalPaidUsd = (allDeposits ?? []).reduce(
          (sum, d) => sum + Number(d.amount_usd ?? 0),
          0,
        );
        const totalPaidIsk = (allDeposits ?? []).reduce(
          (sum, d) => sum + Number(d.amount_source ?? 0),
          0,
        );

        // Wrap payout: 1:1 minus the locked wrap fee. USD is not in the
        // formula — the ISK deposited on-chain IS the source of truth.
        const feeBps = Math.abs(Number(order.premium_bps ?? 0));
        const feeMul = 1 - feeBps / 10_000;
        const repricedOut = +(totalPaidIsk * feeMul).toFixed(8);
        const originalOut = Number(order.quoted_dest_out);
        const repriced = Math.abs(repricedOut - originalOut) > 0.00000001;

        // Underpayment gate: if the payout is >0.5% short of the ORIGINAL
        // quote, hold in payment_detected with underpayment_ack='pending'
        // until the customer either tops up (auto-clears) or accepts via
        // the order page (or the quote expires → auto-accept).
        const UNDERPAY_THRESHOLD = 0.005; // 0.5%
        const originalQuote =
          Number(order.original_quoted_dest_out) || originalOut;
        const shortRatio =
          originalQuote > 0
            ? Math.max(0, (originalQuote - repricedOut) / originalQuote)
            : 0;
        const isShort = shortRatio > UNDERPAY_THRESHOLD;
        let nextAck: string | null = order.underpayment_ack;
        if (isShort && nextAck !== "accepted") {
          nextAck = "pending";
        } else if (!isShort && nextAck === "pending") {
          // Top-up closed the gap.
          nextAck = null;
        }

        if (order.status === "awaiting_payment") {
          await supabaseAdmin
            .from("orders")
            .update({
              status: "payment_detected",
              paid_tx_hash: t.txid,
              paid_amount_usd: totalPaidUsd,
              quoted_dest_out: repricedOut,
              original_quoted_dest_out:
                order.original_quoted_dest_out ?? originalOut,
              underpayment_ack: nextAck,
            })
            .eq("id", order.id);
          order.status = "payment_detected";
          order.quoted_dest_out = repricedOut;
          order.original_quoted_dest_out =
            order.original_quoted_dest_out ?? originalOut;
          order.underpayment_ack = nextAck;
          await logOrderEvent(order.id, "state", "payment_detected", {
            tx_hash: t.txid,
            confirmations: t.confirmations,
            original_payout: originalOut,
            repriced_payout: repricedOut,
            underpayment: isShort,
            short_ratio: shortRatio,
          });
          await notifyById("payment_detected", order.id);
        } else {
          await supabaseAdmin
            .from("orders")
            .update({
              paid_amount_usd: totalPaidUsd,
              quoted_dest_out: repricedOut,
              underpayment_ack: nextAck,
            })
            .eq("id", order.id);
          order.quoted_dest_out = repricedOut;
          order.underpayment_ack = nextAck;
          if (repriced) {
            await logOrderEvent(order.id, "note", "repriced", {
              additional_tx: t.txid,
              original_payout: originalOut,
              repriced_payout: repricedOut,
              underpayment: isShort,
              short_ratio: shortRatio,
            });
          }
        }

        // Hold at payment_detected while awaiting the customer's decision.
        if (order.underpayment_ack === "pending") {
          continue;
        }

        if (
          order.status === "payment_detected" &&
          t.confirmations >= REQUIRED_CONFIRMATIONS
        ) {
          await supabaseAdmin
            .from("orders")
            .update({ status: "confirmed" })
            .eq("id", order.id);
          await logOrderEvent(order.id, "state", "confirmed", {
            confirmations: t.confirmations,
          });
          await notifyById("payment_confirmed", order.id);
          detected += 1;
        }
      }
    } catch (e) {
      console.error(`[watch-isk] order ${order.public_id} failed`, e);
    }
  }
  return { detected };
}


/**
 * For confirmed orders, pay the customer IMMEDIATELY using local signing.
 * Both ISK and wISK now sign + broadcast directly from our hot wallet.
 * No exchange is involved — this is a pure 1:1 wrap/unwrap bridge.
 */
async function settleConfirmed() {
  // Kill-switch: admin-controlled freeze halts ALL outbound customer payouts.
  // Orders stay in `confirmed` and resume on the next tick after unfreezing.
  const settings = await getSettings();
  if (settings.payouts_frozen) {
    console.warn(
      "[settle] payouts frozen — skipping",
      settings.payouts_frozen_reason ?? "(no reason set)",
    );
    return { sent: 0, frozen: true as const };
  }

  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,public_id,quoted_dest_out,dest_address,dest_asset,paid_amount_usd,send_attempts")
    .eq("status", "confirmed")
    .limit(10)
    .returns<
      Array<{
        id: string;
        public_id: string;
        quoted_dest_out: number;
        dest_address: string;
        dest_asset: string;
        paid_amount_usd: number | null;
        send_attempts: number | null;
      }>
    >();
  if (!orders?.length) return { sent: 0 };

  let sent = 0;

  // Same-origin base URL for firing off the dedicated payout endpoint. The
  // request context is guaranteed to exist here because settleConfirmed is
  // only called from inside the swap-tick POST handler.
  let originForPayout: string | null = null;
  try {
    const req = getRequest();
    originForPayout = new URL(req.url).origin;
  } catch {
    // If we somehow lost request context, wISK payouts fall back to inline
    // (which is what caused the original problem, but at least the order
    // doesn't just sit forever — the reconciler still runs).
  }

  for (const o of orders) {
    const asset = o.dest_asset || "ISK";
    try {
      // Capture the operator's pending nonce BEFORE marking `sending`. If the
      // send never lands on-chain, the reconciler compares this against the
      // current pending nonce to prove nothing was broadcast, and safely retries.
      let attemptNonce: number | null = null;
      if (asset === "wISK") {
        try {
          attemptNonce = await getEvmNonce(getOperatorEvmAddress(), "pending");
        } catch (e) {
          console.warn("[settle] could not read operator nonce", e);
        }
      }

      const nextAttempt = (o.send_attempts ?? 0) + 1;
      await supabaseAdmin
        .from("orders")
        .update({
          status: "sending",
          send_attempts: nextAttempt,
          dest_broadcast_nonce: attemptNonce,
          // Clear any prior tx hash so payout-send is allowed to broadcast
          // again on this attempt. (The reconciler only sets tx_hash from a
          // real on-chain match; if we're here it wasn't found.)
          dest_tx_hash: null,
        })
        .eq("id", o.id);
      await logOrderEvent(o.id, "state", "sending", { asset, amount: o.quoted_dest_out });
      await logOrderEvent(o.id, "note", "broadcast_attempt", {
        asset,
        amount: o.quoted_dest_out,
        attempt: nextAttempt,
        pending_nonce: attemptNonce,
      });
      // Only fire the customer-facing "sending" telegram on the first attempt.
      if (nextAttempt === 1) await notifyById("sending", o.id);

      if (asset === "wISK" && originForPayout) {
        // Dedicated Worker invocation so the send gets its own fresh CPU /
        // wall-clock budget. This MUST be awaited: an un-awaited subrequest is
        // cancelled the moment this handler returns its response, which is why
        // most `broadcast_attempt`s never produced a `broadcast_submitted`.
        // payout-send is idempotent and the reconciler retries on failure.
        const url = `${originForPayout}/api/public/hooks/payout-send`;
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
            },
            body: JSON.stringify({ orderId: o.id }),
          });
          if (!res.ok) {
            console.warn("[settle] payout-send returned", res.status, o.public_id);
          }
        } catch (err) {
          console.warn("[settle] payout-send kick failed", o.public_id, err);
        }
        sent += 1;
        continue;
      }


      // ISK (native) payouts stay inline — our own RPC node is fast and
      // doesn't have the multi-round-trip pre-flight ethers does on EVM.
      const result = await sendIsk({
        toAddress: o.dest_address,
        amountIsk: Number(o.quoted_dest_out),
      });

      await supabaseAdmin
        .from("orders")
        .update({
          status: "completed",
          dest_tx_hash: result.txid,
          dest_fee_sats: result.feeSats,
          dest_from_address: result.fromAddress,
        })
        .eq("id", o.id);
      await logOrderEvent(o.id, "payout", "sent", { ...result });
      await notifyById("completed", o.id);
      sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Settlement failed";
      const attempts = (o.send_attempts ?? 0) + 1;
      if (
        asset !== "wISK" &&
        isRetryableIskSendError(msg) &&
        attempts < MAX_ISK_SEND_ATTEMPTS
      ) {
        await requeueIskPayout(o.id, attempts, msg);
      } else {
        await failOrder(o.id, msg);
      }
    }

  }
  return { sent };
}


// Identifies which deployment produced an alert, so a shared Telegram chat
// makes it obvious where to look.
/**
 * Burn-on-unwrap. Every completed unwrap leaves the customer's wISK sitting
 * in bridge custody; until it's destroyed, circulating supply overstates the
 * ISK reserve backing it. This phase drives the dedicated burn endpoint
 * (sweep → burn) for any completed unwrap that still has no burn tx.
 *
 * Each order gets its own Worker invocation for the same reason payouts do:
 * an EVM broadcast needs a fresh CPU/wall-clock budget. The call is awaited —
 * an un-awaited subrequest is cancelled the moment this handler responds.
 */
async function reconcileBurns() {
  const { data: pending } = await supabaseAdmin
    .from("orders")
    .select("id,public_id,burn_attempts")
    .eq("status", "completed")
    .eq("dest_asset", "ISK")
    .eq("source_token", "wISK")
    .is("burn_tx_hash", null)
    .lt("burn_attempts", 8)
    .order("updated_at", { ascending: true })
    .limit(3)
    .returns<Array<{ id: string; public_id: string; burn_attempts: number | null }>>();
  if (!pending?.length) return { burned: 0 };

  let origin: string | null = null;
  try {
    origin = new URL(getRequest().url).origin;
  } catch {
    return { burned: 0 };
  }

  let burned = 0;
  for (const o of pending) {
    try {
      const res = await fetch(`${origin}/api/public/hooks/burn-unwrapped`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
        },
        body: JSON.stringify({ orderId: o.id }),
      });
      if (res.ok) burned += 1;
      else console.warn("[burns] burn-unwrapped returned", res.status, o.public_id);
    } catch (err) {
      console.warn("[burns] burn kick failed", o.public_id, err);
    }
  }
  return { burned };
}


const SITE_LABEL = "wISK Wrap — wisk.iskandercoin.com";

/**
 * Read hot-wallet balances (ISK + wISK) each tick; fire a deduped admin
 * Telegram alert when either drops below the admin-configured floor
 * (app_settings.low_isk_threshold / low_wisk_threshold). sendAdminAlert
 * has a 15-min cooldown per (title, dedupeKey), so a sustained low
 * balance produces at most 4 pings/hr per asset.
 *
 * ISK lives in an HD wallet: unswept customer deposits sit at derived
 * indices, so the hot address alone under-reports. Only alert when the
 * WHOLE HD wallet is below the floor.
 */
async function checkHotBalances(): Promise<{ isk: number | null; wisk: number | null }> {
  const settings = await getSettings();
  const iskFloor = Number(settings.low_isk_threshold ?? 10_000);
  const wiskFloor = Number(settings.low_wisk_threshold ?? 10_000);
  const out: { isk: number | null; wisk: number | null } = { isk: null, wisk: null };

  try {
    const { getIskHotAddress, getIskAddressBalanceSats } = await import(
      "@/lib/isk-sign.server"
    );
    const address = getIskHotAddress();
    const { confirmed, unconfirmed } = await getIskAddressBalanceSats(address);
    const confirmedIsk = confirmed / 1e8;
    const pendingIsk = unconfirmed / 1e8;
    out.isk = confirmedIsk;
    if (confirmedIsk < iskFloor) {
      // Hot address looks low — check the full HD wallet before paging.
      const { getIskHdTotal } = await import("@/lib/isk-hd-balance.server");
      const hd = await getIskHdTotal(address).catch(() => null);
      const hdTotal = hd?.totalConfirmed ?? confirmedIsk;
      out.isk = hdTotal;
      if (hdTotal < iskFloor) {
        void sendAdminAlert(
          `⚠️ ISK hot wallet low — ${SITE_LABEL}`,
          `Site: ${SITE_LABEL}\n` +
            `HD wallet total: ${hdTotal.toFixed(4)} ISK` +
            (hd ? ` (across ${hd.derivedScanned + 1} addresses)` : "") +
            `\nHot address: ${confirmedIsk.toFixed(4)} ISK` +
            (pendingIsk ? ` (+${pendingIsk.toFixed(4)} pending)` : "") +
            (hd ? `\nDeposit addresses: ${hd.derivedConfirmed.toFixed(4)} ISK` : "") +
            `\nFloor: ${iskFloor} ISK\nAddress: ${address}\nRecharge to keep payouts flowing.`,
          "low-isk",
        );
      } else if (hd) {
        console.info(
          `[check-hot-balances] hot address low (${confirmedIsk.toFixed(4)}) but HD total ${hdTotal.toFixed(4)} ≥ floor — no alert; sweep deposits to the hot address`,
        );
      }
    }
  } catch (e) {
    console.warn("[check-hot-balances] ISK read failed", e);
  }

  try {
    const { getOperatorEvmAddress } = await import("@/lib/bridge-wallet.server");
    const { getWiskBalance } = await import("@/lib/wisk.server");
    const address = getOperatorEvmAddress();
    const balance = await getWiskBalance(address);
    out.wisk = balance;
    if (balance < wiskFloor) {
      void sendAdminAlert(
        `⚠️ wISK operator wallet low — ${SITE_LABEL}`,
        `Site: ${SITE_LABEL}\nBalance: ${balance.toFixed(4)} wISK\nFloor: ${wiskFloor} wISK\nAddress: ${address}\nWrap more ISK to keep payouts flowing.`,
        "low-wisk",
      );
    }
  } catch (e) {
    console.warn("[check-hot-balances] wISK read failed", e);
  }

  return out;
}


export const Route = createFileRoute("/api/public/hooks/swap-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: this endpoint triggers real on-chain payouts
        // and Alchemy quota usage. Only the pg_cron job (which sends the
        // project's publishable/anon key in the `apikey` header) may invoke it.
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("x-cron-key") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const started = Date.now();
        const result = {
          expired: 0,
          stuck: { stuck: 0 },
          watch: { detected: 0 },
          watchIsk: { detected: 0 },
          settle: { sent: 0 },
          balances: { isk: null as number | null, wisk: null as number | null },
          reconcile: { reconciled: 0, retried: 0 },
          ms: 0,
        };
        // Run each phase independently so one failure doesn't starve the
        // others. Phase errors fire a deduped admin Telegram alert.
        async function runPhase<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
          try {
            return await fn();
          } catch (e) {
            const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
            console.error(`[swap-tick] ${name} failed`, e);
            void sendAdminAlert(`swap-tick phase "${name}" failed`, msg, name);
            return null;
          }
        }

        try {
          await runPhase("expireStale", expireStale);
          result.stuck = (await runPhase("detectStuck", detectStuck)) ?? result.stuck;
          result.reconcile =
            (await runPhase("reconcileStuckSending", reconcileStuckSending)) ?? result.reconcile;
          result.watch = (await runPhase("watchDeposits", watchDeposits)) ?? result.watch;
          result.watchIsk = (await runPhase("watchIskDeposits", watchIskDeposits)) ?? result.watchIsk;
          result.settle = (await runPhase("settleConfirmed", settleConfirmed)) ?? result.settle;
          result.balances = (await runPhase("checkHotBalances", checkHotBalances)) ?? result.balances;

          // Fast mempool loop: pg_cron's minimum cadence is 1 minute, but ISK
          // wrap payouts fire on 0-conf mempool sighting. Do 3 extra light
          // passes (ISK mempool watch + settle) spaced 15s apart so worst-case
          // detection → payout latency is ~15s instead of ~60s. Bail early if
          // the initial pass already burned most of the minute.
          const FAST_INTERVAL_MS = 15_000;
          const MAX_TOTAL_MS = 55_000;
          for (let i = 0; i < 3; i++) {
            if (Date.now() - started > MAX_TOTAL_MS - FAST_INTERVAL_MS) break;
            await new Promise((r) => setTimeout(r, FAST_INTERVAL_MS));
            const w = await runPhase("watchIskDeposits", watchIskDeposits);
            if (w) result.watchIsk.detected += w.detected;
            const s = await runPhase("settleConfirmed", settleConfirmed);
            if (s) result.settle.sent += s.sent;
          }
        } catch (e) {
          const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
          console.error("[swap-tick] fatal", e);
          void sendAdminAlert("swap-tick fatal crash", msg, "fatal");
          return new Response(
            JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "fatal" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        result.ms = Date.now() - started;
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { "content-type": "application/json" },
        });
      },
      GET: async () => {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
