// Order lifecycle server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CHAINS, isWiskSource, type ChainKey } from "./chains";
import { getMergedChain, getMergedChains, getMergedToken } from "./chains.server";
import { DEST_ASSETS, getDestination, type DestAsset } from "./destinations";
import { deriveDepositAddress } from "./hd.server";
import { getSettings } from "./settings.server";
import { notifyOrderEvent, sendAdminAlert } from "./telegram.server";
import { getBlockNumber } from "./evm-scan.server";
import { getIskTipHeight } from "./isk-scan.server";

// Anti-abuse limits on order creation, keyed on destination address.
// - MAX_OPEN_PER_DEST: cap concurrent unpaid orders per destination.
// - MIN_INTERVAL_MS: minimum spacing between orders for the same destination.
// Prevents a client from spamming createOrder and burning HD indices, and
// (combined with deposit_start_block) makes stale-deposit replay unprofitable.
const MAX_OPEN_PER_DEST = 3;
const MIN_INTERVAL_MS = 20_000;

const EVM_CHAIN_KEYS = Object.keys(CHAINS) as [ChainKey, ...ChainKey[]];
// "isk" is the native Iskander Coin chain used as a *source* for the wrap
// direction (user sends ISK → we pay wISK). It's not in CHAINS because
// CHAINS is the EVM registry.
const ALL_SOURCE_CHAINS = [...EVM_CHAIN_KEYS, "isk"] as [string, ...string[]];

const CreateInput = z
  .object({
    sourceChain: z.enum(ALL_SOURCE_CHAINS),
    sourceToken: z.string().min(1).max(20),
    // Native source-token amount (ISK or wISK). Authoritative input for the
    // pure 1:1 bridge — there is no USD notion anywhere in this flow.
    sourceAmount: z.number().positive().max(100_000_000),

    destAsset: z
      .enum(DEST_ASSETS as [DestAsset, ...DestAsset[]])
      .default("ISK"),
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
    // Wrap direction: source = native ISK → dest MUST be wISK.
    if (data.sourceChain === "isk") {
      if (data.sourceToken !== "ISK") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceToken"],
          message: "ISK source chain requires ISK token",
        });
      }
      if (data.destAsset !== "wISK") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["destAsset"],
          message: "ISK → must go to wISK (wrap)",
        });
      }
    }
    // Guard against nonsensical pairs. wISK → wISK and ISK → wISK-from-wISK
    // would be a no-op or self-loop.
    if (
      data.sourceChain !== "isk" &&
      isWiskSource(data.sourceChain as ChainKey, data.sourceToken) &&
      data.destAsset === "wISK"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destAsset"],
        message: "wISK → wISK is not a valid swap",
      });
    }
  });

