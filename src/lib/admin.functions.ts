// Admin-only operations: orders, settings, balances, audit, admin management.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getBalances, getSpotPrice, submitMarketBuy } from "./bitmart.server";
import { invalidateChainsCache } from "./chains.server";
import { getOperatorEvmAddress } from "./bridge-wallet.server";
import { getWtxcBalance } from "./wtxc.server";
import { getSettings, invalidateSettingsCache } from "./settings.server";
import { getTxcHotAddress, getTxcAddressBalanceSats } from "./txc-sign.server";
import { scanHdWallet } from "./wallet-scan.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Forbidden: admin role required");
}

async function audit(
  actorUserId: string,
  action: string,
  details: Record<string, unknown>,
  orderId?: string,
) {
  await supabaseAdmin.from("admin_audit").insert({
    actor_user_id: actorUserId,
    action,
    details: details as never,
    order_id: orderId ?? null,
  });
}

// ===== Orders =====
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
        "public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_address,quoted_dest_out,created_at,paid_amount_usd,bitmart_filled_dest,dest_tx_hash,dest_asset,error_message",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows;
  });

// Flexible search across order identifiers, addresses, and tx hashes
// (incl. deposit-side tx hashes/from-addresses joined via deposits table).
export const adminSearchOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const q = data.query.trim();
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const cols =
      "public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_address,quoted_dest_out,created_at,paid_amount_usd,bitmart_filled_dest,dest_tx_hash,dest_asset,error_message";

    // 1) Search columns directly on orders.
    const orFilter = [
      `public_id.ilike.${like}`,
      `deposit_address.ilike.${like}`,
      `dest_address.ilike.${like}`,
      `dest_from_address.ilike.${like}`,
      `dest_tx_hash.ilike.${like}`,
      `paid_tx_hash.ilike.${like}`,
      `bitmart_order_id.ilike.${like}`,
      `withdrawal_id.ilike.${like}`,
      `error_message.ilike.${like}`,
      `source_chain.ilike.${like}`,
      `source_token.ilike.${like}`,
    ].join(",");

    const direct = await supabaseAdmin
      .from("orders")
      .select(cols)
      .or(orFilter)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (direct.error) throw new Error(direct.error.message);

    // 2) Search deposits (tx hash, from address) → resolve order ids.
    const dep = await supabaseAdmin
      .from("deposits")
      .select("order_id")
      .or(`tx_hash.ilike.${like},from_address.ilike.${like},to_address.ilike.${like}`)
      .limit(data.limit);
    if (dep.error) throw new Error(dep.error.message);

    const seen = new Set((direct.data ?? []).map((r) => (r as { public_id: string }).public_id));
    const extraIds = Array.from(
      new Set(
        (dep.data ?? [])
          .map((r) => r.order_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );


    let extras: typeof direct.data = [];
    if (extraIds.length) {
      const ex = await supabaseAdmin
        .from("orders")
        .select(cols)
        .in("id", extraIds)
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (ex.error) throw new Error(ex.error.message);
      extras = (ex.data ?? []).filter(
        (r) => !seen.has((r as { public_id: string }).public_id),
      );
    }

    return [...(direct.data ?? []), ...extras].slice(0, data.limit);
  });




