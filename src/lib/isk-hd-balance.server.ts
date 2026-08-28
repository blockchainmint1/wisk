// SERVER-ONLY: total ISK held across the whole HD wallet (hot address at
// index 0 + every per-order deposit address we've ever handed out).
// Used by the admin console and by the low-balance alert guard so we don't
// page the admin when funds are merely sitting at derived deposit addresses.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deriveIskAddress } from "./bridge-wallet.server";
import { getIskAddressBalanceSats } from "./isk-sign.server";

export interface IskHdTotals {
  hotAddress: string;
  hotConfirmed: number;
  derivedConfirmed: number;
  derivedScanned: number;
  totalConfirmed: number;
}

/** Collect every ISK address in the HD wallet (excluding the hot address). */
export async function listIskDerivedAddresses(hotAddress: string): Promise<string[]> {
  const addresses = new Set<string>();
  const { data: counter } = await supabaseAdmin
    .from("hd_address_counter")
    .select("next_index")
    .eq("id", 1)
    .maybeSingle();
  const next = Number(counter?.next_index ?? 1);
  for (let i = 1; i < next; i++) addresses.add(deriveIskAddress(i));

  // The counter has been reset before, so it is NOT a high-water mark: also
  // include every ISK deposit address ever recorded on an order.
  const { data: rows } = await supabaseAdmin
    .from("orders")
    .select("deposit_address")
    .like("deposit_address", "T%")
    .limit(5000);
  for (const r of rows ?? []) {
    const a = (r as { deposit_address: string | null }).deposit_address;
    if (a) addresses.add(a);
  }
  addresses.delete(hotAddress);
  return [...addresses].slice(0, 600);
}

/**
 * Sum confirmed ISK across the HD wallet. Best-effort: unreachable addresses
 * are skipped rather than failing the whole read.
 */
export async function getIskHdTotal(hotAddress: string): Promise<IskHdTotals> {
  const { confirmed } = await getIskAddressBalanceSats(hotAddress);
  let derivedConfirmed = 0;
  let derivedScanned = 0;

  try {
    const list = await listIskDerivedAddresses(hotAddress);
    for (let i = 0; i < list.length; i += 10) {
      const batch = list.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map((addr) => getIskAddressBalanceSats(addr)),
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        derivedScanned++;
        derivedConfirmed += r.value.confirmed;
      }
    }
  } catch {
    // best-effort
  }

  return {
    hotAddress,
    hotConfirmed: confirmed / 1e8,
    derivedConfirmed: derivedConfirmed / 1e8,
    derivedScanned,
    totalConfirmed: (confirmed + derivedConfirmed) / 1e8,
  };
}
