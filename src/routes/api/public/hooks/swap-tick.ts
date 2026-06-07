// Fulfillment cron tick — called by pg_cron every minute.
// Customer flow (TXC):
//   awaiting_payment → payment_detected → confirmed → sending → completed
//   TXC is sent locally from our hot wallet using the quoted amount.
//   Bitmart is NEVER on the critical path for TXC orders.
// Treasury replenishment (background, decoupled):
//   For completed TXC orders, submit a market buy on Bitmart to refill our
//   wallet. The bitmart_order_id / bitmart_filled_txc columns track this but
//   never gate customer payout.
// ISK$ flow still goes through Bitmart buy → withdraw until local signing.
// Auth: route lives under /api/public/* which bypasses Lovable's site auth.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getOrderDetail,
  getWithdrawDetail,
  submitMarketBuy,
  submitWithdrawal,
} from "@/lib/bitmart.server";
import {
  chainStartScanBlock,
  getBlockNumber,
  scanIncomingTransfers,
  weiToUsd,
} from "@/lib/evm-scan.server";
import { getChain, getToken, type ChainKey } from "@/lib/chains";
import { getDestination } from "@/lib/destinations";
import { notifyOrderEvent, logOrderEvent } from "@/lib/telegram.server";
import { sendTxc } from "@/lib/txc-sign.server";

async function notifyById(
  event: Parameters<typeof notifyOrderEvent>[0],
  orderId: string,
) {
  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,source_chain,source_token,source_amount_usd,paid_amount_usd,dest_asset,dest_txc_address,quoted_txc_out,bitmart_order_id,bitmart_filled_txc,bitmart_avg_price,paid_tx_hash,txc_tx_hash,txc_fee_sats,txc_from_address,error_message",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (data) void notifyOrderEvent(event, data);
}

interface OrderRow {
  id: string;
  public_id: string;
  status: string;
  source_chain: string;
  source_token: string;
  source_amount_usd: number;
  deposit_address: string;
  dest_txc_address: string;
  quoted_txc_out: number;
  quoted_txc_per_usd: number;
  expires_at: string;
  paid_amount_usd: number | null;
  bitmart_order_id: string | null;
  bitmart_filled_txc: number | null;
  withdrawal_id: string | null;
}

async function failOrder(orderId: string, message: string) {
  await supabaseAdmin
    .from("orders")
    .update({ status: "failed", error_message: message })
    .eq("id", orderId);
  await logOrderEvent(orderId, "error", "failed", { message });
  await notifyById("failed", orderId);
}

