import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ChevronDown, Wallet } from "lucide-react";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { SwapHistory } from "@/components/swap-history";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DESTINATIONS, type DestAsset } from "@/lib/destinations";
import { createOrder, listChainOptions } from "@/lib/orders.functions";
import { getQuote } from "@/lib/quote.functions";

export const Route = createFileRoute("/swap/")({
  head: () => ({
    meta: [
      { title: "Swap — wTXC ↔ TXC Bridge" },
      {
        name: "description",
        content:
          "Swap wTXC ↔ TXC or on-ramp from stables/ETH. Locked quote, direct payout to the address you choose.",
      },
      { property: "og:title", content: "Swap — wTXC ↔ TXC Bridge" },
      {
        property: "og:description",
        content: "Bidirectional wTXC ↔ TXC swap with a stablecoin on-ramp.",
      },
    ],
  }),
  component: SwapPage,
});

interface SourceOption {
  id: string;
  chain: string;
  chainName: string;
  symbol: string;
  isNative: boolean;
  isWtxc: boolean;
}

const PRESETS = [100, 500, 1000] as const;

function SwapPage() {
  const listChains = useServerFn(listChainOptions);
  const quoteFn = useServerFn(getQuote);
  const createFn = useServerFn(createOrder);

  const { data: chains } = useQuery({
    queryKey: ["chains"],
    queryFn: () => listChains(),
    staleTime: Infinity,
  });

  const sourceOptions = useMemo<SourceOption[]>(() => {
    if (!chains) return [];
    const opts: SourceOption[] = [];
    for (const c of chains) {
      for (const t of c.tokens) {
        opts.push({
          id: `${c.key}:${t.symbol}`,
          chain: c.key,
          chainName: c.name,
          symbol: t.symbol,
          isNative: !!t.isNative,
          isWtxc: c.key === "ethereum" && t.symbol === "wTXC",
        });
      }
    }
    // wTXC first (primary bridge inflow)
    opts.sort((a, b) => (a.isWtxc === b.isWtxc ? 0 : a.isWtxc ? -1 : 1));
    return opts;
  }, [chains]);

  const [sourceId, setSourceId] = useState<string>("ethereum:wTXC");
  const [destAsset, setDestAsset] = useState<DestAsset>("TXC");
  const [amount, setAmount] = useState<string>("100");
  const [dest, setDest] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const source = sourceOptions.find((s) => s.id === sourceId) ?? sourceOptions[0];

  useEffect(() => {
    if (sourceOptions.length && !sourceOptions.find((s) => s.id === sourceId)) {
      setSourceId(sourceOptions[0].id);
    }
  }, [sourceOptions, sourceId]);

  // wTXC → wTXC is a no-op; force TXC.
  useEffect(() => {
    if (source?.isWtxc && destAsset === "wTXC") setDestAsset("TXC");
  }, [source?.isWtxc, destAsset]);

  const destConfig = DESTINATIONS[destAsset];
  const isUnwrap = !!source?.isWtxc && destAsset === "TXC";

  const usdAmount = useMemo(() => {
    const n = Number.parseFloat(amount.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const { data: quote } = useQuery({
    queryKey: ["quote", usdAmount, destAsset],
    queryFn: () => quoteFn({ data: { usdAmount: Math.max(usdAmount, 1), destAsset } }),
    refetchInterval: 15_000,
  });

  const effectivePriceUsd = useMemo(() => {
    if (!quote?.ok) return null;
    if (isUnwrap) {
      const feeMul = 1 - (quote.unwrapFeeBps ?? 100) / 10_000;
      return quote.spotPriceUsd / feeMul;
    }
    return quote.effectivePriceUsd;
  }, [quote, isUnwrap]);

  const assetOut =
    effectivePriceUsd && usdAmount > 0 ? usdAmount / effectivePriceUsd : 0;

  const sourceIsPriced = source?.isNative || source?.isWtxc;

  // For priced sources, show approx source-token amount using the source's
  // own spot (approx via quote spot if source is wTXC). Stables = USD 1:1.
  const sourceTokenAmount = useMemo(() => {
    if (!source) return null;
    if (!sourceIsPriced) return usdAmount; // stables
    if (source.isWtxc && quote?.ok) return usdAmount / quote.spotPriceUsd;
    return null; // ETH etc — final amount shown on next screen
  }, [source, sourceIsPriced, usdAmount, quote]);

  const addressValid = destConfig.addressRegex.test(dest.trim());

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!source) throw new Error("Pick a source asset");
      return createFn({
        data: {
          sourceChain: source.chain as "ethereum" | "base" | "arbitrum" | "polygon" | "bsc",
          sourceToken: source.symbol,
          usdAmount,
          destAsset,
          destAddress: dest.trim(),
        },
      });
    },
    onSuccess: (res) => {
      const id = res?.publicId;
      if (!id) {
        setError("Order created but no ID returned.");
        return;
      }
      window.location.href = `/swap/${id}`;
    },
    onError: (e: Error) => setError(e?.message || "Order creation failed."),
  });

  const formValid =
    !!source && usdAmount >= 10 && addressValid && quote?.ok === true;

  // Flip handler: switch between wTXC (unwrap) and a default onramp (USDC/eth).
  function flip() {
    if (source?.isWtxc) {
      // Unwrap → onramp default
      setSourceId("ethereum:USDC");
      setDestAsset("wTXC");
    } else if (destAsset === "wTXC") {
      // Onramp to wTXC → unwrap
      setSourceId("ethereum:wTXC");
      setDestAsset("TXC");
    } else {
      // Onramp to TXC → unwrap
      setSourceId("ethereum:wTXC");
      setDestAsset("TXC");
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader ticker={<LiveTicker />} />
      <main className="max-w-xl mx-auto px-4 py-12 md:py-20">
        <div className="mb-10 text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter leading-none">
            Swap <span className="text-accent">wTXC ↔ TXC</span>
          </h1>
          <p className="mt-4 text-sm text-muted-foreground font-mono">
            {isUnwrap
              ? "Unwrap wTXC → native TXC. 1% bridge fee."
              : "Live Bitmart price + 5% protocol premium."}
          </p>
        </div>

        <div className="relative animate-slide-up">
          <div className="absolute -inset-8 bg-accent/10 blur-3xl rounded-[3rem] -z-10" />

          {/* SELL */}
          <div className="bg-secondary/60 border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Sell
              </span>
              <div className="flex gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAmount(String(p))}
                    className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors"
                  >
                    ${p >= 1000 ? `${p / 1000}k` : p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="bg-transparent border-none outline-none font-mono text-4xl md:text-5xl w-full text-foreground placeholder:text-muted-foreground/40"
              />
              <TokenPill
                value={sourceId}
                onChange={setSourceId}
                options={sourceOptions.map((o) => ({
                  value: o.id,
                  label: `${o.symbol}${o.isNative ? " (native)" : ""} · ${o.chainName}`,
                  short: o.symbol,
                }))}
              />
            </div>

            <div className="mt-3 flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>${usdAmount ? usdAmount.toLocaleString() : "0"}</span>
              <span>
                {sourceTokenAmount != null
                  ? `${sourceTokenAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${source?.symbol}`
                  : source?.isNative
                    ? `≈ USD value in ${source.symbol}`
                    : ""}
              </span>
            </div>
          </div>

          {/* FLIP */}
          <div className="relative h-0">
            <button
              type="button"
              onClick={flip}
              aria-label="Flip direction"
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-xl bg-background border-4 border-background shadow-lg flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors z-10 ring-1 ring-border"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>

          {/* BUY */}
          <div className="bg-secondary/60 border border-border rounded-2xl p-5 mt-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                Buy
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="font-mono text-4xl md:text-5xl w-full text-foreground truncate">
                {assetOut > 0
                  ? assetOut.toLocaleString(undefined, { maximumFractionDigits: 6 })
                  : "0"}
              </div>
              <DestPill
                value={destAsset}
                onChange={setDestAsset}
                disableWtxc={!!source?.isWtxc}
              />
            </div>

            <div className="mt-3 text-xs font-mono text-muted-foreground">
              {effectivePriceUsd
                ? `1 ${destConfig.label} ≈ $${effectivePriceUsd.toFixed(6)}`
                : "Fetching rate…"}
              {quote?.ok ? (
                <span className="ml-2 opacity-70">
                  · {isUnwrap ? "1% fee" : "+5% premium"}
                </span>
              ) : null}
            </div>
          </div>

          {/* RECIPIENT ADDRESS */}
          <div className="mt-4 bg-secondary/40 border border-border rounded-2xl p-5">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Send {destConfig.label} to
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder={destConfig.addressHint}
                className="flex-1 bg-background border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
              />
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={destConfig.walletUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Get a wallet"
                      className="shrink-0 flex items-center justify-center px-3 bg-background border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                    >
                      <Wallet className="h-4 w-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Get a wallet</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {dest.trim().length > 0 && !addressValid ? (
              <div className="mt-2 text-[10px] font-mono text-accent uppercase tracking-widest">
                Invalid {destConfig.label} address
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mt-4 text-xs font-mono text-accent border border-accent/40 p-3 rounded-xl">
              {error}
            </div>
          ) : null}

          {/* CTA */}
          <button
            onClick={() => mutation.mutate()}
            disabled={!formValid || mutation.isPending}
            className="mt-4 w-full bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-accent-foreground font-mono font-bold py-5 rounded-2xl transition-all shadow-[0_0_30px_hsl(0_84%_50%/0.35)] uppercase tracking-widest text-sm"
          >
            {mutation.isPending
              ? "Creating Order…"
              : !source || usdAmount < 10
                ? "Enter an amount (min $10)"
                : !addressValid
                  ? `Enter ${destConfig.label} address`
                  : !quote?.ok
                    ? "Waiting for quote…"
                    : "Get started"}
          </button>

          <p className="mt-4 text-center text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Quote locks for 15 min once confirmed · Minimum $10
          </p>
        </div>

        <div className="mt-10">
          <SwapHistory />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function TokenPill({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; short: string }[];
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label="Select token"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2 bg-background border border-border rounded-full pl-3 pr-2 py-2 font-mono text-sm hover:border-accent transition-colors">
        <span className="font-bold">{current?.short ?? "—"}</span>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </div>
    </div>
  );
}

function DestPill({
  value,
  onChange,
  disableWtxc,
}: {
  value: DestAsset;
  onChange: (v: DestAsset) => void;
  disableWtxc: boolean;
}) {
  return (
    <div className="shrink-0 flex bg-background border border-border rounded-full p-1 font-mono text-xs">
      {(["TXC", "wTXC"] as DestAsset[]).map((a) => {
        const active = value === a;
        const disabled = disableWtxc && a === "wTXC";
        return (
          <button
            key={a}
            type="button"
            disabled={disabled}
            onClick={() => onChange(a)}
            title={disabled ? "wTXC → wTXC is a no-op" : undefined}
            className={`px-3 py-1.5 rounded-full uppercase tracking-widest transition-colors ${
              active
                ? "bg-accent text-accent-foreground font-bold"
                : "text-muted-foreground hover:text-foreground"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {a}
          </button>
        );
      })}
    </div>
  );
}
