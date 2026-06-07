// Admin-only operations: orders, settings, balances, audit, admin management.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getBalances } from "./bitmart.server";
import { getSettings, invalidateSettingsCache } from "./settings.server";
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
        "public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_txc_address,quoted_txc_out,created_at,paid_amount_usd,bitmart_filled_txc,txc_tx_hash,error_message",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows;
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
    let bitmartLive: Record<string, unknown> | null = null;
    if (order.bitmart_order_id && order.bitmart_filled_txc == null) {
      try {
        const { getOrderDetail } = await import("./bitmart.server");
        bitmartLive = (await getOrderDetail(order.bitmart_order_id)) as unknown as Record<string, unknown>;
      } catch (e) {
        bitmartLive = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    // Hot wallet balance (TXC only)
    let hotBalance: {
      address: string;
      confirmedTxc: number;
      unconfirmedTxc: number;
    } | null = null;
    if ((order.dest_asset ?? "TXC") === "TXC") {
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

// ===== Bitmart balances =====
const WATCHED_CURRENCIES = ["TXC", "ISK$", "USDT"] as const;
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
