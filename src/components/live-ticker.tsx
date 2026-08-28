import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getQuote } from "@/lib/quote.functions";

export function LiveTicker() {
  const fn = useServerFn(getQuote);

  const quote = useQuery({
    queryKey: ["bridge-quote", "ISK"],
    queryFn: () => fn({ data: { destAsset: "ISK" } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const wrapPct = quote.data?.ok ? quote.data.wrapFeeBps / 100 : null;
  const unwrapPct = quote.data?.ok ? quote.data.unwrapFeeBps / 100 : null;
  const fmt = (n: number) => `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}%`;

  return (
    <>
      <span className="text-foreground">
        1 ISK <span className="text-accent font-bold tracking-normal">=</span> 1 wISK
      </span>
      <span className="text-muted-foreground">
        WRAP {wrapPct !== null ? fmt(wrapPct) : "—"} · UNWRAP{" "}
        {unwrapPct !== null ? (unwrapPct === 0 ? "FREE" : fmt(unwrapPct)) : "—"}
      </span>
    </>
  );
}
