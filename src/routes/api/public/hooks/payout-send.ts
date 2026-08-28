// Dedicated single-order wISK payout endpoint.
//
// Why this exists as its own route:
// Doing `sendWisk()` inside the main `swap-tick` handler was consistently
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
import { mintWisk, evmTxExists, getEvmNonce } from "@/lib/wisk.server";
import { getOperatorEvmAddress } from "@/lib/bridge-wallet.server";
import { logOrderEvent, notifyOrderEvent, sendAdminAlert } from "@/lib/telegram.server";

const Body = z.object({ orderId: z.string().uuid() });

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
  await notifyOrderEvent(event, data);
}

export const Route = createFileRoute("/api/public/hooks/payout-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: this endpoint signs and broadcasts real on-chain wISK
        // transfers. Only internal callers (swap-tick / cron) that present the
        // project's publishable key may invoke it.
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("x-cron-key") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

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

        // Load + guard: must be in `sending` state, wISK, and not already broadcast.
        const { data: o } = await supabaseAdmin
          .from("orders")
          .select("id,public_id,status,dest_asset,dest_address,quoted_dest_out,dest_tx_hash,paid_tx_hash")
          .eq("id", orderId)
          .maybeSingle();
        if (!o) {
          return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        if (o.status !== "sending" || o.dest_asset !== "wISK") {
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

        // Cross-isolate nonce lease. `sendWisk`'s in-process serializer only
        // orders payouts inside ONE Worker isolate; each payout-send request
        // gets its own isolate, so two concurrent payouts used to read the same
        // pending nonce and race — the loser silently vanished from the mempool
        // (see TX-D1239CDA). This DB lock makes the whole broadcast exclusive.
        const holder = `payout:${o.id}`;
        const { data: gotLock } = await supabaseAdmin.rpc("try_acquire_wallet_lock", {
          _wallet_key: "evm_operator",
          _ttl_seconds: 90,
          _holder: holder,
        });
        if (!gotLock) {
          return new Response(
            JSON.stringify({ ok: true, skipped: "operator_locked" }),
            { headers: { "content-type": "application/json" } },
          );
        }

        try {
          // Nonce selection must NOT trust the node's pending count alone.
          // Alchemy's `pending` nonce can lag a just-broadcast tx (observed on
          // TX-67A8DFC4 / TX-95FC1AC4: both read pending 77 43s apart, and the
          // second silently replaced the first). Take the max of the node's
          // pending nonce and (highest nonce we've ever recorded + 1).
          const nodeNonce = await getEvmNonce(getOperatorEvmAddress(), "pending");
          const { data: lastNonceRow } = await supabaseAdmin
            .from("orders")
            .select("dest_broadcast_nonce")
            .eq("dest_asset", "wISK")
            .not("dest_tx_hash", "is", null)
            .not("dest_broadcast_nonce", "is", null)
            .order("dest_broadcast_nonce", { ascending: false })
            .limit(1)
            .maybeSingle();
          const dbNext = (lastNonceRow?.dest_broadcast_nonce ?? -1) + 1;
          const useNonce = Math.max(nodeNonce, dbNext);
          await logOrderEvent(o.id, "note", "nonce_selected", {
            node_pending: nodeNonce,
            db_next: dbNext,
            use: useNonce,
          });

          // Mint-on-demand: the operator never holds wISK inventory; each
          // wrap payout creates fresh supply backed 1:1 by the ISK deposit.
          const r = await mintWisk({
            toAddress: o.dest_address,
            amountWisk: Number(o.quoted_dest_out),
            iskTxid: o.paid_tx_hash,
            nonce: useNonce,
            onSubmitted: async ({ txHash, nonce }) => {
              await supabaseAdmin
                .from("orders")
                .update({ dest_tx_hash: txHash, dest_broadcast_nonce: nonce })
                .eq("id", o.id);
              await logOrderEvent(o.id, "note", "broadcast_submitted", {
                tx_hash: txHash,
                nonce,
              });
            },
          });

          // A returned hash is NOT proof of delivery: a same-nonce collision
          // drops our tx and `eth_getTransactionByHash` returns null. Only
          // flip to `completed` once the tx is mined or at least still known
          // to the node; otherwise clear the hash and let the reconciler retry.
          const landed = r.mined === true || (await evmTxExists(r.txid));
          if (!landed) {
            await supabaseAdmin
              .from("orders")
              .update({ status: "confirmed", dest_tx_hash: null })
              .eq("id", o.id);
            await logOrderEvent(o.id, "error", "broadcast_dropped", {
              tx_hash: r.txid,
              reason: "tx not found on chain after broadcast (likely nonce collision)",
            });
            void sendAdminAlert(
              `Payout broadcast dropped ${o.public_id}`,
              `Broadcast returned ${r.txid} but the node does not know that tx. Rolled back to confirmed for retry.`,
              `payout-dropped:${o.public_id}`,
            );
            return new Response(
              JSON.stringify({ ok: false, error: "broadcast_dropped", tx_hash: r.txid }),
              { status: 202, headers: { "content-type": "application/json" } },
            );
          }

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
            amountWisk: r.amountWisk,
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
        } finally {
          await supabaseAdmin.rpc("release_wallet_lock", {
            _wallet_key: "evm_operator",
            _holder: holder,
          });
        }
      },
    },
  },
});
