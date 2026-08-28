// Telegram notification helper. Server-only.
// Uses the Lovable connector gateway — no raw bot token needed.
// Also logs every notify into the order_events table so the admin
// detail panel has a full timeline per order.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSettings } from "./settings.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function getTelegramChatId(): Promise<string | undefined> {
  try {
    const s = await getSettings();
    const v = s.telegram_chat_id?.trim();
    if (v) return v;
  } catch {
    /* fall through to env */
  }
  return process.env.TELEGRAM_CHAT_ID;
}

export type OrderNotifyEvent =
  | "created"
  | "payment_detected"
  | "payment_confirmed"
  | "sending"
  | "completed"
  | "failed"
  | "expired"
  | "stuck";

interface OrderSummary {
  id?: string | null;
  public_id: string;
  source_chain?: string | null;
  source_token?: string | null;
  source_amount_usd?: number | null;
  paid_amount_usd?: number | null;
  paid_amount_source?: number | null;
  dest_asset?: string | null;
  dest_address?: string | null;
  quoted_dest_out?: number | null;
  paid_tx_hash?: string | null;
  dest_tx_hash?: string | null;
  dest_fee_sats?: number | null;
  dest_from_address?: string | null;
  error_message?: string | null;
}

interface HotBalanceInfo {
  asset: string; // 'ISK' | 'ISK$'
  address: string;
  confirmedIsk: number;
  unconfirmedIsk: number;
  low: boolean; // flagged if balance < 2× expected payout
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}




