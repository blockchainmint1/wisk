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
      "id,public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_txc_address,quoted_txc_out,expires_at,paid_amount_usd,bitmart_order_id,bitmart_filled_txc,withdrawal_id",
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

          if (order.status === "awaiting_payment") {
            await supabaseAdmin
              .from("orders")
              .update({
                status: "payment_detected",
                paid_tx_hash: t.txHash,
                paid_amount_usd: totalPaidUsd,
              })
              .eq("id", order.id);
            order.status = "payment_detected";
            order.paid_amount_usd = totalPaidUsd;
            await logOrderEvent(order.id, "state", "payment_detected", {
              tx_hash: t.txHash,
              usd: totalPaidUsd,
              confirmations,
            });
            await notifyById("payment_detected", order.id);
          } else {
            await supabaseAdmin
              .from("orders")
              .update({ paid_amount_usd: totalPaidUsd })
              .eq("id", order.id);
            order.paid_amount_usd = totalPaidUsd;
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

async function buyOnBitmart() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,public_id,paid_amount_usd,quoted_txc_out,dest_asset")
    .eq("status", "confirmed")
    .limit(10)
    .returns<
      Array<{
        id: string;
        public_id: string;
        paid_amount_usd: number | null;
        quoted_txc_out: number;
        dest_asset: string;
      }>
    >();
  if (!orders?.length) return { bought: 0 };

  let bought = 0;
  for (const o of orders) {
    try {
      const notional = o.paid_amount_usd ?? 0;
      if (notional <= 0) {
        await failOrder(o.id, "Missing paid amount");
        continue;
      }
      const dest = getDestination(o.dest_asset);
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
      bought += 1;
    } catch (e) {
      await failOrder(o.id, e instanceof Error ? e.message : "Bitmart buy failed");
    }
  }
  return { bought };
}

async function pollBitmartFills() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,bitmart_order_id")
    .eq("status", "buying_on_bitmart")
    .not("bitmart_order_id", "is", null)
    .returns<Array<{ id: string; bitmart_order_id: string }>>();
  if (!orders?.length) return { filled: 0 };

  let filled = 0;
  for (const o of orders) {
    try {
      const detail = await getOrderDetail(o.bitmart_order_id);
      if (detail.state === "filled") {
        const txcAmount = Number.parseFloat(detail.filled_size);
        const avgPrice = Number.parseFloat(detail.price_avg);
        await supabaseAdmin
          .from("orders")
          .update({
            status: "bought",
            bitmart_filled_txc: txcAmount,
            bitmart_avg_price: avgPrice,
          })
          .eq("id", o.id);
        await logOrderEvent(o.id, "bitmart", "filled", {
          filled: txcAmount,
          avg_price: avgPrice,
        });
        await notifyById("bitmart_filled", o.id);
        filled += 1;
      } else if (detail.state === "canceled") {
        await failOrder(o.id, "Bitmart order canceled");
      }
    } catch (e) {
      console.error("[poll-fill]", o.bitmart_order_id, e);
    }
  }
  return { filled };
}

/**
 * Pay out completed Bitmart buys to the customer.
 * - TXC: sign + broadcast locally (skip Bitmart withdrawal entirely).
 * - ISK$: still uses Bitmart withdrawal until local signing is wired.
 */
async function settleBought() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,bitmart_filled_txc,dest_txc_address,dest_asset")
    .eq("status", "bought")
    .returns<
      Array<{
        id: string;
        bitmart_filled_txc: number;
        dest_txc_address: string;
        dest_asset: string;
      }>
    >();
  if (!orders?.length) return { settled: 0, withdrawing: 0 };

  let settled = 0;
  let withdrawing = 0;

  for (const o of orders) {
    const asset = o.dest_asset || "TXC";
    try {
      if (asset === "TXC") {
        // Local signing path
        await supabaseAdmin.from("orders").update({ status: "sending" }).eq("id", o.id);
        await logOrderEvent(o.id, "state", "sending", { asset });
        await notifyById("sending", o.id);

        const result = await sendTxc({
          toAddress: o.dest_txc_address,
          amountTxc: Number(o.bitmart_filled_txc),
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
        settled += 1;
      } else {
        // ISK$ — Bitmart withdraw fallback
        const dest = getDestination(asset);
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
      }
    } catch (e) {
      await failOrder(o.id, e instanceof Error ? e.message : "Settlement failed");
    }
  }
  return { settled, withdrawing };
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
          buy: { bought: 0 },
          fills: { filled: 0 },
          settle: { settled: 0, withdrawing: 0 },
          polls: { completed: 0 },
          ms: 0,
        };
        try {
          await expireStale();
          result.watch = await watchDeposits();
          result.buy = await buyOnBitmart();
          result.fills = await pollBitmartFills();
          result.settle = await settleBought();
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
