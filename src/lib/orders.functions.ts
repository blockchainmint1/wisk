// Order lifecycle server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSpotPrice } from "./bitmart.server";
import { CHAINS, isWtxcSource, type ChainKey } from "./chains";
import { getMergedChain, getMergedChains, getMergedToken } from "./chains.server";
import { DEST_ASSETS, getDestination, type DestAsset } from "./destinations";
import { deriveDepositAddress } from "./hd.server";
import { getSettings } from "./settings.server";
import { notifyOrderEvent } from "./telegram.server";

const EVM_CHAIN_KEYS = Object.keys(CHAINS) as [ChainKey, ...ChainKey[]];
// "txc" is the native TEXITcoin chain used as a *source* for the wrap
// direction (user sends TXC → we pay wTXC). It's not in CHAINS because
// CHAINS is the EVM registry.
const ALL_SOURCE_CHAINS = [...EVM_CHAIN_KEYS, "txc"] as [string, ...string[]];

const CreateInput = z
  .object({
    sourceChain: z.enum(ALL_SOURCE_CHAINS),
    sourceToken: z.string().min(1).max(20),
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
    // Wrap direction: source = native TXC → dest MUST be wTXC.
    if (data.sourceChain === "txc") {
      if (data.sourceToken !== "TXC") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceToken"],
          message: "TXC source chain requires TXC token",
        });
      }
      if (data.destAsset !== "wTXC") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destAsset"],
          message: "TXC → must go to wTXC (wrap)",
        });
      }
    }
    // Guard against nonsensical pairs. wTXC → wTXC and TXC → wTXC-from-wTXC
    // would be a no-op or self-loop.
    if (
      data.sourceChain !== "txc" &&
      isWtxcSource(data.sourceChain as ChainKey, data.sourceToken) &&
      data.destAsset === "wTXC"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destAsset"],
        message: "wTXC → wTXC is not a valid swap",
      });
    }
  });

export const createOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data }) => {
    const isWrap = data.sourceChain === "txc";
    // Validate chain/token pairing (merged registry) — EVM sources only.
    if (!isWrap) {
      await getMergedToken(data.sourceChain as ChainKey, data.sourceToken);
    }
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

    // Blocked-address check — reject if destination wallet is on the blacklist.
    // Compared case-insensitively (EVM addresses stored lowercased).
    const destAddrNorm = data.destAddress.trim().toLowerCase();
    const { data: blocked } = await supabaseAdmin
      .from("blocked_addresses")
      .select("address,reason")
      .eq("address", destAddrNorm)
      .maybeSingle();
    if (blocked) {
      throw new Error("This wallet address cannot be used for new orders.");
    }


    // Quote calculation:
    //  - Wrap (source = native TXC → dest = wTXC): 1 TXC = (1 - wrap fee) wTXC.
    //  - Bridge unwrap (source = wTXC → dest = TXC): 1 wTXC = (1 - unwrap fee) TXC.
    //  - Everything else (stables/ETH → TXC or wTXC): Bitmart spot + 5%.
    const spot = await getSpotPrice(dest.bitmartSymbol);
    const isUnwrap =
      !isWrap && isWtxcSource(data.sourceChain as ChainKey, data.sourceToken);

    let assetPerUsd: number;
    let assetOut: number;
    if (isWrap) {
      const feeMul = 1 - settings.wrap_fee_bps / 10_000;
      // usdAmount was computed on the UI from haveTxc * spot. 1:1 minus fee.
      assetPerUsd = (1 / spot) * feeMul;
      assetOut = data.usdAmount * assetPerUsd;
    } else if (isUnwrap) {
      const feeMul = 1 - settings.unwrap_fee_bps / 10_000;
      assetPerUsd = (1 / spot) * feeMul;
      assetOut = data.usdAmount * assetPerUsd;
    } else {
      const premiumMultiplier = 1 + settings.premium_bps / 10_000;
      const effectivePrice = spot * premiumMultiplier;
      assetOut = data.usdAmount / effectivePrice;
      assetPerUsd = 1 / effectivePrice;
    }

    // Allocate HD address — recycles expired+unpaid indexes (>60min past expiry)
    // before incrementing the counter.
    const { data: idxData, error: idxErr } = await supabaseAdmin.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "allocate_hd_index" as any,
    );
    if (idxErr || typeof idxData !== "number") {
      throw new Error("Failed to allocate deposit address: " + (idxErr?.message ?? "no index"));
    }
    const depositAddress = deriveDepositAddress(idxData, isWrap ? "txc" : "evm");

    const expiresAt = new Date(Date.now() + settings.expiry_minutes * 60_000).toISOString();

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        source_chain: data.sourceChain,
        source_token: data.sourceToken,
        source_amount_usd: data.usdAmount,
        deposit_address: isWrap ? depositAddress : depositAddress.toLowerCase(),
        deposit_index: idxData,
        dest_asset: dest.key,
        dest_address: data.destAddress,
        quoted_dest_per_usd: assetPerUsd,
        quoted_dest_out: assetOut,
        premium_bps: isWrap
          ? -settings.wrap_fee_bps
          : isUnwrap
            ? -settings.unwrap_fee_bps
            : settings.premium_bps,
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
        "id,public_id,status,source_chain,source_token,source_amount_usd,deposit_address,dest_asset,dest_address,quoted_dest_out,quoted_dest_per_usd,premium_bps,bitmart_spot_price,created_at,expires_at,paid_tx_hash,paid_amount_usd,bitmart_avg_price,bitmart_filled_dest,dest_tx_hash,error_message,original_quoted_dest_out,underpayment_ack",
      )
      .eq("public_id", data.publicId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return null;

    const isTxcSource = order.source_chain === "txc";
    let chainName = "TEXITcoin";
    let chainExplorer = "https://mempool.texitcoin.org";
    if (!isTxcSource) {
      const chain = await getMergedChain(order.source_chain);
      chainName = chain.name;
      chainExplorer = chain.explorer;
    }

    // For any priced (non-$1) source token — native ETH, wTXC (unwrap),
    // native TXC (wrap) — surface a live USD spot so the UI can render an
    // approximate "send ~X TOKEN" hint. Stables stay $1.
    let sourceSpotUsd: number | null = null;
    let sourceNativeAmount: number | null = null;
    try {
      if (isTxcSource) {
        sourceSpotUsd = await getSpotPrice("TXC_USDT");
      } else {
        const token = await getMergedToken(order.source_chain as ChainKey, order.source_token);
        if (token.bitmartSymbol) {
          sourceSpotUsd = await getSpotPrice(token.bitmartSymbol);
        }
      }
      if (sourceSpotUsd && sourceSpotUsd > 0) {
        sourceNativeAmount = Number(order.source_amount_usd) / sourceSpotUsd;
      }
    } catch {
      // Non-fatal: detail page just falls back to USD.
    }

    return {
      ...order,
      chainName,
      chainExplorer,
      sourceSpotUsd,
      sourceNativeAmount,
    };
  });

export const listChainOptions = createServerFn({ method: "GET" }).handler(async () => {
  const merged = await getMergedChains();
  return Object.values(merged).map((c) => ({
    key: c.key,
    name: c.name,
    nativeSymbol: c.nativeSymbol,
    tokens: c.tokens.map((t) => ({ symbol: t.symbol, isNative: !!t.isNative })),
  }));
});
