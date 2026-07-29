// Public quote endpoint: current Bitmart spot price + configurable premium.
// Bridge unwrap (source = wTXC → dest = TXC) applies a fixed fee instead
// of the Bitmart premium; that quote is computed at order-creation time
// inside orders.functions.ts. This endpoint stays a simple USD→dest quote
// used by the live rate display on the swap form.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSpotPrice } from "./bitmart.server";
import { DEST_ASSETS, getDestination, type DestAsset } from "./destinations";
import { getSettings } from "./settings.server";

const QuoteInput = z.object({
  usdAmount: z.number().positive().max(1_000_000),
  destAsset: z.enum(DEST_ASSETS as [DestAsset, ...DestAsset[]]).default("TXC"),
});

export const getQuote = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuoteInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const dest = getDestination(data.destAsset);
      const [spot, settings] = await Promise.all([
        // Price is informational only — this is a 1:1 bridge. Never let a
        // broken exchange ticker block quoting.
        getSpotPrice(dest.bitmartSymbol).catch((e) => {
          console.warn("getQuote: spot price unavailable", e);
          return null as number | null;
        }),
        getSettings(),
      ]);
      const premiumMultiplier = 1 + settings.premium_bps / 10_000;
      const effectivePrice = spot !== null ? spot * premiumMultiplier : null;
      const assetOut = effectivePrice ? data.usdAmount / effectivePrice : null;
      return {
        ok: true as const,
        destAsset: dest.key,
        spotPriceUsd: spot,
        premiumBps: settings.premium_bps,
        effectivePriceUsd: effectivePrice,
        assetPerUsd: effectivePrice ? 1 / effectivePrice : null,
        assetOut,
        minUsd: settings.min_usd,
        maxUsd: settings.max_usd,
        paused: settings.paused,
        pausedReason: settings.paused_reason,
        wrapFeeBps: settings.wrap_fee_bps,
        unwrapFeeBps: settings.unwrap_fee_bps,
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      console.error("getQuote failed", e);
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Quote unavailable",
      };
    }
  });

