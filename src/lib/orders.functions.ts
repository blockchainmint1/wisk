// Order lifecycle server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTxcSpotPrice } from "./bitmart.server";
import { CHAINS, PREMIUM_BPS, getChain, getToken, type ChainKey } from "./chains";
import { deriveDepositAddress } from "./hd.server";

const CreateInput = z.object({
  sourceChain: z.enum(["ethereum", "base", "arbitrum", "polygon", "bsc"]),
  sourceToken: z.enum(["USDC", "USDT", "DAI"]),
  usdAmount: z.number().positive().max(1_000_000),
  destTxcAddress: z
    .string()
    .trim()
    .min(20)
    .max(120)
    .regex(/^[A-Za-z0-9]+$/, "Invalid TXC address"),
});

export const createOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data }) => {
    // Validate chain/token pairing
    getToken(data.sourceChain as ChainKey, data.sourceToken);

    // Lock the quote at creation time
    const spot = await getTxcSpotPrice();
    const premiumMultiplier = 1 + PREMIUM_BPS / 10_000;
    const effectivePrice = spot * premiumMultiplier;
    const txcOut = data.usdAmount / effectivePrice;
    const txcPerUsd = 1 / effectivePrice;

    // Allocate next HD address
    const { data: idxData, error: idxErr } = await supabaseAdmin.rpc("next_hd_index");
    if (idxErr || typeof idxData !== "number") {
      throw new Error("Failed to allocate deposit address: " + (idxErr?.message ?? "no index"));
    }
    const depositAddress = deriveDepositAddress(idxData);

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        source_chain: data.sourceChain,
        source_token: data.sourceToken,
        source_amount_usd: data.usdAmount,
        deposit_address: depositAddress.toLowerCase(),
        deposit_index: idxData,
        dest_txc_address: data.destTxcAddress,
        quoted_txc_per_usd: txcPerUsd,
        quoted_txc_out: txcOut,
        premium_bps: PREMIUM_BPS,
        bitmart_spot_price: spot,
      })
      .select("public_id")
      .single();

    if (error || !order) throw new Error("Failed to create order: " + (error?.message ?? ""));
    return { publicId: order.public_id };
  });

const GetInput = z.object({ publicId: z.string().min(3).max(40) });

export const getOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => GetInput.parse(input))
  .handler(async ({ data }) => {
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(
        "public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_txc_address,quoted_txc_out,quoted_txc_per_usd,premium_bps,bitmart_spot_price,created_at,expires_at,paid_tx_hash,paid_amount_usd,bitmart_avg_price,bitmart_filled_txc,txc_tx_hash,error_message",
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
