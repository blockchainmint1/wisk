// Public quote endpoint: pure 1:1 wrap/unwrap bridge quote.
// No USD pricing, no exchange dependency — ISK and wISK are always 1:1
// minus the configured wrap/unwrap fee.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEST_ASSETS, getDestination, type DestAsset } from "./destinations";
import { getSettings } from "./settings.server";

const QuoteInput = z.object({
  destAsset: z.enum(DEST_ASSETS as [DestAsset, ...DestAsset[]]).default("ISK"),
});

export const getQuote = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuoteInput.parse(input ?? {}))
  .handler(async ({ data }) => {
    try {
      const dest = getDestination(data.destAsset);
      const settings = await getSettings();
      return {
        ok: true as const,
        destAsset: dest.key,
        wrapFeeBps: settings.wrap_fee_bps,
        unwrapFeeBps: settings.unwrap_fee_bps,
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
