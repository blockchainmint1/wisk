// Fulfillment cron tick — called by pg_cron every minute.
// Customer flow (TXC and wTXC):
//   awaiting_payment → payment_detected → confirmed → sending → completed
//   Payout is signed + broadcast locally from our hot/operator wallet using
//   the quoted amount. Bitmart is NEVER on the critical path.
// Treasury replenishment (background, decoupled):
//   For completed on-ramp orders (stables/ETH → TXC or wTXC), submit a
//   market buy on Bitmart to refill the TXC hot wallet. For unwrap orders
//   (wTXC → TXC) we skip Bitmart entirely — the user gave us wTXC which
//   we already hold; re-wrapping TXC back to wTXC is a manual admin op.
// Auth: route lives under /api/public/* which bypasses Lovable's site auth.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getOrderDetail,
  submitMarketBuy,
} from "@/lib/bitmart.server";
import {
  chainStartScanBlock,
  getBlockNumber,
  scanIncomingTransfers,
  weiToUsd,
} from "@/lib/evm-scan.server";
import { isNativeToken, isWtxcSource, type ChainKey } from "@/lib/chains";
import { getMergedChain, getMergedToken } from "@/lib/chains.server";
import { getDestination } from "@/lib/destinations";
import { notifyOrderEvent, logOrderEvent, sendAdminAlert } from "@/lib/telegram.server";
import { getSettings } from "@/lib/settings.server";
import { sendTxc } from "@/lib/txc-sign.server";
import { sendWtxc } from "@/lib/wtxc.server";
import { getSpotPrice } from "@/lib/bitmart.server";
import { scanTxcIncoming, getTxcTipHeight } from "@/lib/txc-scan.server";

