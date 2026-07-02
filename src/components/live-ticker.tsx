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

  const txc = useQuery({
    queryKey: ["spot-ticker", "TXC"],
    queryFn: () => fn({ data: { usdAmount: 1, destAsset: "TXC" } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const txcPrice = txc.data?.ok ? txc.data.spotPriceUsd : null;

  return (
    <>
      <PricePill label="TXC" price={txcPrice} />
      <PricePill label="wTXC" price={txcPrice} />
      <span className="text-muted-foreground">WRAP 0% · UNWRAP 1% · ON-RAMP +5%</span>
    </>
  );
}

