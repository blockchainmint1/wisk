import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getQuote } from "@/lib/quote.functions";

function PricePill({ label, price }: { label: string; price: number | null }) {
  return (
    <span className="text-foreground">
      {label}/USDT{" "}
      <span className="text-accent font-bold tracking-normal">
        {price !== null ? `$${price.toFixed(4)}` : "—"}
      </span>
    </span>
  );
}

export function LiveTicker() {
  const fn = useServerFn(getQuote);

  const isk = useQuery({
    queryKey: ["spot-ticker", "ISK"],
    queryFn: () => fn({ data: { usdAmount: 1, destAsset: "ISK" } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const iskPrice = isk.data?.ok ? isk.data.spotPriceUsd : null;

  return (
    <>
      <PricePill label="ISK" price={iskPrice} />
      <PricePill label="wISK" price={iskPrice} />
      <span className="text-muted-foreground">WRAP 5% · UNWRAP FREE</span>
    </>
  );
}