async function expireStale() {
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

async function watchDeposits() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_txc_address,quoted_txc_out,quoted_txc_per_usd,expires_at,paid_amount_usd,bitmart_order_id,bitmart_filled_txc,withdrawal_id",
    )
    .in("status", ["awaiting_payment", "payment_detected"])
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
      const chain = getChain(chainKey);
      const currentBlock = await getBlockNumber(chainKey);
      const fromBlock = chainStartScanBlock(chainKey, currentBlock);
      const tokenAddresses = Array.from(new Set(group.map((o) => getToken(chainKey, o.source_token).address)));

      for (const order of group) {
        const transfers = await scanIncomingTransfers({
          chain: chainKey,
          toAddress: order.deposit_address,
          tokenAddresses,
          fromBlock,
          toBlock: currentBlock,
        });
        if (!transfers.length) continue;

        for (const t of transfers) {
          const token = getToken(chainKey, order.source_token);
          if (t.token !== token.address.toLowerCase()) continue;
          const usd = weiToUsd(t.amountWei, token.decimals);
          const confirmations = currentBlock - t.blockNumber + 1;

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
              block_number: t.blockNumber,
              confirmations,
            },
            { onConflict: "chain,tx_hash,log_index" },
          );

          const { data: allDeposits } = await supabaseAdmin
            .from("deposits")
            .select("amount_usd")
            .eq("order_id", order.id);
          const totalPaidUsd = (allDeposits ?? []).reduce(
            (sum, d) => sum + Number(d.amount_usd ?? 0),
            0,
          );

          // Re-price the TXC payout to match what the customer actually sent,
          // at the locked quote rate. Protects us on underpayments and
          // credits the customer fairly on overpayments.
          const repricedTxcOut = +(totalPaidUsd * Number(order.quoted_txc_per_usd)).toFixed(8);
          const originalTxcOut = Number(order.quoted_txc_out);
          const repriced = Math.abs(repricedTxcOut - originalTxcOut) > 0.00000001;

          if (order.status === "awaiting_payment") {
            await supabaseAdmin
              .from("orders")
              .update({
                status: "payment_detected",
                paid_tx_hash: t.txHash,
                paid_amount_usd: totalPaidUsd,
                quoted_txc_out: repricedTxcOut,
              })
              .eq("id", order.id);
            order.status = "payment_detected";
            order.paid_amount_usd = totalPaidUsd;
            order.quoted_txc_out = repricedTxcOut;
            await logOrderEvent(order.id, "state", "payment_detected", {
              tx_hash: t.txHash,
              usd: totalPaidUsd,
              confirmations,
              original_txc_out: originalTxcOut,
              repriced_txc_out: repricedTxcOut,
            });
            await notifyById("payment_detected", order.id);
          } else {
            await supabaseAdmin
              .from("orders")
              .update({
                paid_amount_usd: totalPaidUsd,
                quoted_txc_out: repricedTxcOut,
              })
              .eq("id", order.id);
            order.paid_amount_usd = totalPaidUsd;
            order.quoted_txc_out = repricedTxcOut;
            if (repriced) {
              await logOrderEvent(order.id, "quote", "repriced", {
                additional_tx: t.txHash,
                total_usd: totalPaidUsd,
                original_txc_out: originalTxcOut,
                repriced_txc_out: repricedTxcOut,
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
 * For confirmed orders, pay the customer IMMEDIATELY.
 * - TXC: sign + broadcast locally using the quoted amount.
 * - ISK$: still flows through Bitmart (buyOnBitmartForIskOrders + withdraw).
 */
async function settleConfirmed() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,public_id,quoted_txc_out,dest_txc_address,dest_asset,paid_amount_usd")
    .eq("status", "confirmed")
    .limit(10)
    .returns<
      Array<{
        id: string;
        public_id: string;
        quoted_txc_out: number;
        dest_txc_address: string;
        dest_asset: string;
        paid_amount_usd: number | null;
      }>
    >();
  if (!orders?.length) return { sent: 0, queuedForBitmart: 0 };

  let sent = 0;
  let queuedForBitmart = 0;

  for (const o of orders) {
    const asset = o.dest_asset || "TXC";
    try {
      if (asset === "TXC") {
        // ---- Pay customer locally, no Bitmart dependency ----
        await supabaseAdmin.from("orders").update({ status: "sending" }).eq("id", o.id);
        await logOrderEvent(o.id, "state", "sending", { asset, amount: o.quoted_txc_out });
        await notifyById("sending", o.id);

        const result = await sendTxc({
          toAddress: o.dest_txc_address,
          amountTxc: Number(o.quoted_txc_out),
        });

        await supabaseAdmin
          .from("orders")
          .update({
            status: "completed",
            txc_tx_hash: result.txid,
            txc_fee_sats: result.feeSats,
            txc_from_address: result.fromAddress,
          })
          .eq("id", o.id);
        await logOrderEvent(o.id, "payout", "sent", { ...result });
        await notifyById("completed", o.id);
        sent += 1;
      } else {
        // ISK$ — still goes through Bitmart buy → withdraw
        const dest = getDestination(asset);
        const notional = o.paid_amount_usd ?? 0;
        if (notional <= 0) {
          await failOrder(o.id, "Missing paid amount");
          continue;
        }
        const buyNotional = +(notional / 1.05).toFixed(2);
        await supabaseAdmin
          .from("orders")
          .update({ status: "buying_on_bitmart" })
          .eq("id", o.id);
        await logOrderEvent(o.id, "state", "buying_on_bitmart", {
          notional: buyNotional,
          symbol: dest.bitmartSymbol,
        });
        const { order_id } = await submitMarketBuy({
          symbol: dest.bitmartSymbol,
          notionalUsdt: buyNotional,
        });
        await supabaseAdmin
          .from("orders")
          .update({ bitmart_order_id: order_id })
          .eq("id", o.id);
        await logOrderEvent(o.id, "bitmart", "buy_submitted", {
          bitmart_order_id: order_id,
          notional: buyNotional,
        });
        queuedForBitmart += 1;
      }
    } catch (e) {
      await failOrder(o.id, e instanceof Error ? e.message : "Settlement failed");
    }
  }
  return { sent, queuedForBitmart };
}

/**
 * Treasury replenishment — runs AFTER the customer is paid.
 * For each completed TXC order that has not yet had a Bitmart buy submitted,
 * submit a market buy to refill our hot wallet. This is best-effort: failures
 * here do NOT affect the customer order, they just log and retry next tick.
 */
async function replenishTreasury() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,public_id,paid_amount_usd,dest_asset")
    .eq("status", "completed")
    .eq("dest_asset", "TXC")
    .is("bitmart_order_id", null)
    .not("paid_amount_usd", "is", null)
    .limit(10)
    .returns<
      Array<{
        id: string;
        public_id: string;
        paid_amount_usd: number;
        dest_asset: string;
      }>
    >();
  if (!orders?.length) return { submitted: 0 };

  let submitted = 0;
  for (const o of orders) {
    try {
      const dest = getDestination(o.dest_asset);
      const buyNotional = +(Number(o.paid_amount_usd) / 1.05).toFixed(2);
      if (buyNotional <= 0) continue;
      const { order_id } = await submitMarketBuy({
        symbol: dest.bitmartSymbol,
        notionalUsdt: buyNotional,
      });
      await supabaseAdmin
        .from("orders")
        .update({ bitmart_order_id: order_id })
        .eq("id", o.id);
      await logOrderEvent(o.id, "bitmart", "replenish_submitted", {
        bitmart_order_id: order_id,
        notional: buyNotional,
      });
      submitted += 1;
    } catch (e) {
      // Non-fatal: customer is already paid. Log and continue.
      console.error("[replenish]", o.public_id, e);
      await logOrderEvent(o.id, "bitmart", "replenish_error", {
        message: e instanceof Error ? e.message : "submit failed",
      });
    }
  }
  return { submitted };
}

/**
 * Poll Bitmart fills for ANY order with a bitmart_order_id and no recorded
 * fill yet. Updates bookkeeping (bitmart_filled_txc, bitmart_avg_price) but
 * does NOT change customer-facing status for TXC orders (already completed).
 * For ISK$ orders still in buying_on_bitmart, advances to `bought` so the
 * withdrawal step picks them up.
 */
async function pollBitmartFillsDecoupled() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,status,bitmart_order_id,bitmart_filled_txc,dest_asset")
    .not("bitmart_order_id", "is", null)
    .is("bitmart_filled_txc", null)
    .limit(20)
    .returns<
      Array<{
        id: string;
        status: string;
        bitmart_order_id: string;
        bitmart_filled_txc: number | null;
        dest_asset: string;
      }>
    >();
  if (!orders?.length) return { filled: 0 };

  let filled = 0;
  for (const o of orders) {
    try {
      const detail = await getOrderDetail(o.bitmart_order_id);
      if (detail.state === "filled") {
        const txcAmount = Number.parseFloat(detail.filled_size);
        const avgPrice = Number.parseFloat(detail.price_avg);
        const update: {
          bitmart_filled_txc: number;
          bitmart_avg_price: number;
          status?: "bought";
        } = {
          bitmart_filled_txc: txcAmount,
          bitmart_avg_price: avgPrice,
        };
        // ISK$ flow: advance to `bought` so withdrawal step takes over.
        if (o.status === "buying_on_bitmart" && o.dest_asset !== "TXC") {
          update.status = "bought";
        }
        await supabaseAdmin.from("orders").update(update).eq("id", o.id);
        await logOrderEvent(o.id, "bitmart", "filled", {
          filled: txcAmount,
          avg_price: avgPrice,
        });
        filled += 1;
      } else if (detail.state === "canceled") {
        await logOrderEvent(o.id, "bitmart", "canceled", {});
        // For TXC orders this is just a treasury hiccup, not a customer fail.
        // For ISK$ in buying state, mark failed (customer still owed).
        if (o.status === "buying_on_bitmart" && o.dest_asset !== "TXC") {
          await failOrder(o.id, "Bitmart order canceled");
        }
      }
    } catch (e) {
      console.error("[poll-fill]", o.bitmart_order_id, e);
    }
  }
  return { filled };
}

/**
 * ISK$ withdrawal path — for orders that completed a Bitmart buy and need
 * a withdrawal to the customer's address.
 */
async function settleIskWithdrawal() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,bitmart_filled_txc,dest_txc_address,dest_asset")
    .eq("status", "bought")
    .neq("dest_asset", "TXC")
    .returns<
      Array<{
        id: string;
        bitmart_filled_txc: number;
        dest_txc_address: string;
        dest_asset: string;
      }>
    >();
  if (!orders?.length) return { withdrawing: 0 };

  let withdrawing = 0;
  for (const o of orders) {
    try {
      const dest = getDestination(o.dest_asset);
      await supabaseAdmin.from("orders").update({ status: "withdrawing" }).eq("id", o.id);
      const { withdraw_id } = await submitWithdrawal({
        currency: dest.bitmartCurrency,
        network: dest.bitmartNetwork,
        amount: o.bitmart_filled_txc,
        address: o.dest_txc_address,
      });
      await supabaseAdmin.from("orders").update({ withdrawal_id: withdraw_id }).eq("id", o.id);
      await logOrderEvent(o.id, "bitmart", "withdraw_submitted", { withdraw_id });
      withdrawing += 1;
    } catch (e) {
      await failOrder(o.id, e instanceof Error ? e.message : "Withdrawal failed");
    }
  }
  return { withdrawing };
}