// Full detail for one order (for the expandable admin row)
export const adminOrderDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ publicId: z.string().min(3).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("public_id", data.publicId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");

    const [{ data: deposits }, { data: events }, { data: auditRows }] =
      await Promise.all([
        supabaseAdmin
          .from("deposits")
          .select("*")
          .eq("order_id", order.id)
          .order("detected_at", { ascending: true }),
        supabaseAdmin
          .from("order_events")
          .select("id,kind,event,details,created_at")
          .eq("order_id", order.id)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("admin_audit")
          .select("id,action,details,actor_user_id,created_at")
          .eq("order_id", order.id)
          .order("created_at", { ascending: true }),
      ]);

    // Resolve Bitmart fill detail live if we have an order id and no fill yet
    let bitmartLive:
      | { order_id: string; state: string; filled_size: string; filled_notional: string; price_avg: string }
      | { error: string }
      | null = null;
    if (order.bitmart_order_id && order.bitmart_filled_dest == null) {
      try {
        const { getOrderDetail } = await import("./bitmart.server");
        const d = await getOrderDetail(order.bitmart_order_id);
        bitmartLive = {
          order_id: d.order_id,
          state: d.state,
          filled_size: d.filled_size,
          filled_notional: d.filled_notional,
          price_avg: d.price_avg,
        };
      } catch (e) {
        bitmartLive = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    // Hot wallet balance (TXC + ISK$)
    let hotBalance: {
      address: string;
      confirmedTxc: number;
      unconfirmedTxc: number;
    } | null = null;
    const destAsset = order.dest_asset ?? "TXC";
    if (destAsset === "TXC") {
      try {
        const { getTxcHotAddress, getTxcAddressBalanceSats } = await import(
          "./txc-sign.server"
        );
        const address = getTxcHotAddress();
        const bal = await getTxcAddressBalanceSats(address);
        hotBalance = {
          address,
          confirmedTxc: bal.confirmed / 1e8,
          unconfirmedTxc: bal.unconfirmed / 1e8,
        };
      } catch {
        hotBalance = null;
      }
    } else if (destAsset === "wTXC") {
      try {
        const address = getOperatorEvmAddress();
        const bal = await getWtxcBalance(address);
        hotBalance = {
          address,
          confirmedTxc: bal,
          unconfirmedTxc: 0,
        };
      } catch {
        hotBalance = null;
      }
    }

    return {
      order,
      deposits: deposits ?? [],
      events: events ?? [],
      audit: auditRows ?? [],
      bitmartLive,
      hotBalance,
    };
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

    const next = order.status === "failed" ? "confirmed" : order.status;
    await supabaseAdmin
      .from("orders")
      .update({ status: next, error_message: null })
      .eq("id", order.id);

    await audit(context.userId, "retry", { from: order.status, to: next }, order.id);
    return { ok: true, status: next };
  });

/**
 * Force an order back into the `confirmed` queue so the swap-tick payout
 * loop will (re)try sending the customer their native asset. Works from
 * any non-terminal state — useful when an order is wedged in
 * `buying_on_bitmart` (legacy flow), `payment_detected`, or similar.
 */
export const adminForceComplete = createServerFn({ method: "POST" })
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
    if (order.status === "completed") {
      return { ok: true as const, status: order.status, note: "already completed" };
    }
    await supabaseAdmin
      .from("orders")
      .update({ status: "confirmed", error_message: null })
      .eq("id", order.id);
    await audit(
      context.userId,
      "force_complete",
      { from: order.status, to: "confirmed" },
      order.id,
    );
    return { ok: true as const, status: "confirmed" as const };
  });

/**
 * Mark an order as `failed` with an optional admin reason. Use when an
 * order cannot be settled (bad destination, dust deposit, etc.) and we
 * need to stop the swap-tick from retrying.
 */
export const adminForceFail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        publicId: z.string().min(3).max(40),
        reason: z.string().trim().max(280).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("id,status")
      .eq("public_id", data.publicId)
      .maybeSingle();
    if (error || !order) throw new Error("Order not found");
    const reason = data.reason?.trim() || "Manually failed by admin";
    await supabaseAdmin
      .from("orders")
      .update({ status: "failed", error_message: reason })
      .eq("id", order.id);
    await audit(
      context.userId,
      "force_fail",
      { from: order.status, reason },
      order.id,
    );
    return { ok: true as const, status: "failed" as const };
  });



// ===== Bitmart balances =====
const WATCHED_CURRENCIES = ["TXC", "USDT"] as const;
export const adminBitmartBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    try {
      const wallet = await getBalances();
      const byCurrency = new Map(wallet.map((w) => [w.currency.toUpperCase(), w.available]));
      return {
        ok: true as const,
        items: WATCHED_CURRENCIES.map((currency) => ({
          currency,
          available: byCurrency.get(currency) ?? "0",
        })),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Unknown error" };
    }
  });