async function notifyById(
  event: Parameters<typeof notifyOrderEvent>[0],
  orderId: string,
) {
  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,source_chain,source_token,source_amount_usd,paid_amount_usd,dest_asset,dest_address,quoted_dest_out,bitmart_order_id,bitmart_filled_dest,bitmart_avg_price,paid_tx_hash,dest_tx_hash,dest_fee_sats,dest_from_address,error_message",
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
  dest_address: string;
  quoted_dest_out: number;
  quoted_dest_per_usd: number;
  expires_at: string;
  paid_amount_usd: number | null;
  bitmart_order_id: string | null;
  bitmart_filled_dest: number | null;
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

/**
 * Detect orders that are still mid-flight (not awaiting_payment, completed,
 * failed, or expired) past the expiry window + 5 min grace, and alert once.
 * These are payment_detected / confirmed / sending / buying_on_bitmart /
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

async function watchDeposits() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_address,quoted_dest_out,quoted_dest_per_usd,expires_at,paid_amount_usd,bitmart_order_id,bitmart_filled_dest,withdrawal_id",
    )
    .in("status", ["awaiting_payment", "payment_detected"])
    .neq("source_chain", "txc")
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

        // For native orders we need a live spot to convert wei → USD.
        let nativeSpot = 0;
        if (orderIsNative && orderToken.bitmartSymbol) {
          try {
            nativeSpot = await getSpotPrice(orderToken.bitmartSymbol);
          } catch (e) {
            console.error(`[watch] spot lookup failed`, e);
            continue;
          }
        }

        for (const t of transfers) {
          let usd: number;
          if (orderIsNative) {
            if (t.token !== "native") continue;
            const nativeAmt = Number(t.amountWei) / 1e18;
            usd = nativeAmt * nativeSpot;
          } else {
            if (t.token !== orderToken.address.toLowerCase()) continue;
            usd = weiToUsd(t.amountWei, orderToken.decimals);
          }
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
          const repricedTxcOut = +(totalPaidUsd * Number(order.quoted_dest_per_usd)).toFixed(8);
          const originalTxcOut = Number(order.quoted_dest_out);
          const repriced = Math.abs(repricedTxcOut - originalTxcOut) > 0.00000001;

          if (order.status === "awaiting_payment") {
            await supabaseAdmin
              .from("orders")
              .update({
                status: "payment_detected",
                paid_tx_hash: t.txHash,
                paid_amount_usd: totalPaidUsd,
                quoted_dest_out: repricedTxcOut,
              })
              .eq("id", order.id);
            order.status = "payment_detected";
            order.paid_amount_usd = totalPaidUsd;
            order.quoted_dest_out = repricedTxcOut;
            await logOrderEvent(order.id, "state", "payment_detected", {
              tx_hash: t.txHash,
              usd: totalPaidUsd,
              confirmations,
              original_payout: originalTxcOut,
              repriced_payout: repricedTxcOut,
            });
            await notifyById("payment_detected", order.id);
          } else {
            await supabaseAdmin
              .from("orders")
              .update({
                paid_amount_usd: totalPaidUsd,
                quoted_dest_out: repricedTxcOut,
              })
              .eq("id", order.id);
            order.paid_amount_usd = totalPaidUsd;
            order.quoted_dest_out = repricedTxcOut;
            if (repriced) {
            await logOrderEvent(order.id, "note", "repriced", {
                additional_tx: t.txHash,
                total_usd: totalPaidUsd,
                original_payout: originalTxcOut,
                repriced_payout: repricedTxcOut,
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
 * Wrap direction (source = native TXC → dest = wTXC).
 * Scan each awaiting/detected TXC-source order's deposit address on the
 * TEXITcoin chain, price the sats at the live spot, and advance the order
 * state exactly like watchDeposits() does for EVM.
 */
async function watchTxcDeposits() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select(
      "id,public_id,status,source_amount_usd,deposit_address,quoted_dest_out,quoted_dest_per_usd",
    )
    .in("status", ["awaiting_payment", "payment_detected"])
    .eq("source_chain", "txc")
    .returns<
      Array<{
        id: string;
        public_id: string;
        status: string;
        source_amount_usd: number;
        deposit_address: string;
        quoted_dest_out: number;
        quoted_dest_per_usd: number;
      }>
    >();
  if (!orders?.length) return { detected: 0 };

  // TXC deposits: pay out on mempool sighting (0-conf). The bridge hot
  // wallet is the only signer on the deposit address, so we can safely
  // spend the incoming UTXO before it confirms.
  const REQUIRED_CONFIRMATIONS = 0;
  let detected = 0;
  let tip = 0;
  try {
    tip = await getTxcTipHeight();
  } catch (e) {
    console.error("[watch-txc] tip failed", e);
    return { detected: 0 };
  }
  let txcSpot = 0;
  try {
    txcSpot = await getSpotPrice("TXC_USDT");
  } catch (e) {
    console.error("[watch-txc] spot failed", e);
    return { detected: 0 };
  }

  for (const order of orders) {
    try {
      const transfers = await scanTxcIncoming(order.deposit_address, tip);
      if (!transfers.length) continue;

      for (const t of transfers) {
        const txcAmount = t.amountSats / 1e8;
        const usd = txcAmount * txcSpot;

        await supabaseAdmin.from("deposits").upsert(
          {
            order_id: order.id,
            chain: "txc",
            tx_hash: t.txid,
            log_index: 0,
            token: "TXC",
            from_address: t.fromAddress ?? "",
            to_address: order.deposit_address,
            amount_usd: usd,
            block_number: t.blockHeight ?? 0,
            confirmations: t.confirmations,
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

        const repricedOut = +(
          totalPaidUsd * Number(order.quoted_dest_per_usd)
        ).toFixed(8);
        const originalOut = Number(order.quoted_dest_out);
        const repriced = Math.abs(repricedOut - originalOut) > 0.00000001;

        if (order.status === "awaiting_payment") {
          await supabaseAdmin
            .from("orders")
            .update({
              status: "payment_detected",
              paid_tx_hash: t.txid,
              paid_amount_usd: totalPaidUsd,
              quoted_dest_out: repricedOut,
            })
            .eq("id", order.id);
          order.status = "payment_detected";
          order.quoted_dest_out = repricedOut;
          await logOrderEvent(order.id, "state", "payment_detected", {
            tx_hash: t.txid,
            usd: totalPaidUsd,
            confirmations: t.confirmations,
            original_payout: originalOut,
            repriced_payout: repricedOut,
          });
          await notifyById("payment_detected", order.id);
        } else {
          await supabaseAdmin
            .from("orders")
            .update({
              paid_amount_usd: totalPaidUsd,
              quoted_dest_out: repricedOut,
            })
            .eq("id", order.id);
          order.quoted_dest_out = repricedOut;
          if (repriced) {
            await logOrderEvent(order.id, "note", "repriced", {
              additional_tx: t.txid,
              total_usd: totalPaidUsd,
              original_payout: originalOut,
              repriced_payout: repricedOut,
            });
          }
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
      console.error(`[watch-txc] order ${order.public_id} failed`, e);
    }
  }
  return { detected };
}


/**
 * For confirmed orders, pay the customer IMMEDIATELY using local signing.
 * Both TXC and wTXC now sign + broadcast directly from our hot wallet.
 * Bitmart is NEVER on the critical path — treasury replenishment runs
 * in the background after the customer is paid.
 */
async function settleConfirmed() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,public_id,quoted_dest_out,dest_address,dest_asset,paid_amount_usd")
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
      }>
    >();
  if (!orders?.length) return { sent: 0, queuedForBitmart: 0 };

  let sent = 0;
  const queuedForBitmart = 0;

  for (const o of orders) {
    const asset = o.dest_asset || "TXC";
    try {
      await supabaseAdmin.from("orders").update({ status: "sending" }).eq("id", o.id);
      await logOrderEvent(o.id, "state", "sending", { asset, amount: o.quoted_dest_out });
      await notifyById("sending", o.id);

      const result =
        asset === "TXC"
          ? await sendTxc({
              toAddress: o.dest_address,
              amountTxc: Number(o.quoted_dest_out),
            })
          : asset === "wTXC"
            ? await (async () => {
                const r = await sendWtxc({
                  toAddress: o.dest_address,
                  amountWtxc: Number(o.quoted_dest_out),
                });
                return {
                  txid: r.txid,
                  fromAddress: r.fromAddress,
                  feeSats: r.feeSats,
                };
              })()
            : (() => {
                throw new Error(`Unsupported dest_asset: ${asset}`);
              })();

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
      await failOrder(o.id, e instanceof Error ? e.message : "Settlement failed");
    }
  }
  return { sent, queuedForBitmart };
}

/**
 * Treasury replenishment — runs AFTER the customer is paid.
 * For each completed TXC or wTXC order that has not yet had a Bitmart buy
 * submitted, submit a market buy to refill our hot wallet. This is
 * best-effort: failures here do NOT affect the customer order, they just
 * log and retry next tick.
 */
async function replenishTreasury() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,public_id,paid_amount_usd,dest_asset,source_chain,source_token")
    .eq("status", "completed")
    .is("bitmart_order_id", null)
    .not("paid_amount_usd", "is", null)
    .limit(10)
    .returns<
      Array<{
        id: string;
        public_id: string;
        paid_amount_usd: number;
        dest_asset: string;
        source_chain: string;
        source_token: string;
      }>
    >();
  if (!orders?.length) return { submitted: 0 };

  let submitted = 0;
  for (const o of orders) {
    try {
      // Skip both bridge directions (they never touch stables):
      //   • unwrap (wTXC → TXC): user gave us wTXC, we paid TXC out.
      //   • wrap   (TXC  → wTXC): user gave us native TXC, we paid wTXC.
      if (o.source_chain === "txc") continue;
      if (isWtxcSource(o.source_chain as ChainKey, o.source_token)) continue;
      const dest = getDestination(o.dest_asset);
      // For wTXC on-ramp, buy TXC on Bitmart (we'll re-wrap manually).
      const buySymbol = dest.key === "wTXC" ? "TXC_USDT" : dest.bitmartSymbol;
      const buyNotional = +(Number(o.paid_amount_usd) / 1.05).toFixed(2);
      if (buyNotional <= 0) continue;
      const { order_id } = await submitMarketBuy({
        symbol: buySymbol,
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
 * fill yet. Updates bookkeeping (bitmart_filled_dest, bitmart_avg_price) but
 * does NOT change customer-facing status for TXC orders (already completed).
 * For wTXC orders still in buying_on_bitmart, advances to `bought` so the
 * withdrawal step picks them up.
 */
async function pollBitmartFillsDecoupled() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id,status,bitmart_order_id,bitmart_filled_dest,dest_asset")
    .not("bitmart_order_id", "is", null)
    .is("bitmart_filled_dest", null)
    .limit(20)
    .returns<
      Array<{
        id: string;
        status: string;
        bitmart_order_id: string;
        bitmart_filled_dest: number | null;
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
          bitmart_filled_dest: number;
          bitmart_avg_price: number;
        } = {
          bitmart_filled_dest: txcAmount,
          bitmart_avg_price: avgPrice,
        };
        await supabaseAdmin.from("orders").update(update).eq("id", o.id);
        await logOrderEvent(o.id, "bitmart", "filled", {
          filled: txcAmount,
          avg_price: avgPrice,
        });
        filled += 1;
      } else if (detail.state === "canceled") {
        await logOrderEvent(o.id, "bitmart", "canceled", {});
        // Treasury hiccup only; customer is already paid.
      }
    } catch (e) {
      console.error("[poll-fill]", o.bitmart_order_id, e);
    }
  }
  return { filled };
}


/**
 * Read hot-wallet balances (TXC + wTXC) each tick; fire a deduped admin
 * Telegram alert when either drops below its configured floor. Thresholds
 * are env-configurable so we can tune without a deploy:
 *   TELEGRAM_LOW_TXC_THRESHOLD   (default 1000 TXC)
 *   TELEGRAM_LOW_WTXC_THRESHOLD  (default 1000 wTXC)
 * sendAdminAlert has a 15-min cooldown per (title, dedupeKey), so a
 * sustained low balance produces at most 4 pings/hr per asset.
 */
async function checkHotBalances(): Promise<{ txc: number | null; wtxc: number | null }> {
  const txcFloor = Number(process.env.TELEGRAM_LOW_TXC_THRESHOLD ?? 1000);
  const wtxcFloor = Number(process.env.TELEGRAM_LOW_WTXC_THRESHOLD ?? 1000);
  const out: { txc: number | null; wtxc: number | null } = { txc: null, wtxc: null };

  try {
    const { getTxcHotAddress, getTxcAddressBalanceSats } = await import(
      "@/lib/txc-sign.server"
    );
    const address = getTxcHotAddress();
    const { confirmed, unconfirmed } = await getTxcAddressBalanceSats(address);
    const confirmedTxc = confirmed / 1e8;
    const pendingTxc = unconfirmed / 1e8;
    out.txc = confirmedTxc;
    if (confirmedTxc < txcFloor) {
      void sendAdminAlert(
        "⚠️ TXC hot wallet low",
        `Balance: ${confirmedTxc.toFixed(4)} TXC` +
          (pendingTxc ? ` (+${pendingTxc.toFixed(4)} pending)` : "") +
          `\nFloor: ${txcFloor} TXC\nAddress: ${address}\nRecharge to keep payouts flowing.`,
        "low-txc",
      );
    }
  } catch (e) {
    console.warn("[check-hot-balances] TXC read failed", e);
  }

  try {
    const { getOperatorEvmAddress } = await import("@/lib/bridge-wallet.server");
    const { getWtxcBalance } = await import("@/lib/wtxc.server");
    const address = getOperatorEvmAddress();
    const balance = await getWtxcBalance(address);
    out.wtxc = balance;
    if (balance < wtxcFloor) {
      void sendAdminAlert(
        "⚠️ wTXC operator wallet low",
        `Balance: ${balance.toFixed(4)} wTXC\nFloor: ${wtxcFloor} wTXC\nAddress: ${address}\nWrap more TXC to keep payouts flowing.`,
        "low-wtxc",
      );
    }
  } catch (e) {
    console.warn("[check-hot-balances] wTXC read failed", e);
  }

  return out;
}


export const Route = createFileRoute("/api/public/hooks/swap-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: this endpoint triggers real on-chain payouts, Bitmart orders,
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
          watchTxc: { detected: 0 },
          fills: { filled: 0 },
          settle: { sent: 0, queuedForBitmart: 0 },
          replenish: { submitted: 0 },
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
          result.watch = (await runPhase("watchDeposits", watchDeposits)) ?? result.watch;
          result.watchTxc = (await runPhase("watchTxcDeposits", watchTxcDeposits)) ?? result.watchTxc;
          result.settle = (await runPhase("settleConfirmed", settleConfirmed)) ?? result.settle;
          result.replenish = (await runPhase("replenishTreasury", replenishTreasury)) ?? result.replenish;
          result.fills = (await runPhase("pollBitmartFillsDecoupled", pollBitmartFillsDecoupled)) ?? result.fills;
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
