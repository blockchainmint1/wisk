import { createServerFn } from "@tanstack/react-start";
import { getSettings } from "./settings.server";

// Public read of fee-related settings for the marketing homepage.
// Returns only fee bps values — no admin-only fields.
export const getPublicFees = createServerFn({ method: "GET" }).handler(async () => {
  const s = await getSettings();
  return {
    wrap_fee_bps: s.wrap_fee_bps,
    unwrap_fee_bps: s.unwrap_fee_bps,
  };
});
