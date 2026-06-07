import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Wallet } from "lucide-react";
import { DEST_ASSETS, DESTINATIONS, type DestAsset } from "@/lib/destinations";
import { createOrder, listChainOptions } from "@/lib/orders.functions";
import { getQuote } from "@/lib/quote.functions";

export const Route = createFileRoute("/swap")({
  head: () => ({
    meta: [
      { title: "Swap — SWAP" },
      {
        name: "description",
        content:
          "Quote and initiate your USDC/USDT/DAI → TXC or ISK$ swap. Live pricing, 5% protocol fee, unique deposit address per order.",
      },
      { property: "og:title", content: "Swap — SWAP" },
      {
        property: "og:description",
        content: "Stablecoins in. Native TXC or ISK$ out. Live Bitmart pricing.",
      },
    ],
  }),
  component: SwapPage,
});

function SwapPage() {
  const navigate = useNavigate();
  const listChains = useServerFn(listChainOptions);
  const quoteFn = useServerFn(getQuote);
  const createFn = useServerFn(createOrder);

  const { data: chains } = useQuery({
    queryKey: ["chains"],
    queryFn: () => listChains(),
    staleTime: Infinity,
  });

  const [chain, setChain] = useState<string>("ethereum");
  const [token, setToken] = useState<string>("USDC");
  const [amount, setAmount] = useState<string>("1000");
  const [destAsset, setDestAsset] = useState<DestAsset>("TXC");
  const [dest, setDest] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const destConfig = DESTINATIONS[destAsset];

  const usdAmount = useMemo(() => {
    const n = Number.parseFloat(amount.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const { data: quote } = useQuery({
    queryKey: ["quote", usdAmount, destAsset],
    queryFn: () => quoteFn({ data: { usdAmount: Math.max(usdAmount, 1), destAsset } }),
    refetchInterval: 15_000,
  });

  const assetOut =
    quote?.ok && usdAmount > 0 ? (usdAmount / quote.effectivePriceUsd).toFixed(8) : "—";

  const addressValid = destConfig.addressRegex.test(dest.trim());

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      return createFn({
        data: {
          sourceChain: chain as "ethereum" | "base" | "arbitrum" | "polygon" | "bsc",
          sourceToken: token as "USDC" | "USDT" | "DAI",
          usdAmount,
          destAsset,
          destAddress: dest.trim(),
        },
      });
    },
    onSuccess: (res) => {
      navigate({ to: "/swap/$orderId", params: { orderId: res.publicId } });
    },
    onError: (e: Error) => setError(e.message),
  });

  const chainOpt = chains?.find((c) => c.key === chain);
  const tokenOptions = chainOpt?.tokens ?? ["USDC"];
  // Auto-correct token if not available on selected chain
  if (chainOpt && !(tokenOptions as string[]).includes(token)) {
    setToken(tokenOptions[0] as string);
  }

  const formValid = usdAmount >= 10 && addressValid && quote?.ok === true;

  return (
    <div className="min-h-screen">
      <SiteHeader ticker={<LiveTicker />} />
      <main className="max-w-3xl mx-auto px-4 py-12 md:py-20">
        <div className="mb-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Exchange Terminal
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter leading-none">
            Swap to <span className="text-accent">{destConfig.label}</span>
          </h1>
        </div>

        <div className="relative animate-slide-up">
          <div className="absolute -inset-1 bg-accent/10 blur-3xl rounded-3xl -z-10" />
          <div className="bg-secondary border border-border p-1 rounded-2xl">
            <div className="bg-background border border-border rounded-xl p-6 space-y-5">
              {/* Destination asset toggle */}
              <Field label="Destination Asset">
                <div className="grid grid-cols-2 gap-2">
                  {DEST_ASSETS.map((a) => {
                    const active = a === destAsset;
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setDestAsset(a)}
                        className={`p-4 rounded-lg font-mono text-sm border transition-colors ${
                          active
                            ? "border-accent text-accent bg-accent/10"
                            : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {DESTINATIONS[a].label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Chain + token + amount */}
              <Field label="Source Chain">
                <select
                  value={chain}
                  onChange={(e) => setChain(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg p-4 font-mono text-sm focus:outline-none focus:border-accent"
                >
                  {chains?.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={`You Send (${token})`}>
                <div className="flex items-center gap-3 bg-secondary border border-border p-4 rounded-lg focus-within:border-accent">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-transparent border-none outline-none font-mono text-2xl w-full text-foreground"
                  />
                  <select
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="bg-background border border-border px-3 py-2 rounded-md font-mono text-xs focus:outline-none"
                  >
                    {tokenOptions.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </Field>

              <Field label={`Recipient ${destConfig.label} Address`}>
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
                          href="https://wallet.texitcoin.org"
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
                    Must be a {destConfig.label} address (starts with T, 34 chars)
                  </div>
                ) : null}
              </Field>

              {/* Quote breakdown */}
              <div className="bg-secondary/50 rounded-lg p-4 space-y-2 text-xs font-mono">
                <Row
                  label="You receive"
                  value={`${assetOut} ${destConfig.label}`}
                  strong
                />
                <Row
                  label="Spot price"
                  value={quote?.ok ? `$${quote.spotPriceUsd.toFixed(6)}` : "—"}
                />
                <Row
                  label="Effective rate (+5%)"
                  value={quote?.ok ? `$${quote.effectivePriceUsd.toFixed(6)}` : "—"}
                />
                <div className="border-t border-border/50 pt-2 mt-2">
                  <Row
                    label="Premium retained"
                    value={
                      quote?.ok && usdAmount > 0
                        ? `$${(usdAmount * 0.05 / 1.05).toFixed(2)}`
                        : "—"
                    }
                  />
                </div>
              </div>

              {error ? (
                <div className="text-xs font-mono text-accent border border-accent/40 p-3 rounded">
                  {error}
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
                Quote valid for 15 minutes once you confirm. Minimum $10.
              </p>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
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
