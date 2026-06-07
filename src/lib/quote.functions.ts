// Public quote endpoint: current Bitmart spot price + configurable premium.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getTxcSpotPrice } from "./bitmart.server";
import { getSettings } from "./settings.server";

const QuoteInput = z.object({
  usdAmount: z.number().positive().max(1_000_000),
});

export const getQuote = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuoteInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const [spot, settings] = await Promise.all([getTxcSpotPrice(), getSettings()]);
      const premiumMultiplier = 1 + settings.premium_bps / 10_000;
      const effectivePrice = spot * premiumMultiplier;
      const txcOut = data.usdAmount / effectivePrice;
      return {
        ok: true as const,
        spotPriceUsd: spot,
        premiumBps: settings.premium_bps,
        effectivePriceUsd: effectivePrice,
        txcPerUsd: 1 / effectivePrice,
        txcOut,
        minUsd: settings.min_usd,
        maxUsd: settings.max_usd,
        paused: settings.paused,
        pausedReason: settings.paused_reason,
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
