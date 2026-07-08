// Dedicated single-order wTXC payout endpoint.
//
// Why this exists as its own route:
// Doing `sendWtxc()` inside the main `swap-tick` handler was consistently
// dying mid-broadcast — the isolate would be evicted before `contract.transfer`
// finished its 4-5 sequential Alchemy round-trips (chainId, feeData,
// estimateGas, nonce, sendRawTransaction), so no `broadcast_submitted` event
// ever fired and no error was raised either. Splitting each payout into its
// own Worker invocation gives it a fresh CPU / wall-clock budget.
//
// `settleConfirmed` in swap-tick fires-and-forgets a request here per order.
// This handler is idempotent: it only pays orders currently in `sending`
// state with `dest_tx_hash IS NULL`. The reconciler in swap-tick handles
// any failures / lost broadcasts by rolling back to `confirmed`.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWtxc } from "@/lib/wtxc.server";
import { logOrderEvent, notifyOrderEvent, sendAdminAlert } from "@/lib/telegram.server";

const Body = z.object({ orderId: z.string().uuid() });

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
  if (!data) return;
  await notifyOrderEvent(event, data);
}

export const Route = createFileRoute("/api/public/hooks/payout-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: (e as Error).message }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const { orderId } = parsed;

        // Load + guard: must be in `sending` state, wTXC, and not already broadcast.
        const { data: o } = await supabaseAdmin
          .from("orders")
          .select("id,public_id,status,dest_asset,dest_address,quoted_dest_out,dest_tx_hash")
          .eq("id", orderId)
          .maybeSingle();
        if (!o) {
          return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        if (o.status !== "sending" || o.dest_asset !== "wTXC") {
          return new Response(
            JSON.stringify({ ok: true, skipped: `status=${o.status} asset=${o.dest_asset}` }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (o.dest_tx_hash) {
          // Already broadcast on a prior invocation; the reconciler will finish it.
          return new Response(
            JSON.stringify({ ok: true, skipped: "already_broadcast", tx_hash: o.dest_tx_hash }),
            { headers: { "content-type": "application/json" } },
          );
        }

        try {
          const r = await sendWtxc({
            toAddress: o.dest_address,
            amountWtxc: Number(o.quoted_dest_out),
            onSubmitted: async ({ txHash, nonce }) => {
              await supabaseAdmin
                .from("orders")
                .update({ dest_tx_hash: txHash })
                .eq("id", o.id);
              await logOrderEvent(o.id, "note", "broadcast_submitted", {
                tx_hash: txHash,
                nonce,
              });
            },
          });

          await supabaseAdmin
            .from("orders")
            .update({
              status: "completed",
              dest_tx_hash: r.txid,
              dest_fee_sats: r.feeSats,
              dest_from_address: r.fromAddress,
            })
            .eq("id", o.id);
          await logOrderEvent(o.id, "payout", "sent", {
            txid: r.txid,
            fromAddress: r.fromAddress,
            feeSats: r.feeSats,
            amountWtxc: r.amountWtxc,
          });
          await notifyById("completed", o.id);
          return new Response(
            JSON.stringify({ ok: true, tx_hash: r.txid }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "payout_send failed";
          console.error("[payout-send]", orderId, msg);
          // Do NOT mark failed here — the reconciler decides. If our broadcast
          // actually landed (network partition after sendRawTransaction), the
          // reconciler will find it and complete the order. If it didn't, it
          // will roll back to `confirmed` and retry.
          await logOrderEvent(o.id, "error", "payout_send_error", { message: msg });
          void sendAdminAlert(
            `payout-send error ${o.public_id}`,
            msg,
            `payout-send:${o.public_id}`,
          );
          return new Response(
            JSON.stringify({ ok: false, error: msg }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
