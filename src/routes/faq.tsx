import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

const CONTRACT = "0xFB38867D064Df981F159b886007F1273a346b0BB";

const FAQS: Array<{ q: string; a: ReactNode }> = [
  {
    q: "What is this?",
    a: (
      <>
        A custodial bridge between native Iskander Coin (ISK) and its ERC-20 twin on Ethereum,{" "}
        <a
          href="https://iskandercoin.com/wisk"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-2 hover:text-accent"
        >
          wISK ({CONTRACT})
        </a>
        . wISK is minted when you wrap and burned when you unwrap, so total supply always equals
        the ISK held in the bridge reserve — 1:1, verifiable on both chains.
      </>
    ),
  },
  {
    q: "How much does it cost?",
    a: "Wrap (ISK → wISK) is 5%. Unwrap (wISK → ISK) is free. Fees are set by the operator and shown live on the swap form before you confirm.",
  },
  {
    q: "Why custodial and not a smart contract?",
    a: "The ISK side has no smart contracts — it's a Bitcoin-derived chain — so somebody has to custody the native coin. We keep that side deliberately simple: one operator wallet, and a wISK contract that only mints against a confirmed ISK deposit and only burns on unwrap. There is no pre-mined float sitting around, so wISK total supply is a live proof-of-reserves number anyone can check.",
  },
  {
    q: "Which networks and tokens can I send from?",
    a: "Native ISK on the Iskander Coin network, or wISK on Ethereum. We do not offer stablecoin or ETH on-ramp swaps.",
  },
  {
    q: "Which assets can I receive?",
    a: "Native ISK (paid to any ISK address — legacy K… or SegWit isk1q…) or wISK (paid to any Ethereum 0x… address).",
  },
  {
    q: "How long does a swap take?",
    a: "Around 5 minutes end-to-end. We wait for chain-specific confirmations on your deposit, then sign and broadcast the payout from the hot wallet. Slower chains (Ethereum mainnet) take longer than the Iskander Coin network.",
  },
  {
    q: "What if I send the wrong token or wrong chain?",
    a: "Funds sent on an unsupported chain or with an unsupported token aren't picked up automatically. Contact the Help Center with your order ID and deposit tx hash — manual recovery may be possible.",
  },
  {
    q: "What if my destination address is wrong?",
    a: "We can only send to the address you provided at order creation. Double-check before confirming — payouts can't be reversed.",
  },
  {
    q: "What happens if the quote expires before I pay?",
    a: "Each quote is valid for the expiry window shown on the order page (15 minutes by default). Late deposits are held for manual reconciliation — contact support with your order ID.",
  },
  {
    q: "Do you take custody of my funds?",
    a: "Yes — that's the model. The bridge is custodial by design. The ISK backing wISK stays in the operator wallet for as long as that wISK is in circulation, and is released the moment it's burned on unwrap.",
  },
  {
    q: "Where can I track my swap?",
    a: "After creating an order you're redirected to a live status page that auto-refreshes through every stage. Your browser also keeps a local history of recent swaps on /swap.",
  },
  {
    q: "Is there a minimum or maximum order size?",
    a: "Minimums and maximums are shown live on the swap form and enforced at order creation. They can change based on hot-wallet liquidity and operator limits.",
  },
];

const SCHEMA_TEXTS = [
  `A custodial bridge between native Iskander Coin (ISK) and its ERC-20 twin on Ethereum, wISK (${CONTRACT}). One operator wallet holds real ISK 1:1 against every wISK in circulation.`,
  "Wrap (ISK → wISK) is 5%. Unwrap (wISK → ISK) is free. Fees are set by the operator and shown live on the swap form before you confirm.",
  "By choice. A one-operator hot wallet with a public reconciliation dashboard is simpler, cheaper to run, and easier to audit than a contract we'd have to trust ourselves to secure. ISK held by the bridge matches wISK in circulation — publicly checkable at any time.",
  "Native ISK on the Iskander Coin network, or wISK on Ethereum. We do not offer stablecoin or ETH on-ramp swaps.",
  "Native ISK (paid to any ISK address — legacy K… or SegWit isk1q…) or wISK (paid to any Ethereum 0x… address).",
  "Around 5 minutes end-to-end. We wait for chain-specific confirmations on your deposit, then sign and broadcast the payout from the hot wallet. Slower chains (Ethereum mainnet) take longer than the Iskander Coin network.",
  "Funds sent on an unsupported chain or with an unsupported token aren't picked up automatically. Contact the Help Center with your order ID and deposit tx hash — manual recovery may be possible.",
  "We can only send to the address you provided at order creation. Double-check before confirming — payouts can't be reversed.",
  "Each quote is valid for the expiry window shown on the order page (15 minutes by default). Late deposits are held for manual reconciliation — contact support with your order ID.",
  "Yes — that's the model. The bridge is custodial by design. ISK backing wISK lives in the operator wallet full-time while the wISK is in circulation.",
  "After creating an order you're redirected to a live status page that auto-refreshes through every stage. Your browser also keeps a local history of recent swaps on /swap.",
  "Minimums and maximums are shown live on the swap form and enforced at order creation. They can change based on hot-wallet liquidity and operator limits.",
];

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — SWAP" },
      {
        name: "description",
        content:
          "Common questions about the ISK ↔ wISK bridge — fees, timing, supported networks, and recovery.",
      },
      { property: "og:title", content: "FAQ — SWAP" },
      {
        property: "og:description",
        content:
          "Common questions about the ISK ↔ wISK bridge.",
      },
      { property: "og:url", content: "https://wisk.iskandercoin.com/faq" },
    ],
    links: [{ rel: "canonical", href: "https://wisk.iskandercoin.com/faq" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f, i) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: SCHEMA_TEXTS[i] },
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
              href="https://help.honest.money"
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
