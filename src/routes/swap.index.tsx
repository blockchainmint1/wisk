import { createFileRoute } from "@tanstack/react-router";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { SwapForm } from "@/components/swap-form";
import { SwapHistory } from "@/components/swap-history";

export const Route = createFileRoute("/swap/")({
  head: () => ({
    meta: [
      { title: "Swap — wISK ↔ ISK Bridge" },
      {
        name: "description",
        content:
          "Swap wISK ↔ ISK 1:1. Locked quote, direct payout to the address you choose.",
      },
      { property: "og:title", content: "Swap — wISK ↔ ISK Bridge" },
      {
        property: "og:description",
        content: "Bidirectional wISK ↔ ISK bridge.",
      },
    ],
  }),
  component: SwapPage,
});

function SwapPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader ticker={<LiveTicker />} />
      <main className="max-w-xl mx-auto px-4 py-12 md:py-20">
        <div className="mb-10 text-center">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter leading-none">
            Swap <span className="text-accent">wISK ↔ ISK</span>
          </h1>
        </div>

        <SwapForm />

        <div className="mt-10">
          <SwapHistory />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