function fmtAsset(n: number | null | undefined, asset: string): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${asset}`;
}

function header(event: OrderNotifyEvent): string {
  switch (event) {
    case "created": return "🆕 New order";
    case "payment_detected": return "👀 Deposit detected";
    case "payment_confirmed": return "✅ Deposit confirmed";
    case "sending": return "📤 Sending payout";
    case "completed": return "🎉 Order completed";
    case "failed": return "❌ Order failed";
    case "expired": return "⌛ Order expired";
    case "stuck": return "🚨 Order stuck";
  }
}

function buildMessage(
  event: OrderNotifyEvent,
  o: OrderSummary,
  balance: HotBalanceInfo | null,
): string {
  const asset = o.dest_asset || "ISK";
  const lines: string[] = [];
  lines.push(`<b>wISK Wrap</b>`);
  lines.push(`${header(event)}`);
  lines.push(`<code>${escapeHtml(o.public_id)}</code> · ${escapeHtml(asset)}`);
  if (o.source_chain || o.source_token) {
    lines.push(`Pay: ${escapeHtml(o.source_token ?? "?")} on ${escapeHtml(o.source_chain ?? "?")}`);
  }
  const srcToken = o.source_token ?? "";

  if (event === "created") {
    lines.push(`Quote: ${fmtAsset(o.quoted_dest_out, asset)}`);
  }
  if (event === "payment_detected" || event === "payment_confirmed") {
    // Always show the actual on-chain source amount in its native token
    // (e.g. wISK on unwrap). Never derive from USD — that math is bogus
    const received = o.paid_amount_source ?? null;
    if (received != null && srcToken) {
      lines.push(`Received: ${fmtAsset(received, srcToken)}`);
    }
    if (o.paid_tx_hash) lines.push(`Tx: <code>${escapeHtml(o.paid_tx_hash)}</code>`);
  }
  if (event === "sending") {
    lines.push(`Sending: ${fmtAsset(o.quoted_dest_out, asset)}`);
    lines.push(`To: <code>${escapeHtml(o.dest_address)}</code>`);
  }
  if (event === "completed") {
    lines.push(`Sent: ${fmtAsset(o.quoted_dest_out, asset)} → <code>${escapeHtml(o.dest_address)}</code>`);
    if (o.dest_tx_hash) lines.push(`Tx: <code>${escapeHtml(o.dest_tx_hash)}</code>`);
    if (o.dest_fee_sats != null) {
      lines.push(`Fee: ${(o.dest_fee_sats / 1e8).toFixed(8)} ${asset}`);
    }
  }
  if (event === "failed" || event === "expired") {
    if (o.error_message) lines.push(`Reason: ${escapeHtml(o.error_message)}`);
  }

  if (balance) {
    const flag = balance.low ? " ⚠️ LOW" : "";
    lines.push(
      `Hot ${escapeHtml(balance.asset)}: ${balance.confirmedIsk.toFixed(4)}${
        balance.unconfirmedIsk ? ` (+${balance.unconfirmedIsk.toFixed(4)} pending)` : ""
      }${flag}`,
    );
  }

  return lines.join("\n");
}

async function recordEvent(
  orderId: string | null | undefined,
  kind: string,
  event: string,
  details: Record<string, unknown>,
) {
  if (!orderId) return;
  try {
    await supabaseAdmin.from("order_events").insert({
      order_id: orderId,
      kind,
      event,
      details: details as never,
    });
  } catch (err) {
    console.error("[order_events] insert failed", err);
  }
}

async function getHotBalance(
  order: OrderSummary,
): Promise<HotBalanceInfo | null> {
  const asset = order.dest_asset ?? "ISK";
  try {
    if (asset === "ISK") {
      const { getIskHotAddress, getIskAddressBalanceSats } = await import(
        "./isk-sign.server"
      );
      const address = getIskHotAddress();
      const { confirmed, unconfirmed } = await getIskAddressBalanceSats(address);
      const confirmedIsk = confirmed / 1e8;
      const unconfirmedIsk = unconfirmed / 1e8;
      const expectedPayout = Number(
        order.quoted_dest_out ?? 0,
      );
      const low = expectedPayout > 0 && confirmedIsk < expectedPayout * 2;
      return { asset: "ISK", address, confirmedIsk, unconfirmedIsk, low };
    }
    if (asset === "wISK") {
      const { getOperatorEvmAddress } = await import("./bridge-wallet.server");
      const { getWiskBalance } = await import("./wisk.server");
      const address = getOperatorEvmAddress();
      const balance = await getWiskBalance(address);
      const expectedPayout = Number(order.quoted_dest_out ?? 0);
      const low = expectedPayout > 0 && balance < expectedPayout * 2;
      return { asset: "wISK", address, confirmedIsk: balance, unconfirmedIsk: 0, low };
    }
    return null;
  } catch (err) {
    console.warn("[hot-balance] read failed", err);
    return null;
  }
}

// Events we intentionally don't push to Telegram — they still land in
// order_events for the admin timeline. Trims a happy-path swap from 4
// pings down to 2 (confirmed + completed) so the group stays useful.
const SILENT_EVENTS = new Set<OrderNotifyEvent>(["payment_detected", "sending"]);

export async function notifyOrderEvent(
  event: OrderNotifyEvent,
  order: OrderSummary,
): Promise<void> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const telegramKey = process.env.TELEGRAM_API_KEY;
  const chatId = await getTelegramChatId();

  const isSilent = SILENT_EVENTS.has(event);
  const balance = isSilent ? null : await getHotBalance(order);

  // Always record in order_events even when we're skipping the push.
  await recordEvent(order.id, "telegram", event, {
    sent: !isSilent && !!(lovableKey && telegramKey && chatId),
    silenced: isSilent || undefined,
    balance,
  });

  if (isSilent) return;
  if (!lovableKey || !telegramKey || !chatId) {
    console.warn("[telegram] skipping notify; missing config");
    return;
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": telegramKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildMessage(event, order, balance),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[telegram] sendMessage ${res.status}: ${body}`);
      await recordEvent(order.id, "error", "telegram_failed", {
        status: res.status,
        body: body.slice(0, 500),
      });
    }
  } catch (err) {
    console.error("[telegram] notify failed", err);
    await recordEvent(order.id, "error", "telegram_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Record an arbitrary order event (state transition, payout, note). */
export async function logOrderEvent(
  orderId: string,
  kind: "state" | "payout" | "error" | "note",
  event: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await recordEvent(orderId, kind, event, details);
}

// In-memory dedupe so we don't spam Telegram if the same fatal error happens
// every cron tick. Re-alert after 15 minutes per unique title+key.
const adminAlertCooldown = new Map<string, number>();
const ADMIN_ALERT_COOLDOWN_MS = 15 * 60_000;

/**
 * Free-form admin alert (not tied to an order). Use for tick crashes,
 * RPC outages, or other infrastructure problems. Auto-deduped for 15 min
 * per (title, dedupeKey) pair.
 */
export async function sendAdminAlert(
  title: string,
  message: string,
  dedupeKey?: string,
): Promise<void> {
  const key = `${title}::${dedupeKey ?? message.slice(0, 120)}`;
  const last = adminAlertCooldown.get(key) ?? 0;
  const now = Date.now();
  if (now - last < ADMIN_ALERT_COOLDOWN_MS) return;
  adminAlertCooldown.set(key, now);

  const lovableKey = process.env.LOVABLE_API_KEY;
  const telegramKey = process.env.TELEGRAM_API_KEY;
  const chatId = await getTelegramChatId();
  if (!lovableKey || !telegramKey || !chatId) {
    console.warn("[telegram] admin alert skipped; missing config:", title);
    return;
  }

  const body = [`<b>🛑 ${escapeHtml(title)}</b>`, `<pre>${escapeHtml(message)}</pre>`].join("\n");
  try {
    const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": telegramKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error(`[telegram] admin alert ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("[telegram] admin alert failed", err);
  }
}
