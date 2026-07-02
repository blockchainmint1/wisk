import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Lock, Wallet } from "lucide-react";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { SwapHistory } from "@/components/swap-history";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
        content: "Bidirectional wTXC ↔ TXC swap with a stablecoin on-ramp. Locked quotes.",
      },
    ],
  }),
  component: SwapPage,
});

// A "source option" is a (chain, tokenSymbol) tuple. Rendered as one row in
// the "I have" picker. The stable id is `${chain}:${symbol}`.
interface SourceOption {
  id: string;
  chain: string;
  chainName: string;
  symbol: string;
  isNative: boolean;
  isWtxc: boolean;
}

function SwapPage() {
  const listChains = useServerFn(listChainOptions);
  const quoteFn = useServerFn(getQuote);
  const createFn = useServerFn(createOrder);

  const { data: chains } = useQuery({
    queryKey: ["chains"],
    queryFn: () => listChains(),
    staleTime: Infinity,
  });

  // Build flat list of source options.
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
    // Put wTXC first — it's the primary bridge inflow.
    opts.sort((a, b) => {
      if (a.isWtxc && !b.isWtxc) return -1;
      if (!a.isWtxc && b.isWtxc) return 1;
      return 0;
    });
    return opts;
  }, [chains]);

  // Default: wTXC on Ethereum → TXC (the unwrap path).
  const [sourceId, setSourceId] = useState<string>("ethereum:wTXC");
  const [destAsset, setDestAsset] = useState<DestAsset>("TXC");
  const [amount, setAmount] = useState<string>("100");
  const [dest, setDest] = useState<string>("");
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = sourceOptions.find((s) => s.id === sourceId) ?? sourceOptions[0];

  // If chains load and current sourceId is invalid, snap to first.
  useEffect(() => {
    if (sourceOptions.length && !sourceOptions.find((s) => s.id === sourceId)) {
      setSourceId(sourceOptions[0].id);
    }
  }, [sourceOptions, sourceId]);

  // Rule: wTXC → wTXC is a no-op. Force destAsset = TXC when source is wTXC.
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
    refetchInterval: locked ? false : 15_000,
  });

  // Effective payout rate: unwrap uses spot × (1 - unwrap fee), everything
  // else uses spot × (1 + premium). We already receive both from the quote.
  const effectivePriceUsd = useMemo(() => {
    if (!quote?.ok) return null;
    if (isUnwrap) {
      const feeMul = 1 - (quote.unwrapFeeBps ?? 100) / 10_000;
      return quote.spotPriceUsd / feeMul; // higher $/TXC = user gets less
    }
    return quote.effectivePriceUsd;
  }, [quote, isUnwrap]);

  const assetOut =
    effectivePriceUsd && usdAmount > 0
      ? (usdAmount / effectivePriceUsd).toFixed(8)
      : "—";

  // Denominate the "You send" amount.
  //  - Stables: amount = USD directly.
  //  - Native / wTXC: amount is treated as USD-value; we show a hint that the
  //    exact token amount will be shown next screen (repriced at deposit).
  const sourceIsPriced = source?.isNative || source?.isWtxc;

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
        setError("Order created but no ID returned. Please refresh.");
        return;
      }
      window.location.href = `/swap/${id}`;
    },
    onError: (e: Error) => {
      setError(e?.message || "Order creation failed.");
    },
  });

  const formValid =
    !!source && usdAmount >= 10 && addressValid && quote?.ok === true && locked;

  return (
    <div className="min-h-screen">
      <SiteHeader ticker={<LiveTicker />} />
      <main className="max-w-3xl mx-auto px-4 py-12 md:py-20">
        <div className="mb-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Exchange Terminal
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter leading-none">
            Swap <span className="text-accent">wTXC ↔ TXC</span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground font-mono">
            {isUnwrap
              ? "Unwrap wTXC → native TXC. 1% bridge fee."
              : "On-ramp from stables or ETH. Live Bitmart price + 5% protocol premium."}
          </p>
        </div>

        <div className="relative animate-slide-up">
          <div className="absolute -inset-1 bg-accent/10 blur-3xl rounded-3xl -z-10" />
          <div className="bg-secondary border border-border p-1 rounded-2xl">
            <div className="bg-background border border-border rounded-xl p-6 space-y-4">
              {/* I HAVE */}
              <PairBox tone="have" label="I have">
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={locked}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-transparent border-none outline-none font-mono text-3xl w-full text-foreground disabled:opacity-60"
                  />
                  <select
                    disabled={locked}
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="bg-background border border-border px-3 py-2 rounded-md font-mono text-xs focus:outline-none min-w-[180px] disabled:opacity-60"
                  >
                    {sourceOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.symbol}
                        {opt.isNative ? " (native)" : ""} — {opt.chainName}
                      </option>
                    ))}
                  </select>
                </div>
                {sourceIsPriced ? (
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    Amount shown is USD value. Exact {source?.symbol} amount to send
                    is displayed on the next screen (repriced at deposit).
                  </div>
                ) : null}
              </PairBox>

              <div className="flex justify-center -my-2">
                <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center">
                  <ArrowDown className="h-4 w-4 text-accent" />
                </div>
              </div>

              {/* I WANT */}
              <PairBox tone="want" label="I want">
                <div className="flex items-center gap-3">
                  <div className="bg-transparent font-mono text-3xl w-full text-foreground">
                    {assetOut}
                  </div>
                  <div className="grid grid-cols-2 gap-1 border border-border rounded-md p-1 bg-background">
                    {(["TXC", "wTXC"] as DestAsset[]).map((a) => {
                      const disabled = source?.isWtxc && a === "wTXC";
                      const active = a === destAsset;
                      return (
                        <button
                          key={a}
                          type="button"
                          disabled={locked || disabled}
                          onClick={() => setDestAsset(a)}
                          className={`px-3 py-2 rounded font-mono text-xs uppercase tracking-widest transition-colors ${
                            active
                              ? "bg-accent text-accent-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                          title={disabled ? "wTXC → wTXC is a no-op" : undefined}
                        >
                          {a}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </PairBox>

              {/* RATE */}
              <div className="bg-secondary/50 rounded-lg p-4 space-y-2 text-xs font-mono">
                <Row
                  label="Exchange rate"
                  value={
                    effectivePriceUsd
                      ? `1 ${destConfig.label} = $${effectivePriceUsd.toFixed(6)}`
                      : "—"
                  }
                />
                <Row
                  label="Spot"
                  value={quote?.ok ? `$${quote.spotPriceUsd.toFixed(6)}` : "—"}
                />
                <Row
                  label={isUnwrap ? "Bridge fee (1%)" : "Protocol premium (5%)"}
                  value={
                    quote?.ok && usdAmount > 0
                      ? `$${(usdAmount * (isUnwrap ? 0.01 : 0.05 / 1.05)).toFixed(2)}`
                      : "—"
                  }
                />
                <div className="border-t border-border/50 pt-2 mt-2">
                  <Row
                    strong
                    label="You receive"
                    value={`${assetOut} ${destConfig.label}`}
                  />
                </div>
              </div>

              {/* LOCK */}
              <button
                type="button"
                onClick={() => setLocked((v) => !v)}
                disabled={!source || usdAmount < 10 || !quote?.ok}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-mono text-xs uppercase tracking-widest border transition-colors ${
                  locked
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                <Lock className="h-3.5 w-3.5" />
                {locked ? "Rate locked — edit to unlock" : "Lock this rate"}
              </button>

              {/* ADDRESSES */}
              <Field label={`Send from (your ${source?.symbol ?? ""} wallet)`}>
                <div className="text-[11px] font-mono text-muted-foreground bg-secondary/50 border border-border rounded-lg p-3 leading-relaxed">
                  On the next screen we'll show a one-time deposit address on{" "}
                  <span className="text-foreground">
                    {source?.chainName ?? ""}
                  </span>
                  . Send {source?.symbol ?? ""} from any wallet you control.
                </div>
              </Field>

              <Field label={`Receive to (your ${destConfig.label} address)`}>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={dest}
                    onChange={(e) => setDest(e.target.value)}
                    placeholder={destConfig.addressHint}
                    className="flex-1 bg-secondary border border-border p-4 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
                  />
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={destConfig.walletUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Get a wallet"
                          className="shrink-0 flex items-center justify-center px-4 bg-secondary border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
                        >
                          <Wallet className="h-4 w-4" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>Get a wallet</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {dest.trim().length > 0 && !addressValid ? (
                  <div className="text-[10px] font-mono text-accent uppercase tracking-widest px-1">
                    Invalid {destConfig.label} address — {destConfig.addressHint}
                  </div>
                ) : null}
              </Field>

              {error ? (
                <div className="text-xs font-mono text-accent border border-accent/40 p-3 rounded">
                  {error}
                </div>
              ) : null}

              {!formValid && !error ? (
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest px-1">
                  {usdAmount < 10
                    ? "Enter an amount of at least $10"
                    : !locked
                      ? "Lock the rate to continue"
                      : !addressValid
                        ? `Enter a valid ${destConfig.label} recipient address`
                        : !quote?.ok
                          ? "Waiting for live quote…"
                          : "Complete the form to continue"}
                </div>
              ) : null}

              <button
                onClick={() => mutation.mutate()}
                disabled={!formValid || mutation.isPending}
                className="w-full bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-accent-foreground font-mono font-bold py-5 rounded-lg transition-all shadow-[0_0_20px_hsl(0_84%_50%/0.3)] uppercase tracking-widest"
              >
                {mutation.isPending ? "Creating Order…" : "Get Deposit Address"}
              </button>

              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest text-center">
                Quote valid for 15 minutes once confirmed. Minimum $10.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <SwapHistory />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function PairBox({
  tone,
  label,
  children,
}: {
  tone: "have" | "want";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        tone === "have"
          ? "border-border bg-secondary/40"
          : "border-accent/40 bg-accent/5"
      }`}
    >
      <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest px-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "text-foreground font-bold" : ""}>{value}</span>
    </div>
  );
}