// ===== Hot wallet balances (EVM stables + TXC + wTXC) =====
export const adminHotWalletBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);

    const [evmRes, txcRes, wtxcRes] = await Promise.allSettled([
      scanHdWallet({ maxAddresses: 1 }),
      (async () => {
        const address = getTxcHotAddress();
        const { confirmed, unconfirmed } = await getTxcAddressBalanceSats(address);
        return { address, confirmed: confirmed / 1e8, unconfirmed: unconfirmed / 1e8 };
      })(),
      (async () => {
        const address = getOperatorEvmAddress();
        const balance = await getWtxcBalance(address);
        return { address, balance };
      })(),
    ]);

    const evm =
      evmRes.status === "fulfilled"
        ? {
            ok: true as const,
            adminUsd: evmRes.value.addresses.find((a) => a.index === 0)?.totalUsd ?? 0,
            address: evmRes.value.addresses.find((a) => a.index === 0)?.address ?? null,
          }
        : { ok: false as const, error: (evmRes.reason as Error)?.message ?? "scan failed" };

    const txc =
      txcRes.status === "fulfilled"
        ? { ok: true as const, ...txcRes.value }
        : { ok: false as const, error: (txcRes.reason as Error)?.message ?? "rpc failed" };

    const wtxc =
      wtxcRes.status === "fulfilled"
        ? { ok: true as const, ...wtxcRes.value }
        : { ok: false as const, error: (wtxcRes.reason as Error)?.message ?? "rpc failed" };

    return { evm, txc, wtxc };
  });


// ===== Reconciliation =====
// Compare what we *should* hold (USD in − USD spent on Bitmart buybacks)
// against what we *actually* hold (EVM stables + Bitmart USDT), and surface
// any unfilled asset debt (TXC + wTXC) at current spot price.
export const adminReconcile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);

    // 1) Completed orders — money in + assets sold + USDT spent rebuying.
    const { data: rows, error } = await supabaseAdmin
      .from("orders")
      .select(
        "dest_asset,quoted_dest_out,bitmart_filled_dest,bitmart_avg_price,paid_amount_usd,status,bitmart_order_id",
      )
      .eq("status", "completed");
    if (error) throw new Error(error.message);

    let usdIn = 0;
    let usdSpentBuying = 0;
    const byAsset: Record<"TXC" | "wTXC", { sold: number; bought: number; pendingBuys: number }> = {
      TXC: { sold: 0, bought: 0, pendingBuys: 0 },
      wTXC: { sold: 0, bought: 0, pendingBuys: 0 },
    };
    for (const r of rows ?? []) {
      usdIn += Number(r.paid_amount_usd ?? 0);
      const bought = Number(r.bitmart_filled_dest ?? 0);
      const avg = Number(r.bitmart_avg_price ?? 0);
      if (bought > 0 && avg > 0) usdSpentBuying += bought * avg;
      const asset = (r.dest_asset ?? "TXC") as "TXC" | "wTXC";
      if (byAsset[asset]) {
        byAsset[asset].sold += Number(r.quoted_dest_out ?? 0);
        byAsset[asset].bought += bought;
        if (r.bitmart_order_id && r.bitmart_filled_dest == null) byAsset[asset].pendingBuys += 1;
      }
    }

    const expectedStablesUsd = usdIn - usdSpentBuying;

    // 2) Actual stables on hand: admin EVM + Bitmart USDT.  wTXC held in
    // the operator wallet is counted as asset inventory at TXC spot.
    const [evmRes, bitmartRes, txcSpot, wtxcBalRes] = await Promise.allSettled([
      scanHdWallet({ maxAddresses: 1 }),
      getBalances(),
      getSpotPrice("TXC_USDT"),
      getWtxcBalance(getOperatorEvmAddress()),
    ]);

    const evmStablesUsd =
      evmRes.status === "fulfilled"
        ? evmRes.value.addresses.find((a) => a.index === 0)?.totalUsd ?? 0
        : 0;

    let bitmartUsdt = 0;
    let bitmartTxc = 0;
    if (bitmartRes.status === "fulfilled") {
      for (const b of bitmartRes.value) {
        const c = b.currency.toUpperCase();
        const amt = Number(b.available);
        if (c === "USDT") bitmartUsdt += amt;
        else if (c === "TXC") bitmartTxc += amt;
      }
    }

    const txcPrice = txcSpot.status === "fulfilled" ? txcSpot.value : 0;
    const operatorWtxc = wtxcBalRes.status === "fulfilled" ? wtxcBalRes.value : 0;

    const actualStablesUsd = evmStablesUsd + bitmartUsdt;
    const stablesDiff = actualStablesUsd - expectedStablesUsd;

    const txcDebt = Math.max(0, byAsset.TXC.sold - byAsset.TXC.bought);
    const wtxcDebt = Math.max(0, byAsset.wTXC.sold - byAsset.wTXC.bought);
    const txcDebtUsd = txcDebt * txcPrice;
    const wtxcDebtUsd = wtxcDebt * txcPrice;

    // Net position: stables we hold + bitmart TXC inventory + operator wTXC
    // − the still-owed asset debt at current spot.
    const bitmartTxcUsd = bitmartTxc * txcPrice;
    const operatorWtxcUsd = operatorWtxc * txcPrice;
    const netPositionUsd =
      actualStablesUsd + bitmartTxcUsd + operatorWtxcUsd - txcDebtUsd - wtxcDebtUsd;

    return {
      usdIn: +usdIn.toFixed(2),
      usdSpentBuying: +usdSpentBuying.toFixed(2),
      expectedStablesUsd: +expectedStablesUsd.toFixed(2),
      actualStablesUsd: +actualStablesUsd.toFixed(2),
      stablesDiff: +stablesDiff.toFixed(2),
      evmStablesUsd: +evmStablesUsd.toFixed(2),
      bitmartUsdt: +bitmartUsdt.toFixed(2),
      bitmartTxc: +bitmartTxc.toFixed(4),
      operatorWtxc: +operatorWtxc.toFixed(4),
      bitmartTxcUsd: +bitmartTxcUsd.toFixed(2),
      operatorWtxcUsd: +operatorWtxcUsd.toFixed(2),
      txcDebt: +txcDebt.toFixed(4),
      wtxcDebt: +wtxcDebt.toFixed(4),
      txcDebtUsd: +txcDebtUsd.toFixed(2),
      wtxcDebtUsd: +wtxcDebtUsd.toFixed(2),
      txcPrice,
      netPositionUsd: +netPositionUsd.toFixed(2),
      orderCount: rows?.length ?? 0,
      pendingTxcBuys: byAsset.TXC.pendingBuys,
      pendingWtxcBuys: byAsset.wTXC.pendingBuys,
      bitmartError:
        bitmartRes.status === "rejected"
          ? (bitmartRes.reason as Error)?.message ?? "bitmart failed"
          : null,
      evmError:
        evmRes.status === "rejected"
          ? (evmRes.reason as Error)?.message ?? "evm scan failed"
          : null,
    };
  });





