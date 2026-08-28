import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowDownUp, Wallet } from "lucide-react";
import { z } from "zod";
import { EmbedResize } from "@/components/embed-resize";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DESTINATIONS, type DestAsset } from "@/lib/destinations";
import { createOrder } from "@/lib/orders.functions";
import { getQuote } from "@/lib/quote.functions";

const EmbedSearch = z.object({
  // Which side the user "has" by default. Flip button lets them swap.
  have: z.enum(["wISK", "ISK"]).optional(),
  amount: z.coerce.number().positive().optional(),
  theme: z.enum(["dark", "light"]).optional(),
  // Lock direction — hide the flip button if true.
  lock: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/embed")({
  validateSearch: (s) => EmbedSearch.parse(s),
  head: () => ({
    meta: [
      { title: "wISK ↔ ISK bridge — embed" },
      { name: "robots", content: "noindex" },
      {
        name: "description",
        content: "Embeddable wISK ↔ ISK bridge widget.",
      },
    ],
  }),
  component: EmbedPage,
});

type Side = "wISK" | "ISK";

function EmbedPage() {
  const search = Route.useSearch();
  const quoteFn = useServerFn(getQuote);
  const createFn = useServerFn(createOrder);

  const [have, setHave] = useState<Side>(search.have ?? "wISK");
  const [amount, setAmount] = useState<string>(String(search.amount ?? 100));
  const [dest, setDest] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const want: Side = have === "wISK" ? "ISK" : "wISK";
  const isUnwrap = have === "wISK" && want === "ISK";
  const isWrap = !isUnwrap;
  const destAsset: DestAsset = want;
  const destConfig = DESTINATIONS[destAsset];

  // Apply theme override.
  if (typeof document !== "undefined" && search.theme) {
    const root = document.documentElement;
    if (search.theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }

  const haveAmount = useMemo(() => {
    const n = Number.parseFloat(amount.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amount]);

  const { data: quote } = useQuery({
    queryKey: ["quote", destAsset],
    queryFn: () => quoteFn({ data: { destAsset } }),
    refetchInterval: 15_000,
  });

  const unwrapFeeBps = quote?.ok ? (quote.unwrapFeeBps ?? 100) : 100;
  const wrapFeeBps = quote?.ok ? (quote.wrapFeeBps ?? 0) : 0;
  const unwrapFeePct = unwrapFeeBps / 100;
  const wrapFeePct = wrapFeeBps / 100;

  const wantAmount = useMemo(() => {
    if (haveAmount <= 0) return 0;
    if (isUnwrap) return haveAmount * (1 - unwrapFeeBps / 10_000);
    return haveAmount * (1 - wrapFeeBps / 10_000);
  }, [haveAmount, isUnwrap, unwrapFeeBps, wrapFeeBps]);



  const addressValid = destConfig.addressRegex.test(dest.trim());
  const formValid =
    haveAmount > 0 && addressValid && quote?.ok === true;

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
      if (typeof window !== "undefined" && window.parent !== window) {
        window.parent.postMessage(
          {
            type: "swap-embed:order-created",
            orderId: id,
            url: `https://wisk.iskandercoin.com/swap/${id}`,
          },
          "*",
        );
      }
      window.location.href = `/swap/${id}?embed=1`;
    },
    onError: (e: Error) => setError(e?.message || "Order creation failed."),
  });

  function flip() {
    if (search.lock) return;
    setHave((h) => (h === "wISK" ? "ISK" : "wISK"));
    setDest("");
  }

  return (
    <div className="min-h-[600px] bg-background text-foreground p-4">
      <EmbedResize />
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {isUnwrap ? "Unwrap wISK → ISK" : "Wrap ISK → wISK"}
          </div>
          <a
            href="https://wisk.iskandercoin.com/swap"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground hover:text-accent"
          >
            wisk.iskandercoin.com ↗
          </a>
        </div>

        <div className="bg-background border border-border rounded-xl p-4 space-y-1">
          {/* HAVE */}
          <div className="bg-secondary/60 border border-border rounded-2xl p-4">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Have
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="bg-transparent border-none outline-none font-mono text-3xl w-full text-foreground placeholder:text-muted-foreground/40"
              />
              <SidePill side={have} />
            </div>
          </div>

          {/* FLIP */}
          <div className="relative h-0">
            <button
              type="button"
              onClick={flip}
              disabled={!!search.lock}
              aria-label="Flip direction"
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-background border-4 border-background shadow-lg flex items-center justify-center hover:bg-accent hover:text-accent-foreground transition-colors z-10 ring-1 ring-border disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background disabled:hover:text-foreground"
            >
              <ArrowDownUp className="h-4 w-4" />
            </button>
          </div>

          {/* WANT */}
          <div className="bg-secondary/60 border border-border rounded-2xl p-4 mt-1">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Want
            </div>
            <div className="flex items-center gap-3">
              <div className="font-mono text-3xl w-full text-foreground truncate">
                {wantAmount > 0
                  ? wantAmount.toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })
                  : "0"}
              </div>
              <SidePill side={want} />
            </div>
            <div className="mt-2 text-[10px] font-mono text-muted-foreground">
              1 ISK = 1 wISK
              {isUnwrap ? (
                <span className="ml-2 opacity-70">
                  · {unwrapFeePct.toFixed(unwrapFeePct % 1 === 0 ? 0 : 2)}% fee
                </span>
              ) : wrapFeeBps > 0 ? (
                <span className="ml-2 opacity-70">
                  · {wrapFeePct.toFixed(wrapFeePct % 1 === 0 ? 0 : 2)}% fee
                </span>
              ) : (
                <span className="ml-2 opacity-70">· 1:1, no fee</span>
              )}
            </div>
          </div>

          {/* RECIPIENT */}
          <div className="bg-secondary/40 border border-border rounded-2xl p-4 mt-1">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
              Send {destConfig.label} to
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder={destConfig.addressHint}
                className="flex-1 bg-background border border-border p-3 rounded-lg font-mono text-xs focus:outline-none focus:border-accent"
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
            <div className="mt-3 text-xs font-mono text-accent border border-accent/40 p-3 rounded-xl">
              {error}
            </div>
          ) : null}

          <button
            onClick={() => mutation.mutate()}
            disabled={!formValid || mutation.isPending}
            className="mt-3 w-full bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-accent-foreground font-mono font-bold py-4 rounded-2xl transition-all uppercase tracking-widest text-sm"
          >
            {mutation.isPending
              ? "Creating Order…"
              : haveAmount <= 0
                ? "Enter an amount"
                : !addressValid
                  ? `Enter ${destConfig.label} address`
                  : "Get started"}
          </button>

          <p className="mt-3 text-center text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Powered by wisk.iskandercoin.com · quote locks 15 min
          </p>
        </div>
      </div>
    </div>
  );
}

function SidePill({ side }: { side: Side }) {
  return (
    <div className="shrink-0 flex items-center gap-2 bg-background border border-border rounded-full px-3 py-1.5 font-mono text-sm">
      <span className="font-bold">{side}</span>
    </div>
  );
}
