import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "What does swapTXC actually do?",
    a: "You send a stablecoin (USDC, USDT, DAI, PYUSD, FRAX, TUSD, USDP, USDe) or native ETH on a supported EVM chain. We deliver the equivalent value in native TXC, ISK$ or ZCU directly to your wallet on its native chain. No bridges, no wrapped tokens.",
  },
  {
    q: "What is the fee?",
    a: "A flat 5% protocol fee is baked into the quote you see at order creation. The quote is locked the moment you confirm — what you see is what you get.",
  },
  {
    q: "Which networks and tokens can I send from?",
    a: "Ethereum (USDC, USDT, DAI, PYUSD, FRAX, TUSD, USDP, USDe, native ETH), Base (USDC, USDbC, USDT, native ETH), Arbitrum (USDC, USDC.e, USDT, DAI, FRAX, native ETH), Polygon (USDC, USDC.e, USDT, DAI), and BNB Chain (USDT, USDC). Native ETH is priced live at the moment we detect your deposit, so the USD-equivalent floats with the market until then.",
  },
  {
    q: "Which native assets can I receive?",
    a: "TEXITcoin (TXC) on the TXC network, Iskander Coin (ISK$) on the ISK network, and Zero Chill Units (ZCU) when listed. Each is paid out to the native address you provide at order creation.",
  },
  {
    q: "How long does a swap take?",
    a: "Typical end-to-end time is around 5 minutes. We wait for chain-specific confirmations on your deposit, then sign and broadcast the native payout from our hot wallet. Slower source chains (Ethereum mainnet) take longer than fast L2s.",
  },
  {
    q: "What if I send the wrong token or wrong chain?",
    a: "Funds sent on an unsupported chain or with an unsupported token will not be picked up automatically. Contact us via the Help Center with your order ID and the deposit transaction hash — manual recovery may be possible.",
  },
  {
    q: "What if my destination address is wrong?",
    a: "We can only send to the address you provided at order creation. Double-check it before confirming. Once a native withdrawal is broadcast it cannot be reversed.",
  },
  {
    q: "What happens if the quote expires before I pay?",
    a: "Each quote is valid for the expiry window shown on the order page (15 minutes by default). If you pay after expiry, the order is marked expired and the deposit waits for manual reconciliation — contact support with your order ID.",
  },
  {
    q: "Do you take custody of my funds?",
    a: "Only for the brief window between your deposit confirming and the native payout being broadcast. We do not hold funds on your behalf beyond that swap window.",
  },
  {
    q: "Where can I track my swap?",
    a: "After creating an order you are redirected to a live status page. The page auto-refreshes through every stage and remains accessible — your browser also keeps a local history of recent swaps on /swap.",
  },
  {
    q: "Is there a minimum or maximum order size?",
    a: "Yes. The current minimum is $10 and maximum is $50,000 per order. These limits are shown live on the swap form.",
  },
];

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — swapTXC" },
      {
        name: "description",
        content:
          "Common questions about swapping stablecoins for native TXC, ISK$ or ZCU on swapTXC — fees, timing, supported networks, and recovery.",
      },
      { property: "og:title", content: "FAQ — swapTXC" },
      {
        property: "og:description",
        content:
          "Common questions about swapping stablecoins for native TXC, ISK$ or ZCU.",
      },
      { property: "og:url", content: "https://swap.honest.money/faq" },
    ],
    links: [{ rel: "canonical", href: "https://swap.honest.money/faq" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 py-16 md:py-24">
        <div className="mb-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Help
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter leading-none">
            Frequently <span className="text-accent">Asked</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-4 max-w-prose">
            The short answers. For anything else,{" "}
            <a
              href="https://help.minetxc.com"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              hit the Help Center
            </a>
            .
          </p>
        </div>

        <div className="space-y-10">
          {FAQS.map((f) => (
            <section key={f.q}>
              <h2 className="text-base font-bold tracking-tight mb-2">{f.q}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
            </section>
          ))}
        </div>

        <div className="mt-16 border-t border-border pt-8 flex justify-between items-center text-[10px] font-mono uppercase tracking-widest">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            ← Home
          </Link>
          <Link to="/swap" className="text-accent hover:underline">
            Start a swap →
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