async function pollWithdrawals() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,withdrawal_id")
    .eq("status", "withdrawing")
    .not("withdrawal_id", "is", null)
    .returns<Array<{ id: string; withdrawal_id: string }>>();
  if (!orders?.length) return { completed: 0 };

  let completed = 0;
  for (const o of orders) {
    try {
      const detail = await getWithdrawDetail(o.withdrawal_id);
      if (detail.status === 3 && detail.tx_id) {
        await supabaseAdmin
          .from("orders")
          .update({ status: "completed", txc_tx_hash: detail.tx_id })
          .eq("id", o.id);
        await logOrderEvent(o.id, "bitmart", "withdraw_completed", { tx_id: detail.tx_id });
        await notifyById("completed", o.id);
        completed += 1;
      } else if (detail.status === 4 || detail.status === 5) {
        await failOrder(o.id, `Withdrawal failed (status ${detail.status})`);
      }
    } catch (e) {
      console.error("[poll-wd]", o.withdrawal_id, e);
    }
  }
  return { completed };
}

export const Route = createFileRoute("/api/public/hooks/swap-tick")({
  server: {
    handlers: {
      POST: async () => {
        const started = Date.now();
        const result = {
          expired: 0,
          watch: { detected: 0 },
          
          fills: { filled: 0 },
          settle: { sent: 0, queuedForBitmart: 0 },
          replenish: { submitted: 0 },
          isk: { withdrawing: 0 },
          polls: { completed: 0 },
          ms: 0,
        };
        try {
          await expireStale();
          result.watch = await watchDeposits();
          // Pay customer FIRST — never block on Bitmart for TXC orders.
          result.settle = await settleConfirmed();
          // Treasury replenishment runs after customer payout, in background.
          result.replenish = await replenishTreasury();
          // Bookkeeping for any open Bitmart orders (decoupled from customer).
          result.fills = await pollBitmartFillsDecoupled();
          // ISK$ continues through Bitmart withdrawal.
          result.isk = await settleIskWithdrawal();
          result.polls = await pollWithdrawals();
        } catch (e) {
          console.error("[swap-tick] fatal", e);
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
