// TEMPORARY admin-only endpoint: re-send a dropped wTXC payout and record the
// confirmed tx hash on the order. Delete after use.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWtxc, evmTxExists } from "@/lib/wtxc.server";
import { logOrderEvent } from "@/lib/telegram.server";

const Body = z.object({
  publicId: z.string(),
  toAddress: z.string(),
  amountWtxc: z.number().positive(),
});

export const Route = createFileRoute("/api/public/hooks/manual-wtxc-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const { data: o } = await supabaseAdmin
          .from("orders")
          .select("id,public_id,dest_address,quoted_dest_out")
          .eq("public_id", body.publicId)
          .maybeSingle();
        if (!o) {
          return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }

        const r = await sendWtxc({ toAddress: body.toAddress, amountWtxc: body.amountWtxc });
        const landed = r.mined === true || (await evmTxExists(r.txid));
        if (landed) {
          await supabaseAdmin
            .from("orders")
            .update({
              status: "completed",
              dest_tx_hash: r.txid,
              dest_fee_sats: r.feeSats,
              dest_from_address: r.fromAddress,
              error_message: null,
            })
            .eq("id", o.id);
          await logOrderEvent(o.id, "payout", "manual_resend", {
            tx_hash: r.txid,
            amountWtxc: r.amountWtxc,
            to: body.toAddress,
          });
        }
        return new Response(JSON.stringify({ ok: true, landed, tx_hash: r.txid }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
