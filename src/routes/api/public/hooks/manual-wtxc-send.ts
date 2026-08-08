// TEMPORARY: one-off make-good payout for a dropped same-nonce broadcast.
// Delete after use.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWtxc, getEvmNonce } from "@/lib/wtxc.server";
import { getOperatorEvmAddress } from "@/lib/bridge-wallet.server";

const Body = z.object({
  orderId: z.string().uuid(),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountWtxc: z.number().positive(),
});

export const Route = createFileRoute("/api/public/hooks/manual-wtxc-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey") ?? "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = Body.parse(await request.json());
        const nonce = await getEvmNonce(getOperatorEvmAddress(), "pending");
        const r = await sendWtxc({
          toAddress: body.toAddress,
          amountWtxc: body.amountWtxc,
          nonce,
        });
        await supabaseAdmin
          .from("orders")
          .update({
            status: "completed",
            dest_tx_hash: r.txid,
            dest_broadcast_nonce: nonce,
            dest_from_address: r.fromAddress,
          })
          .eq("id", body.orderId);
        return Response.json({ ok: true, txid: r.txid, nonce, mined: r.mined });
      },
    },
  },
});
