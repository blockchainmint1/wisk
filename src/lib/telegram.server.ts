// Telegram notification helper. Server-only.
// Uses the Lovable connector gateway — no raw bot token needed.
// Sends to a single admin chat/channel configured via TELEGRAM_CHAT_ID secret.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export type OrderNotifyEvent =
  | "created"
  | "payment_detected"
  | "payment_confirmed"
  | "bitmart_filled"
  | "completed"
  | "failed"
  | "expired";

interface OrderSummary {
  public_id: string;
  source_chain?: string | null;
  source_token?: string | null;
  source_amount_usd?: number | null;
  paid_amount_usd?: number | null;
  dest_txc_address?: string | null;
  quoted_txc_out?: number | null;
  bitmart_filled_txc?: number | null;
  bitmart_avg_price?: number | null;
  paid_tx_hash?: string | null;
  txc_tx_hash?: string | null;
  error_message?: string | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtTxc(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })} TXC`;
}

function header(event: OrderNotifyEvent): string {
  switch (event) {
    case "created":
      return "🆕 New order";
    case "payment_detected":
      return "👀 Deposit detected";
    case "payment_confirmed":
      return "✅ Deposit confirmed";
    case "bitmart_filled":
      return "💱 Bitmart buy filled";
    case "completed":
      return "🎉 Order completed";
    case "failed":
      return "❌ Order failed";
    case "expired":
      return "⌛ Order expired";
  }
}

function buildMessage(event: OrderNotifyEvent, o: OrderSummary): string {
  const lines: string[] = [];
  lines.push(`<b>${header(event)}</b>`);
  lines.push(`<code>${escapeHtml(o.public_id)}</code>`);
  if (o.source_chain || o.source_token) {
    lines.push(
      `Pay: ${escapeHtml(o.source_token ?? "?")} on ${escapeHtml(o.source_chain ?? "?")}`,
    );
  }
  if (event === "created") {
    lines.push(`Quote: ${fmtUsd(o.source_amount_usd)} → ${fmtTxc(o.quoted_txc_out)}`);
  }
  if (event === "payment_detected" || event === "payment_confirmed") {
    lines.push(`Received: ${fmtUsd(o.paid_amount_usd)}`);
    if (o.paid_tx_hash) lines.push(`Tx: <code>${escapeHtml(o.paid_tx_hash)}</code>`);
  }
  if (event === "bitmart_filled") {
    lines.push(
      `Filled: ${fmtTxc(o.bitmart_filled_txc)} @ ${
        o.bitmart_avg_price != null ? fmtUsd(o.bitmart_avg_price) : "—"
      }`,
    );
  }
  if (event === "completed") {
    lines.push(`Sent: ${fmtTxc(o.bitmart_filled_txc)} → <code>${escapeHtml(o.dest_txc_address)}</code>`);
    if (o.txc_tx_hash) lines.push(`TXC tx: <code>${escapeHtml(o.txc_tx_hash)}</code>`);
  }
  if (event === "failed" || event === "expired") {
    if (o.error_message) lines.push(`Reason: ${escapeHtml(o.error_message)}`);
  }
  return lines.join("\n");
}

export async function notifyOrderEvent(
  event: OrderNotifyEvent,
  order: OrderSummary,
): Promise<void> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const telegramKey = process.env.TELEGRAM_API_KEY;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // Notifications are best-effort. Missing config = silently skip so the
  // fulfillment pipeline never breaks because of Telegram.
  if (!lovableKey || !telegramKey || !chatId) {
    console.warn("[telegram] skipping notify; missing config", {
      hasLovableKey: !!lovableKey,
      hasTelegramKey: !!telegramKey,
      hasChatId: !!chatId,
    });
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
        text: buildMessage(event, order),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[telegram] sendMessage ${res.status}: ${body}`);
    }
  } catch (err) {
    console.error("[telegram] notify failed", err);
  }
}
