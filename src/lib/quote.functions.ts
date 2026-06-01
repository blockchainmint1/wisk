// Public quote endpoint: current Bitmart spot price + 5% premium.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getTxcSpotPrice } from "./bitmart.server";
import { PREMIUM_BPS } from "./chains";

const QuoteInput = z.object({
  usdAmount: z.number().positive().max(1_000_000),
});

export const getQuote = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuoteInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const spot = await getTxcSpotPrice();
      const premiumMultiplier = 1 + PREMIUM_BPS / 10_000;
      const effectivePrice = spot * premiumMultiplier;
      const txcOut = data.usdAmount / effectivePrice;
      return {
        ok: true as const,
        spotPriceUsd: spot,
        premiumBps: PREMIUM_BPS,
        effectivePriceUsd: effectivePrice,
        txcPerUsd: 1 / effectivePrice,
        txcOut,
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
