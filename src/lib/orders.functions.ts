// Order lifecycle server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSpotPrice } from "./bitmart.server";
import { CHAINS, getChain, getToken, type ChainKey } from "./chains";
import { DEST_ASSETS, getDestination, type DestAsset } from "./destinations";
import { deriveDepositAddress } from "./hd.server";
import { getSettings } from "./settings.server";
import { notifyOrderEvent } from "./telegram.server";

const CreateInput = z
  .object({
    sourceChain: z.enum(["ethereum", "base", "arbitrum", "polygon", "bsc"]),
    sourceToken: z.enum(["USDC", "USDT", "DAI"]),
    usdAmount: z.number().positive().max(1_000_000),
    destAsset: z
      .enum(DEST_ASSETS as [DestAsset, ...DestAsset[]])
      .default("TXC"),
    destAddress: z.string().trim().min(20).max(120),
  })
  .superRefine((data, ctx) => {
    const dest = getDestination(data.destAsset);
    if (!dest.addressRegex.test(data.destAddress)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destAddress"],
        message: `Invalid ${dest.label} address`,
      });
    }
  });

export const createOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data }) => {
    // Validate chain/token pairing
    getToken(data.sourceChain as ChainKey, data.sourceToken);
    const dest = getDestination(data.destAsset);

    const settings = await getSettings();
    if (settings.paused) {
      throw new Error(
        settings.paused_reason?.trim() ||
          "New orders are temporarily paused. Please try again shortly.",
      );
    }
    if (data.usdAmount < settings.min_usd) {
      throw new Error(`Minimum order is $${settings.min_usd}`);
    }
    if (data.usdAmount > settings.max_usd) {
      throw new Error(`Maximum order is $${settings.max_usd.toLocaleString()}`);
    }

    // Lock the quote at creation time
    const spot = await getSpotPrice(dest.bitmartSymbol);
    const premiumMultiplier = 1 + settings.premium_bps / 10_000;
    const effectivePrice = spot * premiumMultiplier;
    const assetOut = data.usdAmount / effectivePrice;
    const assetPerUsd = 1 / effectivePrice;

    // Allocate next HD address
    const { data: idxData, error: idxErr } = await supabaseAdmin.rpc("next_hd_index");
    if (idxErr || typeof idxData !== "number") {
      throw new Error("Failed to allocate deposit address: " + (idxErr?.message ?? "no index"));
    }
    const depositAddress = deriveDepositAddress(idxData);

    const expiresAt = new Date(Date.now() + settings.expiry_minutes * 60_000).toISOString();

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        source_chain: data.sourceChain,
        source_token: data.sourceToken,
        source_amount_usd: data.usdAmount,
        deposit_address: depositAddress.toLowerCase(),
        deposit_index: idxData,
        dest_asset: dest.key,
        dest_address: data.destAddress,
        quoted_dest_per_usd: assetPerUsd,
        quoted_dest_out: assetOut,
        premium_bps: settings.premium_bps,
        bitmart_spot_price: spot,
        expires_at: expiresAt,
      })
      .select("public_id")
      .single();

    if (error || !order) throw new Error("Failed to create order: " + (error?.message ?? ""));

    // Fire-and-forget Telegram notification (respect notify threshold)
    if (data.usdAmount >= settings.notify_min_usd_created) {
      void notifyOrderEvent("created", {
        public_id: order.public_id,
        source_chain: data.sourceChain,
        source_token: data.sourceToken,
        source_amount_usd: data.usdAmount,
        quoted_dest_out: assetOut,
        dest_address: data.destAddress,
        dest_asset: dest.key,
      });
    }

    return { publicId: order.public_id };
  });

const GetInput = z.object({ publicId: z.string().min(3).max(40) });

export const getOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => GetInput.parse(input))
  .handler(async ({ data }) => {
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(
        "public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_asset,dest_address,quoted_dest_out,quoted_dest_per_usd,premium_bps,bitmart_spot_price,created_at,expires_at,paid_tx_hash,paid_amount_usd,bitmart_avg_price,bitmart_filled_dest,dest_tx_hash,error_message",
      )
      .eq("public_id", data.publicId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return null;
    const chain = getChain(order.source_chain);
    return {
      ...order,
      chainName: chain.name,
      chainExplorer: chain.explorer,
    };
  });

export const listChainOptions = createServerFn({ method: "GET" }).handler(async () => {
  return Object.values(CHAINS).map((c) => ({
    key: c.key,
    name: c.name,
    tokens: c.tokens.map((t) => t.symbol),
  }));
});
