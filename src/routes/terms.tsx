import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — swapTXC" },
      {
        name: "description",
        content: "Terms of use for swapTXC stablecoin-to-native swap protocol.",
      },
      { property: "og:title", content: "Terms of Use — swapTXC" },
      {
        property: "og:description",
        content: "Terms of use for swapTXC stablecoin-to-native swap protocol.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 py-16 md:py-24">
        <div className="space-y-2 mb-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Legal
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            Terms of Use
          </h1>
          <p className="text-sm text-muted-foreground">Last updated: June 7, 2026</p>
        </div>

        <div className="space-y-12 text-sm leading-relaxed text-muted-foreground">
          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using swapTXC ("the Protocol"), you agree to be bound by these Terms of Use. If you do not agree, do not use the Protocol. These terms constitute a legally binding agreement between you and the Protocol operators.
            </p>
          </Section>

          <Section title="2. Service Description">
            <p>
              swapTXC operates a non-custodial swap service allowing users to exchange ERC-20 stablecoins (USDC, USDT, pyUSD, DAI, and others) on supported EVM chains for native TXC, ISK$, or ZCU assets on the TEXITcoin / IskanderCoin chain. The Protocol sources liquidity from Bitmart and applies a fixed 5% protocol premium above the live spot price.
            </p>
          </Section>

          <Section title="3. Eligibility">
            <p className="mb-4">You represent and warrant that you:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Are at least 18 years of age or the legal age of majority in your jurisdiction.</li>
              <li>Have the legal capacity to enter into these terms.</li>
              <li>Are not located in, under the control of, or a national or resident of any jurisdiction where use of the Protocol is prohibited by law.</li>
              <li>Are not on any sanctions list maintained by the United States, European Union, United Nations, or other applicable authority.</li>
            </ul>
          </Section>

          <Section title="4. Non-Custodial Nature">
            <p>
              The Protocol is non-custodial. You retain sole control of your wallet private keys at all times. We do not hold, store, or have access to your private keys or recovery phrases. You are solely responsible for the security of your wallets and the accuracy of destination addresses you provide.
            </p>
          </Section>

          <Section title="5. Fees & Pricing">
            <ul className="list-disc list-inside space-y-2">
              <li>A fixed 5.00% protocol premium is applied to all swaps above the live Bitmart spot price.</li>
              <li>Network gas fees for deposit transactions are borne by the user and are separate from the Protocol fee.</li>
              <li>Quotes are valid for a limited time window and are locked at the moment of confirmation.</li>
              <li>All fees are non-refundable once a swap has been initiated and confirmed on-chain.</li>
            </ul>
          </Section>

          <Section title="6. User Responsibilities">
            <p className="mb-4">You agree to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Provide accurate and valid wallet addresses for deposits and withdrawals.</li>
              <li>Verify all transaction details before confirming a swap.</li>
              <li>Comply with all applicable laws, regulations, and tax obligations in your jurisdiction.</li>
              <li>Not use the Protocol for money laundering, fraud, sanctions evasion, or any unlawful purpose.</li>
            </ul>
          </Section>

          <Section title="7. Risks">
            <p className="mb-4">You acknowledge and accept the following risks inherent in using the Protocol:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Blockchain risk:</strong> Transactions are irreversible. Incorrect addresses may result in permanent loss of funds.</li>
              <li><strong>Price volatility:</strong> Market prices can fluctuate between quote and settlement.</li>
              <li><strong>Smart contract risk:</strong> While the Protocol minimizes on-chain exposure, interacting with any blockchain carries technical risks.</li>
              <li><strong>Third-party risk:</strong> Liquidity sourcing depends on Bitmart and other exchange partners.</li>
              <li><strong>Regulatory risk:</strong> Cryptocurrency regulations may change and affect your use of the Protocol.</li>
            </ul>
          </Section>

          <Section title="8. Limitation of Liability">
            <p>
              To the maximum extent permitted by law, the Protocol, its operators, affiliates, and service providers shall not be liable for any direct, indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Protocol, including but not limited to loss of funds, data, profits, or business opportunities.
            </p>
          </Section>

          <Section title="9. Dispute Resolution">
            <p>
              Any dispute arising from these terms shall first be addressed through good-faith negotiation. If unresolved, disputes shall be submitted to binding arbitration in a mutually agreed jurisdiction, conducted in English, in accordance with the rules of a recognized arbitration body.
            </p>
          </Section>

          <Section title="10. Modifications">
            <p>
              We reserve the right to modify these Terms of Use at any time. Material changes will be communicated through the Protocol interface or via the channels you have provided. Continued use after changes constitutes acceptance of the revised terms.
            </p>
          </Section>

          <Section title="11. Termination">
            <p>
              We may suspend or terminate your access to the Protocol at any time, with or without cause, including for violation of these terms or applicable law. Suspension does not relieve you of obligations arising from pending swaps.
            </p>
          </Section>

          <Section title="12. Contact">
            <p>
              For questions about these Terms of Use, contact us at{" "}
              <a href="mailto:support@texitcoin.org" className="text-accent underline">support@texitcoin.org</a>.
            </p>
          </Section>
        </div>

        <div className="mt-16 border-t border-border pt-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors"
          >
            ← Back to Home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold text-foreground tracking-tight">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
