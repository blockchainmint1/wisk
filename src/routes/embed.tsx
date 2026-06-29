import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { z } from "zod";
import { EmbedResize } from "@/components/embed-resize";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DEST_ASSETS, DESTINATIONS, type DestAsset } from "@/lib/destinations";
import { createOrder, listChainOptions } from "@/lib/orders.functions";
import { getQuote } from "@/lib/quote.functions";

const EmbedSearch = z.object({
  asset: z.enum(DEST_ASSETS as [DestAsset, ...DestAsset[]]).optional(),
  assets: z.string().optional(), // comma-separated, e.g. "TXC,ISK$"
  amount: z.coerce.number().positive().optional(),
  chain: z.string().optional(),
  token: z.string().optional(),
  theme: z.enum(["dark", "light"]).optional(),
});

export const Route = createFileRoute("/embed")({
  validateSearch: (s) => EmbedSearch.parse(s),
  head: () => ({
    meta: [
      { title: "Swap embed" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Embeddable swap widget for stablecoins → TXC / ISK$." },
    ],
  }),
  component: EmbedPage,
});

function EmbedPage() {
  const search = Route.useSearch();
  const listChains = useServerFn(listChainOptions);
  const quoteFn = useServerFn(getQuote);
  const createFn = useServerFn(createOrder);

  const { data: chains } = useQuery({
    queryKey: ["chains"],
    queryFn: () => listChains(),
    staleTime: Infinity,
  });

  const [chain, setChain] = useState<string>(search.chain ?? "ethereum");
  const [token, setToken] = useState<string>(search.token ?? "USDC");
  const [amount, setAmount] = useState<string>(String(search.amount ?? 1000));
  const destAsset: DestAsset = search.asset ?? "TXC";




  const [dest, setDest] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Apply theme from query param (override the boot script). Embeds usually pin theme.
  if (typeof document !== "undefined" && search.theme) {
    const root = document.documentElement;
    if (search.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }

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

  const chainOpt = chains?.find((c) => c.key === chain);
  const tokenOptions = chainOpt?.tokens ?? [{ symbol: "USDC", isNative: false }];
  if (chainOpt && !tokenOptions.some((t) => t.symbol === token)) {
    setToken(tokenOptions[0].symbol);
  }
  const selectedTokenIsNative = tokenOptions.find((t) => t.symbol === token)?.isNative === true;
  const formValid = usdAmount >= 10 && addressValid && quote?.ok === true;

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      return createFn({
        data: {
          sourceChain: chain as "ethereum" | "base" | "arbitrum" | "polygon" | "bsc",
          sourceToken: token,
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
      // Notify parent so the host can navigate top-level if it wants to.
      if (typeof window !== "undefined" && window.parent !== window) {
        window.parent.postMessage(
          { type: "swap-embed:order-created", orderId: id, url: `https://swap.honest.money/swap/${id}` },
          "*",
        );
      }
      // Stay inside the iframe by default.
      window.location.href = `/swap/${id}?embed=1`;
    },
    onError: (e: Error) => setError(e?.message || "Order creation failed."),
  });

  return (
    <div className="min-h-[600px] bg-background text-foreground p-4">
      <EmbedResize />
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Swap to <span className="text-accent">{destConfig.label}</span>
          </div>
          <a
            href={`https://swap.honest.money/swap`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground hover:text-accent"
          >
            swap.honest.money ↗
          </a>
        </div>

        <div className="bg-background border border-border rounded-xl p-5 space-y-4">
          {/* Embed is TXC-only */}


          <Field label="Source Chain">
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="w-full bg-secondary border border-border rounded-lg p-3 font-mono text-sm focus:outline-none focus:border-accent"
            >
              {chains?.map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </select>
          </Field>

          <Field label={`You Send (${token === "ETH" ? "USD value in ETH" : token})`}>
            <div className="flex items-center gap-3 bg-secondary border border-border p-3 rounded-lg focus-within:border-accent">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent border-none outline-none font-mono text-xl w-full text-foreground"
              />
              <select
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="bg-background border border-border px-3 py-1.5 rounded-md font-mono text-xs focus:outline-none"
              >
                {tokenOptions.map((t) => (
                  <option key={t.symbol} value={t.symbol}>
                    {t.symbol}{t.isNative ? " (native)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {selectedTokenIsNative ? (
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest px-1">
                Amount is USD; we'll show the exact {token} amount on the next screen.
              </div>
            ) : null}
          </Field>

          <Field label={`Recipient ${destConfig.label} Address`}>
            <div className="flex gap-2">
              <input
                type="text"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder={destConfig.addressHint}
                className="flex-1 bg-secondary border border-border p-3 rounded-lg font-mono text-xs focus:outline-none focus:border-accent"
              />
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={destConfig.walletUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Get a wallet"
                      className="shrink-0 flex items-center justify-center px-3 bg-secondary border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
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
                Invalid {destConfig.label} address
              </div>
            ) : null}
          </Field>

          <div className="bg-secondary/50 rounded-lg p-3 space-y-1.5 text-xs font-mono">
            <Row label="You receive" value={`${assetOut} ${destConfig.label}`} strong />
            <Row label="Spot price" value={quote?.ok ? `$${quote.spotPriceUsd.toFixed(6)}` : "—"} />
            <Row label="Effective (+5%)" value={quote?.ok ? `$${quote.effectivePriceUsd.toFixed(6)}` : "—"} />
          </div>

          {error ? (
            <div className="text-xs font-mono text-accent border border-accent/40 p-3 rounded">
              {error}
            </div>
          ) : null}

          <button
            onClick={() => mutation.mutate()}
            disabled={!formValid || mutation.isPending}
            className="w-full bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-accent-foreground font-mono font-bold py-4 rounded-lg transition-all uppercase tracking-widest text-sm"
          >
            {mutation.isPending ? "Creating Order…" : "Get Payment Address"}
          </button>

          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest text-center">
            Powered by swap.honest.money · 5% protocol fee · min $10
          </p>
        </div>
      </div>
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
