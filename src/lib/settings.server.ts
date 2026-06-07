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
      "premium_bps,expiry_minutes,min_usd,max_usd,paused,paused_reason,notify_min_usd_created,updated_at",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    console.warn("[settings] falling back to defaults", error?.message);
    cache = { value: DEFAULTS, expires: now + TTL_MS };
    return DEFAULTS;
  }

  const value: AppSettings = {
    premium_bps: data.premium_bps,
    expiry_minutes: data.expiry_minutes,
    min_usd: Number(data.min_usd),
    max_usd: Number(data.max_usd),
    paused: data.paused,
    paused_reason: data.paused_reason,
    notify_min_usd_created: Number(data.notify_min_usd_created),
    updated_at: data.updated_at,
  };
  cache = { value, expires: now + TTL_MS };
  return value;
}

export function invalidateSettingsCache() {
  cache = null;
}