// ===== Settings =====
export const adminGetSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return getSettings();
  });

const UpdateSettingsInput = z.object({
  premium_bps: z.number().int().min(0).max(10_000),
  expiry_minutes: z.number().int().min(1).max(720),
  min_usd: z.number().min(0).max(1_000_000),
  max_usd: z.number().min(1).max(10_000_000),
  paused: z.boolean(),
  paused_reason: z.string().trim().max(280).nullable(),
  notify_min_usd_created: z.number().min(0).max(1_000_000),
});

export const adminUpdateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSettingsInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.max_usd <= data.min_usd) {
      throw new Error("max_usd must be greater than min_usd");
    }
    const { error } = await supabaseAdmin
      .from("app_settings")
      .update({ ...data, updated_by: context.userId })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    invalidateSettingsCache();
    await audit(context.userId, "settings_update", data);
    return { ok: true };
  });

// ===== Wallet scan =====
export const adminWalletScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        chains: z
          .array(z.enum(["ethereum", "base", "arbitrum", "polygon", "bsc"]))
          .optional(),
        maxAddresses: z.number().int().min(1).max(500).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    return scanHdWallet({
      chains: data.chains,
      maxAddresses: data.maxAddresses,
    });
  });

// ===== Admin management =====
export const adminListAdmins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: roleRows, error } = await supabaseAdmin
      .from("user_roles")
      .select("id,user_id,created_at")
      .eq("role", "admin");
    if (error) throw new Error(error.message);

    const ids = (roleRows ?? []).map((r) => r.user_id);
    let emailByUser = new Map<string, string>();
    if (ids.length) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: Math.min(200, Math.max(50, ids.length)),
      });
      for (const u of users?.users ?? []) {
        if (ids.includes(u.id)) emailByUser.set(u.id, u.email ?? "");
      }
    }
    return (roleRows ?? []).map((r) => ({
      role_id: r.id,
      user_id: r.user_id,
      email: emailByUser.get(r.user_id) ?? "(unknown)",
      created_at: r.created_at,
      is_self: r.user_id === context.userId,
    }));
  });