export const createOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data }) => {
    const isWrap = data.sourceChain === "isk";
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

    // Per-destination rate limits. Both keyed on lowercased address so EVM
    // casing games don't bypass. ISK addresses are already case-sensitive.
    const { count: openCount } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("dest_address", data.destAddress)
      .in("status", ["awaiting_payment", "payment_detected"]);
    if ((openCount ?? 0) >= MAX_OPEN_PER_DEST) {
      throw new Error(
        `Too many open orders for this destination. Finish or wait for existing orders to expire before creating another.`,
      );
    }

    const { data: recent } = await supabaseAdmin
      .from("orders")
      .select("created_at")
      .eq("dest_address", data.destAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent?.created_at) {
      const ageMs = Date.now() - new Date(recent.created_at).getTime();
      if (ageMs < MIN_INTERVAL_MS) {
        const wait = Math.ceil((MIN_INTERVAL_MS - ageMs) / 1000);
        throw new Error(`Please wait ${wait}s before creating another order for this destination.`);
      }
    }


    // Pure 1:1 bridge quote: native token in → native token out, minus the
    // configured wrap/unwrap fee. No USD notion anywhere in this flow.
    const isUnwrap =
      !isWrap && isWiskSource(data.sourceChain as ChainKey, data.sourceToken);
    const feeBps = isWrap ? settings.wrap_fee_bps : settings.unwrap_fee_bps;
    const feeMul = 1 - feeBps / 10_000;

    const sourceAmount = data.sourceAmount;
    if (!(sourceAmount > 0)) {
      throw new Error("Invalid amount");
    }
    const assetOut = sourceAmount * feeMul;
    const assetPerUsd = feeMul;
    const usdAmount = 0;


    // Allocate HD address.
    //  - ISK deposits (wrap): NEVER recycle — always a brand-new index, so a
    //    deposit address is never handed out twice and can't be gamed.
    //  - EVM deposits (unwrap): keep recycling indexes idle for >1h.
    const { data: idxData, error: idxErr } = await supabaseAdmin.rpc(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "allocate_hd_index" as any,
      { _recycle: !isWrap } as any,
    );
    if (idxErr || typeof idxData !== "number") {
      throw new Error("Failed to allocate deposit address: " + (idxErr?.message ?? "no index"));
    }
    const depositAddress = deriveDepositAddress(idxData, isWrap ? "isk" : "evm");

    const expiresAt = new Date(Date.now() + settings.expiry_minutes * 60_000).toISOString();

    // Snapshot the source-chain tip at creation time, minus a small reorg
    // cushion. The scanner rejects any deposit whose block predates this,
    // which blocks stale-deposit replay at recycled HD addresses. The cushion
    // absorbs shallow reorgs / RPC tip lag so a legit deposit that lands
    // 1-2 blocks "behind" the reported tip still credits normally.
    const REORG_CUSHION_BLOCKS = 3; // same for EVM and ISK
    let depositStartBlock: number | null = null;
    try {
      const tip = isWrap
        ? await getIskTipHeight()
        : await getBlockNumber(data.sourceChain as ChainKey);
      depositStartBlock = Math.max(0, tip - REORG_CUSHION_BLOCKS);
    } catch (e) {
      // Don't fail the order — we need swaps to keep working even if a
      // chain RPC is temporarily unreachable. But this DOES temporarily
      // disable the block-height guard for this order, so page the admin.
      console.warn("[createOrder] start-block snapshot failed", e);
      void sendAdminAlert(
        "Chain tip unavailable — replay guard disabled for this order",
        `Could not read ${data.sourceChain} tip during order creation. Order will be created without a deposit_start_block, so the stale-deposit guard cannot protect it. Check the chain's RPC health. Error: ${(e as Error)?.message ?? String(e)}`,
        `tip-fail:${data.sourceChain}:${Math.floor(Date.now() / 300_000)}`, // dedupe: 1 alert per chain per 5min
      );
    }


    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        source_chain: data.sourceChain,
        source_token: data.sourceToken,
        source_amount_usd: usdAmount,

        deposit_address: isWrap ? depositAddress : depositAddress.toLowerCase(),
        deposit_index: idxData,
        deposit_start_block: depositStartBlock,
        dest_asset: dest.key,
        dest_address: data.destAddress,
        quoted_dest_per_usd: assetPerUsd,
        quoted_dest_out: assetOut,
        premium_bps: isWrap
          ? -settings.wrap_fee_bps
          : isUnwrap
            ? -settings.unwrap_fee_bps
            : settings.premium_bps,
        bitmart_spot_price: 0,
        expires_at: expiresAt,
      })
      .select("public_id")
      .single();

    if (error || !order) throw new Error("Failed to create order: " + (error?.message ?? ""));

    // Fire-and-forget Telegram notification (respect notify threshold)
    if (usdAmount >= settings.notify_min_usd_created || true) {
      void notifyOrderEvent("created", {
        public_id: order.public_id,
        source_chain: data.sourceChain,
        source_token: data.sourceToken,
        source_amount_usd: usdAmount,

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

    const isIskSource = order.source_chain === "isk";
    let chainName = "Iskander Coin";
    let chainExplorer = "https://mempool.iskandercoin.com";
    if (!isIskSource) {
      const chain = await getMergedChain(order.source_chain);
      chainName = chain.name;
      chainExplorer = chain.explorer;
    }

    // Pure 1:1 bridge: no USD/spot pricing. Source amount is always the
    // native on-chain amount already tracked on the order.
    return {
      ...order,
      chainName,
      chainExplorer,
      sourceSpotUsd: null,
      sourceNativeAmount: null,
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

const AcceptUnderpaymentInput = z.object({ publicId: z.string().min(3).max(40) });

/**
 * Customer chose "continue with what I sent" from the underpayment prompt.
 * Flips underpayment_ack from 'pending' → 'accepted' so the next tick
 * advances the order to `confirmed` and pays out the repriced amount.
 * Public (no auth) — keyed by the unguessable public order id.
 */
export const acceptUnderpayment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AcceptUnderpaymentInput.parse(input))
  .handler(async ({ data }) => {
    const { data: updated, error } = await supabaseAdmin
      .from("orders")
      .update({ underpayment_ack: "accepted" })
      .eq("public_id", data.publicId)
      .eq("underpayment_ack", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: !!updated };
  });
