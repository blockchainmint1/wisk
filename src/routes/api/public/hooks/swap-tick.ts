// Fulfillment cron tick — called by pg_cron every minute.
// 1) Watch awaiting orders for deposit confirmation
// 2) Buy TXC on Bitmart for confirmed orders
// 3) Trigger and poll withdrawals
// Auth: pg_cron uses Supabase publishable key in `apikey` header. Route lives
// under /api/public/* which bypasses Lovable's site auth.
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
import { notifyOrderEvent } from "@/lib/telegram.server";

async function notifyById(
  event: Parameters<typeof notifyOrderEvent>[0],
  orderId: string,
) {
  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      "public_id,source_chain,source_token,source_amount_usd,paid_amount_usd,dest_txc_address,quoted_txc_out,bitmart_filled_txc,bitmart_avg_price,paid_tx_hash,txc_tx_hash,error_message",
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
  await notifyById("failed", orderId);
}

async function expireStale() {
  const { data: expired } = await supabaseAdmin
    .from("orders")
    .update({ status: "expired" })
    .eq("status", "awaiting_payment")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  for (const row of expired ?? []) await notifyById("expired", row.id);
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

  // Group by chain to batch RPC calls
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

      // Scan each unique address (RPC limitation: topic3 must be a single value
      // or null, so we loop per address)
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

          // Record the deposit (idempotent via unique constraint)
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

          // Sum all deposits for this order (handles multi-tx payments).
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
            await notifyById("payment_detected", order.id);
          } else {
            // Keep paid_amount_usd in sync as more transfers arrive.
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
    .select("id,public_id,paid_amount_usd,quoted_txc_out")
    .eq("status", "confirmed")
    .limit(10)
    .returns<Array<{ id: string; public_id: string; paid_amount_usd: number | null; quoted_txc_out: number }>>();
  if (!orders?.length) return { bought: 0 };

  let bought = 0;
  for (const o of orders) {
    try {
      const notional = o.paid_amount_usd ?? 0;
      if (notional <= 0) {
        await failOrder(o.id, "Missing paid amount");
        continue;
      }
      // We retain the 5% premium; spend (notional / 1.05) on the spot buy.
      const buyNotional = +(notional / 1.05).toFixed(2);
      await supabaseAdmin
        .from("orders")
        .update({ status: "buying_on_bitmart" })
        .eq("id", o.id);
      const { order_id } = await submitMarketBuy(buyNotional);
      await supabaseAdmin
        .from("orders")
        .update({ bitmart_order_id: order_id })
        .eq("id", o.id);
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

async function withdrawTxc() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,bitmart_filled_txc,dest_txc_address")
    .eq("status", "bought")
    .returns<Array<{ id: string; bitmart_filled_txc: number; dest_txc_address: string }>>();
  if (!orders?.length) return { withdrawing: 0 };

  let withdrawing = 0;
  for (const o of orders) {
    try {
      await supabaseAdmin.from("orders").update({ status: "withdrawing" }).eq("id", o.id);
      const { withdraw_id } = await submitWithdrawal({
        amount: o.bitmart_filled_txc,
        address: o.dest_txc_address,
      });
      await supabaseAdmin.from("orders").update({ withdrawal_id: withdraw_id }).eq("id", o.id);
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
          withdraw: { withdrawing: 0 },
          polls: { completed: 0 },
          ms: 0,
        };
        try {
          await expireStale();
          result.watch = await watchDeposits();
          result.buy = await buyOnBitmart();
          result.fills = await pollBitmartFills();
          result.withdraw = await withdrawTxc();
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
        // Health check
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