export const adminInviteAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().email().max(254) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const email = data.email.trim().toLowerCase();

    // Find existing user (paginate if needed; admins list is small in practice)
    let foundUserId: string | null = null;
    let page = 1;
    while (page <= 10 && !foundUserId) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      const users = list?.users ?? [];
      const match = users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (match) foundUserId = match.id;
      if (users.length < 200) break;
      page++;
    }

    if (!foundUserId) {
      // Create the user (no password — they sign in via magic link)
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
      if (createErr || !created.user) {
        throw new Error("Failed to create user: " + (createErr?.message ?? "unknown"));
      }
      foundUserId = created.user.id;
    }

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: foundUserId, role: "admin" });
    if (roleErr && !/duplicate/i.test(roleErr.message)) {
      throw new Error(roleErr.message);
    }

    await audit(context.userId, "admin_invite", { email, user_id: foundUserId });
    return { ok: true, user_id: foundUserId, email };
  });

export const adminRevokeAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) {
      throw new Error("You can't revoke your own admin role.");
    }
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    await audit(context.userId, "admin_revoke", { user_id: data.userId });
    return { ok: true };
  });

// ===== Audit log =====
export const adminAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("admin_audit")
      .select("id,action,details,order_id,actor_user_id,created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_user_id)));
    const emailByUser = new Map<string, string>();
    if (actorIds.length) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of users?.users ?? []) {
        if (actorIds.includes(u.id)) emailByUser.set(u.id, u.email ?? "");
      }
    }
    return (rows ?? []).map((r) => ({
      ...r,
      actor_email: emailByUser.get(r.actor_user_id) ?? "(unknown)",
    }));
  });

// ===== Telegram test =====
export const adminTelegramTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const lovableKey = process.env.LOVABLE_API_KEY;
    const telegramKey = process.env.TELEGRAM_API_KEY;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!lovableKey || !telegramKey || !chatId) {
      return {
        ok: false as const,
        error: "Missing config — set TELEGRAM_API_KEY (connector) and TELEGRAM_CHAT_ID.",
      };
    }
    try {
      const res = await fetch(`https://connector-gateway.lovable.dev/telegram/sendMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": telegramKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🧪 <b>TXC Runner</b> test ping at ${new Date().toISOString()}`,
          parse_mode: "HTML",
        }),
      });
      const body = await res.text();
      if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      await audit(context.userId, "telegram_test", { chatId });
      return { ok: true as const, chatId };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Unknown" };
    }
  });

// ===== Treasury debt (TXC sold vs TXC re-bought on Bitmart) =====
// Tracks the running gap between TXC we've paid out to customers from the hot
// wallet and TXC we've actually replenished via Bitmart. Small market buys can
// be partially canceled when the unfilled remainder drops under Bitmart's
// min notional (~5 USDT) — those tiny gaps accumulate here so we can square
// up in one bulk buy at our convenience.
export const adminTreasuryDebt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);

    // All TXC orders that went to the customer (completed) — the hot wallet
    // already sent quoted_dest_out; bitmart_filled_dest is what we re-bought.
    const { data: rows, error } = await supabaseAdmin
      .from("orders")
      .select("public_id,quoted_dest_out,bitmart_filled_dest,bitmart_avg_price,paid_amount_usd,created_at,status,bitmart_order_id")
      .eq("dest_asset", "TXC")
      .eq("status", "completed");
    if (error) throw new Error(error.message);

    let txcSold = 0;
    let txcBought = 0;
    let usdtSpent = 0;
    let usdtTakenIn = 0;
    let pendingBuys = 0;
    const shortfalls: Array<{
      public_id: string;
      sold: number;
      bought: number;
      shortfall: number;
      created_at: string;
    }> = [];

    for (const r of rows ?? []) {
      const sold = Number(r.quoted_dest_out ?? 0);
      const bought = Number(r.bitmart_filled_dest ?? 0);
      const avg = Number(r.bitmart_avg_price ?? 0);
      txcSold += sold;
      txcBought += bought;
      if (bought > 0 && avg > 0) usdtSpent += bought * avg;
      usdtTakenIn += Number(r.paid_amount_usd ?? 0);
      if (r.bitmart_order_id && r.bitmart_filled_dest == null) pendingBuys += 1;
      const gap = sold - bought;
      if (gap > 0.0001) {
        shortfalls.push({
          public_id: r.public_id,
          sold,
          bought,
          shortfall: gap,
          created_at: r.created_at,
        });
      }
    }
    shortfalls.sort((a, b) => b.shortfall - a.shortfall);

    const txcDebt = Math.max(0, txcSold - txcBought);
    let spotPrice = 0;
    try {
      spotPrice = await getSpotPrice("TXC_USDT");
    } catch {
      spotPrice = 0;
    }
    const estUsdtToSquareUp = spotPrice > 0 ? +(txcDebt * spotPrice * 1.01).toFixed(2) : 0;

    return {
      txcSold: +txcSold.toFixed(6),
      txcBought: +txcBought.toFixed(6),
      txcDebt: +txcDebt.toFixed(6),
      usdtSpent: +usdtSpent.toFixed(2),
      usdtTakenIn: +usdtTakenIn.toFixed(2),
      orderCount: rows?.length ?? 0,
      pendingBuys,
      spotPrice,
      estUsdtToSquareUp,
      topShortfalls: shortfalls.slice(0, 10),
    };
  });

