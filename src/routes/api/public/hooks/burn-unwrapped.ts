// Burn-on-unwrap: destroy the wISK a customer handed back once we've paid
// out their native ISK, so circulating supply always equals the ISK sitting
// in the bridge reserve.
//
// Lifecycle of an unwrap order:
//   1. Customer sends wISK  -> per-order EVM deposit address (HD index N)
//   2. Bridge pays native ISK from the ISK hot wallet   (order -> completed)
//   3. THIS ENDPOINT: sweep the wISK from index N -> operator (index 0),
//      then call burnUnwrapped(amount, iskAddress) so the on-chain
//      `Unwrapped` event records which native address the reserve went to.
//
// Runs in its own Worker invocation (same reasoning as payout-send: each
// EVM broadcast needs a fresh CPU / wall-clock budget) and is fully
// idempotent — every step is guarded by what's already recorded on the order.
// swap-tick's `reconcileBurns` phase drives it and retries safely.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  burnWisk,
  getEthBalance,
  getEvmNonce,
  getWiskBalance,
  sendEthFrom,
  sendWiskFrom,
} from "@/lib/wisk.server";
import { deriveEvmAddress, getOperatorEvmAddress } from "@/lib/bridge-wallet.server";
import { logOrderEvent, sendAdminAlert } from "@/lib/telegram.server";

const Body = z.object({ orderId: z.string().uuid() });

/** Minimum ETH a deposit address needs before it can sweep its wISK out. */
const GAS_FLOOR_ETH = 0.0006;
/** How much ETH we top it up with when it's short. */
const GAS_TOPUP_ETH = 0.0012;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/public/hooks/burn-unwrapped")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
          return json({ ok: false, error: (e as Error).message }, 400);
        }
        const { orderId } = parsed;

        const { data: o } = await supabaseAdmin
          .from("orders")
          .select(
            "id,public_id,status,dest_asset,dest_address,source_token,deposit_index,deposit_address,paid_amount_usd,burn_amount,burn_tx_hash,burn_sweep_tx_hash,burn_attempts",
          )
          .eq("id", orderId)
          .maybeSingle();
        if (!o) return json({ ok: false, error: "not_found" }, 404);

        // Only paid-out unwraps (customer sent wISK, we sent native ISK).
        if (o.status !== "completed" || o.dest_asset !== "ISK" || o.source_token !== "wISK") {
          return json({ ok: true, skipped: `status=${o.status} dest=${o.dest_asset}` });
        }
        if (o.burn_tx_hash) return json({ ok: true, skipped: "already_burned" });

        // Amount to destroy = what actually landed on the deposit address.
        let amount = Number(o.burn_amount ?? 0);
        if (!(amount > 0)) {
          const { data: deps } = await supabaseAdmin
            .from("deposits")
            .select("amount_source")
            .eq("order_id", o.id)
            .eq("token", "wISK");
          amount = (deps ?? []).reduce((s, d) => s + Number(d.amount_source ?? 0), 0);
          if (!(amount > 0)) amount = Number(o.paid_amount_usd ?? 0);
        }
        amount = Math.floor(amount * 1e8) / 1e8;
        if (!(amount > 0)) return json({ ok: true, skipped: "no_amount" });

        const holder = `burn:${o.id}`;
        const { data: gotLock } = await supabaseAdmin.rpc("try_acquire_wallet_lock", {
          _wallet_key: "evm_operator",
          _ttl_seconds: 90,
          _holder: holder,
        });
        if (!gotLock) return json({ ok: true, skipped: "operator_locked" });

        try {
          await supabaseAdmin
            .from("orders")
            .update({
              burn_amount: amount,
              burn_attempts: (o.burn_attempts ?? 0) + 1,
            })
            .eq("id", o.id);

          const operator = getOperatorEvmAddress();
          const operatorBalance = await getWiskBalance(operator);

          // ---- Step 1: make sure the operator actually holds the tokens ----
          if (operatorBalance + 1e-8 < amount) {
            const index = Number(o.deposit_index);
            if (!Number.isInteger(index) || index < 1) {
              return json({ ok: true, skipped: "no_deposit_index" });
            }
            const depositAddress = deriveEvmAddress(index);
            const depositBalance = await getWiskBalance(depositAddress);
            if (depositBalance <= 0) {
              // Nothing here and nothing at the operator: the tokens were
              // swept elsewhere manually. Leave it for a human.
              await logOrderEvent(o.id, "note", "burn_pending_no_tokens", {
                operator_balance: operatorBalance,
                deposit_address: depositAddress,
                need: amount,
              });
              return json({ ok: true, skipped: "tokens_not_found" });
            }

            // Gas the deposit address if it can't pay for its own sweep.
            const { eth } = await getEthBalance(depositAddress);
            if (eth < GAS_FLOOR_ETH) {
              const gas = await sendEthFrom({
                fromIndex: 0,
                toAddress: depositAddress,
                amountEth: GAS_TOPUP_ETH,
              });
              await logOrderEvent(o.id, "note", "burn_gas_funded", {
                to: depositAddress,
                amount_eth: GAS_TOPUP_ETH,
                txid: gas.txid,
              });
            }

            const sweepAmount = Math.floor(depositBalance * 1e8) / 1e8;
            const sweep = await sendWiskFrom({
              fromIndex: index,
              toAddress: operator,
              amountWisk: sweepAmount,
              waitForReceipt: false,
            });
            await supabaseAdmin
              .from("orders")
              .update({ burn_sweep_tx_hash: sweep.txid })
              .eq("id", o.id);
            await logOrderEvent(o.id, "note", "burn_sweep_broadcast", {
              from: depositAddress,
              amount_wisk: sweepAmount,
              txid: sweep.txid,
            });
            // The burn happens on the next pass, once the sweep has mined and
            // the operator balance reflects it.
            return json({ ok: true, swept: sweep.txid, burn: "next_pass" });
          }

          // ---- Step 2: burn ----
          const nonce = await getEvmNonce(operator, "pending");
          const r = await burnWisk({
            amountWisk: amount,
            iskAddress: o.dest_address,
            nonce,
            onSubmitted: async ({ txHash }) => {
              await supabaseAdmin
                .from("orders")
                .update({ burn_tx_hash: txHash })
                .eq("id", o.id);
              await logOrderEvent(o.id, "note", "burn_submitted", {
                tx_hash: txHash,
                amount_wisk: amount,
              });
            },
          });

          await supabaseAdmin
            .from("orders")
            .update({ burn_tx_hash: r.txid, burned_at: new Date().toISOString() })
            .eq("id", o.id);
          await logOrderEvent(o.id, "payout", "burned", {
            txid: r.txid,
            amount_wisk: amount,
            isk_address: o.dest_address,
          });
          return json({ ok: true, burn_tx_hash: r.txid, amount });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "burn failed";
          console.error("[burn-unwrapped]", orderId, msg);
          await logOrderEvent(o.id, "error", "burn_error", { message: msg });
          // Only page a human once it has clearly stopped self-healing.
          if ((o.burn_attempts ?? 0) + 1 >= 5) {
            void sendAdminAlert(
              `wISK burn failing ${o.public_id}`,
              `${amount} wISK still unburned after ${(o.burn_attempts ?? 0) + 1} attempts.\n${msg}`,
              `burn:${o.public_id}`,
            );
          }
          return json({ ok: false, error: msg }, 500);
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
