import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getQuote } from "@/lib/quote.functions";

export function LiveTicker() {
  const fn = useServerFn(getQuote);
  const { data } = useQuery({
    queryKey: ["spot-ticker"],
    queryFn: () => fn({ data: { usdAmount: 1 } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const price = data?.ok ? data.spotPriceUsd : null;
  return (
    <>
      <span className="text-foreground">
        TXC/USDT{" "}
        <span className="text-accent font-bold tracking-normal">
          {price !== null ? `$${price.toFixed(4)}` : "—"}
        </span>
      </span>
      <span className="text-muted-foreground">+5% PREMIUM</span>
    </>
  );
}
