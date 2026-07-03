// Server-side settings cache. Reads the singleton app_settings row.
// 5-second in-memory cache so high-traffic endpoints (quote) don't hammer the DB.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface AppSettings {
  premium_bps: number;
  expiry_minutes: number;
  min_usd: number;
  max_usd: number;
  paused: boolean;
  paused_reason: string | null;
  notify_min_usd_created: number;
  wrap_fee_bps: number;
  unwrap_fee_bps: number;
  low_txc_threshold: number;
  low_wtxc_threshold: number;
  payouts_frozen: boolean;
  payouts_frozen_reason: string | null;
  telegram_chat_id: string | null;
  updated_at: string;
}

const DEFAULTS: AppSettings = {
  premium_bps: 500,
  expiry_minutes: 15,
  min_usd: 10,
  max_usd: 50_000,
  paused: false,
  paused_reason: null,
  notify_min_usd_created: 0,
  wrap_fee_bps: 0,
  unwrap_fee_bps: 100,
  low_txc_threshold: 10_000,
  low_wtxc_threshold: 10_000,
  payouts_frozen: false,
  payouts_frozen_reason: null,
  telegram_chat_id: null,
  updated_at: new Date(0).toISOString(),
};

let cache: { value: AppSettings; expires: number } | null = null;
const TTL_MS = 5_000;

export async function getSettings(): Promise<AppSettings> {
  const now = Date.now();
  if (cache && cache.expires > now) return cache.value;

  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select(
      "premium_bps,expiry_minutes,min_usd,max_usd,paused,paused_reason,notify_min_usd_created,wrap_fee_bps,unwrap_fee_bps,low_txc_threshold,low_wtxc_threshold,payouts_frozen,payouts_frozen_reason,updated_at",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    console.warn("[settings] falling back to defaults", error?.message);
    cache = { value: DEFAULTS, expires: now + TTL_MS };
    return DEFAULTS;
  }

  const row = data as unknown as {
    premium_bps: number;
    expiry_minutes: number;
    min_usd: number | string;
    max_usd: number | string;
    paused: boolean;
    paused_reason: string | null;
    notify_min_usd_created: number | string;
    wrap_fee_bps?: number | null;
    unwrap_fee_bps?: number | null;
    low_txc_threshold?: number | string | null;
    low_wtxc_threshold?: number | string | null;
    payouts_frozen?: boolean | null;
    payouts_frozen_reason?: string | null;
    updated_at: string;
  };
  const value: AppSettings = {
    premium_bps: row.premium_bps,
    expiry_minutes: row.expiry_minutes,
    min_usd: Number(row.min_usd),
    max_usd: Number(row.max_usd),
    paused: row.paused,
    paused_reason: row.paused_reason,
    notify_min_usd_created: Number(row.notify_min_usd_created),
    wrap_fee_bps: row.wrap_fee_bps ?? 0,
    unwrap_fee_bps: row.unwrap_fee_bps ?? 100,
    low_txc_threshold: row.low_txc_threshold != null ? Number(row.low_txc_threshold) : 10_000,
    low_wtxc_threshold: row.low_wtxc_threshold != null ? Number(row.low_wtxc_threshold) : 10_000,
    payouts_frozen: row.payouts_frozen ?? false,
    payouts_frozen_reason: row.payouts_frozen_reason ?? null,
    updated_at: row.updated_at,
  };
  cache = { value, expires: now + TTL_MS };
  return value;
}

export function invalidateSettingsCache() {
  cache = null;
}