// Place a standalone Bitmart market buy to clear the treasury debt.
// Not tied to a specific order — pure treasury op, logged in admin_audit.
export const adminBulkReplenish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ notionalUsdt: z.number().min(5).max(5000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    try {
      const { order_id } = await submitMarketBuy({ notionalUsdt: data.notionalUsdt });
      await audit(context.userId, "treasury_bulk_replenish", {
        notionalUsdt: data.notionalUsdt,
        bitmart_order_id: order_id,
      });
      return { ok: true as const, bitmart_order_id: order_id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      await audit(context.userId, "treasury_bulk_replenish_failed", {
        notionalUsdt: data.notionalUsdt,
        error: msg,
      });
      return { ok: false as const, error: msg };
    }
  });

// ===== Custom tokens (admin-managed source asset registry) =====
const CHAIN_ENUM = z.enum(["ethereum", "base", "arbitrum", "polygon", "bsc"]);

const CustomTokenInput = z
  .object({
    chain: CHAIN_ENUM,
    symbol: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Za-z0-9.$_-]+$/, "Symbol may use letters, digits, . $ _ -"),
    address: z.string().trim().max(80).default(""),
    decimals: z.number().int().min(0).max(36),
    isNative: z.boolean().default(false),
    bitmartSymbol: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Z0-9_]+$/i, "Bitmart symbol like ETH_USDT")
      .optional()
      .or(z.literal("")),
    enabled: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.isNative) {
      if (!data.bitmartSymbol) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bitmartSymbol"],
          message: "Native tokens need a Bitmart symbol (e.g. ETH_USDT) for pricing",
        });
      }
    } else {
      if (!/^0x[a-fA-F0-9]{40}$/.test(data.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["address"],
          message: "ERC-20 address must be 0x + 40 hex",
        });
      }
    }
  });

export const adminListCustomTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("custom_tokens")
      .select("id,chain,symbol,address,decimals,is_native,bitmart_symbol,enabled,created_at,updated_at")
      .order("chain", { ascending: true })
      .order("symbol", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminCreateCustomToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CustomTokenInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const row = {
      chain: data.chain,
      symbol: data.symbol,
      address: data.isNative ? "native" : data.address.toLowerCase(),
      decimals: data.decimals,
      is_native: data.isNative,
      bitmart_symbol: data.bitmartSymbol ? data.bitmartSymbol.toUpperCase() : null,
      enabled: data.enabled,
      created_by: context.userId,
    };
    const { data: inserted, error } = await supabaseAdmin
      .from("custom_tokens")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        throw new Error(`A token with symbol ${data.symbol} already exists on ${data.chain}`);
      }
      throw new Error(error.message);
    }
    invalidateChainsCache();
    await audit(context.userId, "custom_token_create", row);
    return { ok: true as const, id: inserted.id };
  });

const UpdateCustomTokenInput = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  decimals: z.number().int().min(0).max(36).optional(),
  bitmartSymbol: z.string().trim().max(40).optional().nullable(),
});

export const adminUpdateCustomToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateCustomTokenInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const patch: {
      enabled?: boolean;
      decimals?: number;
      bitmart_symbol?: string | null;
    } = {};
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.decimals !== undefined) patch.decimals = data.decimals;
    if (data.bitmartSymbol !== undefined) {
      patch.bitmart_symbol = data.bitmartSymbol
        ? data.bitmartSymbol.toUpperCase()
        : null;
    }
    if (Object.keys(patch).length === 0) return { ok: true as const };
    const { error } = await supabaseAdmin
      .from("custom_tokens")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidateChainsCache();
    await audit(context.userId, "custom_token_update", { id: data.id, ...patch });
    return { ok: true as const };
  });

export const adminDeleteCustomToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("custom_tokens")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidateChainsCache();
    await audit(context.userId, "custom_token_delete", { id: data.id });
    return { ok: true as const };
  });
