// Minimal Bitmart REST client (server-only).
// Docs: https://developer-pro.bitmart.com/
import { createHmac } from "crypto";

const BASE = "https://api-cloud.bitmart.com";

// Default destination symbol/network — kept for back-compat with any caller
// that still uses ISK implicitly. Prefer passing symbol/network explicitly.
export const ISK_SYMBOL = "ISK_USDT";
export const ISK_NETWORK = "ISK";

function creds() {
  const key = process.env.BITMART_API_KEY?.trim();
  const secret = process.env.BITMART_API_SECRET?.trim();
  const memo = process.env.BITMART_API_MEMO?.trim();
  if (!key || !secret || !memo) throw new Error("Bitmart credentials are not configured");
  return { key, secret, memo };
}

function sign(timestamp: string, body: string): string {
  const { secret, memo } = creds();
  const payload = `${timestamp}#${memo}#${body || ""}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

async function signedRequest<T = unknown>(opts: {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}): Promise<T> {
  const { key } = creds();
  const ts = Date.now().toString();
  const bodyStr = opts.body ? JSON.stringify(opts.body) : "";
  const signature = sign(ts, bodyStr);
  const res = await fetch(`${BASE}${opts.path}`, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      "X-BM-KEY": key,
      "X-BM-TIMESTAMP": ts,
      "X-BM-SIGN": signature,
    },
    body: opts.method === "POST" ? bodyStr : undefined,
  });
  const text = await res.text();
  let json: { code?: number; message?: string; data?: T } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* keep text */
  }
  if (!res.ok || (typeof json.code === "number" && json.code !== 1000)) {
    throw new Error(
      `Bitmart ${opts.path} failed: HTTP ${res.status} ${json.message ?? text.slice(0, 200)}`,
    );
  }
  return json.data as T;
}

// ===== Public: spot ticker =====
export async function getSpotPrice(symbol: string = ISK_SYMBOL): Promise<number> {
  // v3 ticker endpoint: GET /spot/quotation/v3/ticker?symbol=XXX_USDT
  const res = await fetch(
    `${BASE}/spot/quotation/v3/ticker?symbol=${encodeURIComponent(symbol)}`,
    { headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok) throw new Error(`Bitmart ticker HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number;
    message?: string;
    data?: { symbol: string; last: string };
  };
  if (json.code !== 1000 || !json.data) {
    throw new Error(`Bitmart ticker error: ${json.message ?? "unknown"}`);
  }
  const last = Number.parseFloat(json.data.last);
  if (!Number.isFinite(last) || last <= 0) throw new Error("Bitmart returned invalid price");
  return last;
}

// Back-compat alias.
export const getIskSpotPrice = () => getSpotPrice(ISK_SYMBOL);

// ===== Trading =====
export async function submitMarketBuy(opts: {
  symbol?: string;
  notionalUsdt: number;
}): Promise<{ order_id: string }> {
  // notional = USDT amount to spend on market buy
  return signedRequest<{ order_id: string }>({
    method: "POST",
    path: "/spot/v2/submit_order",
    body: {
      symbol: opts.symbol ?? ISK_SYMBOL,
      side: "buy",
      type: "market",
      notional: opts.notionalUsdt.toFixed(2),
    },
  });
}

export interface OrderDetail {
  order_id: string;
  state: string; // 'new' | 'partially_filled' | 'filled' | 'canceled'
  filled_size: string;
  filled_notional: string;
  price_avg: string;
}

// v4 query order endpoint (v2 is deprecated as of 2024). Body uses camelCase.
// Response fields are camelCase too — we normalize to our snake_case shape.
type V4OrderResp = {
  orderId: string;
  state: string;
  filledSize?: string;
  filledNotional?: string;
  priceAvg?: string;
};

export async function getOrderDetail(orderId: string): Promise<OrderDetail> {
  const data = await signedRequest<V4OrderResp>({
    method: "POST",
    path: `/spot/v4/query/order`,
    body: { orderId, queryState: "history" },
  });
  return {
    order_id: data.orderId,
    state: data.state,
    filled_size: data.filledSize ?? "0",
    filled_notional: data.filledNotional ?? "0",
    price_avg: data.priceAvg ?? "0",
  };
}

// ===== Withdrawal =====
export async function submitWithdrawal(opts: {
  currency?: string;
  network?: string;
  amount: number;
  address: string;
}): Promise<{ withdraw_id: string }> {
  return signedRequest<{ withdraw_id: string }>({
    method: "POST",
    path: "/account/v1/withdraw/apply",
    body: {
      currency: opts.currency ?? "ISK",
      amount: opts.amount.toFixed(8),
      destination: "To Digital Address",
      address: opts.address,
      address_memo: "",
      chain: opts.network ?? ISK_NETWORK,
    },
  });
}

export interface WithdrawDetail {
  withdraw_id: string;
  status: number; // 0=created,1=submitted,2=processing,3=done,4=cancel,5=fail
  tx_id?: string;
}

export async function getWithdrawDetail(withdrawId: string): Promise<WithdrawDetail> {
  return signedRequest<WithdrawDetail>({
    method: "GET",
    path: `/account/v1/withdraw/detail?withdraw_id=${withdrawId}`,
  });
}

export async function getBalances(): Promise<Array<{ currency: string; available: string }>> {
  const data = await signedRequest<{ wallet: Array<{ currency: string; available: string }> }>({
    method: "GET",
    path: "/account/v1/wallet",
  });
  return data.wallet ?? [];
}
