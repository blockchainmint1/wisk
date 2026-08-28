import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowDownUp, Wallet } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DESTINATIONS, type DestAsset } from "@/lib/destinations";
import { createOrder } from "@/lib/orders.functions";
import { getQuote } from "@/lib/quote.functions";

type Side = "wISK" | "ISK";

const PRESETS = [100, 1000, 10000] as const;

export function SwapForm({ compact = false }: { compact?: boolean }) {
  const quoteFn = useServerFn(getQuote);
  const createFn = useServerFn(createOrder);

  const [have, setHave] = useState<Side>("wISK");
  const [amount, setAmount] = useState<string>("100");
  const [dest, setDest] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const want: Side = have === "wISK" ? "ISK" : "wISK";
  const isUnwrap = have === "wISK" && want === "ISK";
  const isWrap = have === "ISK" && want === "wISK";

  const destAsset: DestAsset = want;
  const destConfig = DESTINATIONS[destAsset];

  const haveAmount = useMemo(() => {
    const n = Number.parseFloat(amount.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const { data: quote } = useQuery({
    queryKey: ["quote", destAsset],
    queryFn: () => quoteFn({ data: { destAsset } }),
    refetchInterval: 15_000,
  });

  const unwrapFeeBps = quote?.ok ? (quote.unwrapFeeBps ?? 0) : 0;
  const wrapFeeBps = quote?.ok ? (quote.wrapFeeBps ?? 500) : 500;
  const unwrapFeePct = unwrapFeeBps / 100;
  const wrapFeePct = wrapFeeBps / 100;

  const wantAmount = useMemo(() => {
    if (haveAmount <= 0) return 0;
    if (isUnwrap) return haveAmount * (1 - unwrapFeeBps / 10_000);
    return haveAmount * (1 - wrapFeeBps / 10_000);
  }, [haveAmount, isUnwrap, unwrapFeeBps, wrapFeeBps]);


  const addressValid = destConfig.addressRegex.test(dest.trim());

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      return createFn({
        data: {
          sourceChain: isWrap ? "isk" : "ethereum",
          sourceToken: isWrap ? "ISK" : "wISK",
          sourceAmount: haveAmount,
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

  // 1:1 bridge — no price needed to place an order.
  const formValid = haveAmount > 0 && addressValid;


  function flip() {
    setHave((h) => (h === "wISK" ? "ISK" : "wISK"));
  }

  const amountTextSize = compact ? "text-3xl md:text-4xl" : "text-4xl md:text-5xl";

  return (
    <div className="relative animate-slide-up">
      <div className="absolute -inset-8 bg-accent/10 blur-3xl rounded-[3rem] -z-10" />

      <div className="bg-secondary/60 border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Have
          </span>
          <div className="flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(String(p))}
                className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors"
              >
                {p >= 1000 ? `${p / 1000}k` : p}
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
            className={`bg-transparent border-none outline-none font-mono ${amountTextSize} w-full text-foreground placeholder:text-muted-foreground/40`}
          />
          <SidePill side={have} />
        </div>
      </div>

      <div className="relative h-0">
        <button
          type="button"
          onClick={flip}
          aria-label="Flip direction"
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-xl bg-background border-4 border-background shadow-lg flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors z-10 ring-1 ring-border"
        >
          <ArrowDownUp className="h-4 w-4" />
        </button>
      </div>

      <div className="bg-secondary/60 border border-border rounded-2xl p-5 mt-1">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Want
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className={`font-mono ${amountTextSize} w-full text-foreground truncate`}>
            {wantAmount > 0
              ? wantAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })
              : "0"}
          </div>
          <SidePill side={want} />
        </div>

        <div className="mt-3 text-xs font-mono text-muted-foreground">
          {isUnwrap ? (
            <span className="opacity-70">
              {unwrapFeePct.toFixed(unwrapFeePct % 1 === 0 ? 0 : 2)}% fee
            </span>
          ) : wrapFeeBps > 0 ? (
            <span className="opacity-70">
              {wrapFeePct.toFixed(wrapFeePct % 1 === 0 ? 0 : 2)}% fee
            </span>
          ) : (
            <span className="opacity-70">1:1, no fee</span>
          )}
        </div>
      </div>

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
            className="flex-1 bg-background border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent min-w-0"
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

      <button
        onClick={() => mutation.mutate()}
        disabled={!formValid || mutation.isPending}
        className="mt-4 w-full bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-accent-foreground font-mono font-bold py-5 rounded-2xl transition-all shadow-[0_0_30px_hsl(0_84%_50%/0.35)] uppercase tracking-widest text-sm"
      >
        {mutation.isPending
          ? "Creating Order…"
          : haveAmount <= 0
            ? "Enter an amount"
            : !addressValid
              ? `Enter ${destConfig.label} address`
              : "Get started"}

      </button>

      <p className="mt-4 text-center text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
        Quote locks for 15 min once confirmed
      </p>
    </div>
  );
}

function SidePill({ side }: { side: Side }) {
  return (
    <div className="shrink-0 flex items-center gap-2 bg-background border border-border rounded-full pl-3 pr-3 py-2 font-mono text-sm">
      <span className="font-bold">{side}</span>
    </div>
  );
}
