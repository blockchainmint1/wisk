// Admin-only operations: list orders, view balances, retry/refund actions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getBalances } from "./bitmart.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

export const adminListOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("orders")
      .select(
        "public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_txc_address,quoted_txc_out,created_at,paid_amount_usd,bitmart_filled_txc,txc_tx_hash,error_message",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows;
  });

export const adminBitmartBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    try {
      const wallet = await getBalances();
      return {
        ok: true as const,
        items: wallet
          .filter((w) => Number.parseFloat(w.available) > 0)
          .map((w) => ({ currency: w.currency, available: w.available })),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Unknown error" };
    }
  });

export const adminRetryOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ publicId: z.string().min(3).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id,status")
      .eq("public_id", data.publicId)
      .maybeSingle();
    if (error || !order) throw new Error("Order not found");

    // Drop back to the previous unblocked state
    let next: string = order.status;
    if (order.status === "failed") next = "confirmed";

    await supabaseAdmin
      .from("orders")
      .update({ status: next, error_message: null })
      .eq("id", order.id);

    await supabaseAdmin.from("admin_audit").insert({
      actor_user_id: context.userId,
      action: "retry",
      order_id: order.id,
      details: { from: order.status, to: next },
    });
    return { ok: true, status: next };
  });
