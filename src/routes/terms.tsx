import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — wISK Bridge" },
      {
        name: "description",
        content:
          "Terms of use for the wISK bridge: eligibility, custodial model, fees, risks, and liability for wrapping ISK into wISK and back.",
      },
      { property: "og:title", content: "Terms of Use — wISK Bridge" },
      {
        property: "og:description",
        content:
          "Terms of use for the ISK ↔ wISK custodial bridge — eligibility, fees, risks, and liability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
              By accessing or using the wISK bridge ("the Protocol"), you agree to be bound by these Terms of Use. If you do not agree, do not use the Protocol. These terms constitute a legally binding agreement between you and the Protocol operators.
            </p>
          </Section>

          <Section title="2. Service Description">
            <p>
              The Protocol operates a custodial bridge between native Iskander Coin (ISK) and its ERC-20 representation on Ethereum, wISK (contract 0xFB38867D064Df981F159b886007F1273a346b0BB). Wrapping mints new wISK against a confirmed ISK deposit held in the operator wallet; unwrapping burns wISK and releases the corresponding ISK. wISK total supply therefore equals the ISK reserve at all times. Swaps are one-for-one on quantity, less the applicable protocol fee. The Protocol does not operate a stablecoin or fiat on-ramp and does not price swaps against any currency.
            </p>
          </Section>

          <Section title="3. Eligibility">
            <p className="mb-4">You represent and warrant that you:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Are at least 18 years of age or the legal age of majority in your jurisdiction.</li>
              <li>Have the legal capacity to enter into these terms.</li>
              <li>Are not located in, under the control of, or a national or resident of any jurisdiction where use of the service is prohibited by law.</li>
              <li>Are not on any sanctions list maintained by the United States, European Union, United Nations, or other applicable authority.</li>
            </ul>
          </Section>

          <Section title="4. Custodial Nature">
            <p>
              The Protocol is custodial by design. ISK backing wISK in circulation is held in an operator wallet for as long as that wISK exists. Deposits are held for the window between confirmation and payout. You retain sole control of your own wallets and are solely responsible for the accuracy of destination addresses you provide.
            </p>
          </Section>

          <Section title="5. Fees">
            <ul className="list-disc list-inside space-y-2">
              <li>Swaps are one-for-one on quantity. A protocol fee is deducted from the amount you receive.</li>
              <li>The current wrap and unwrap fees are displayed on the swap form and in the site footer before you confirm an order, and are the fees that apply to that order.</li>
              <li>Fees may be changed by the operator at any time; a change never affects an order already created.</li>
              <li>Network transaction fees for your deposit are borne by you and are separate from the protocol fee.</li>
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
              <li><strong>Custodial risk:</strong> ISK backing wISK is held by the operator. Loss, compromise, or seizure of the operator wallet could affect your ability to unwrap.</li>
              <li><strong>Smart contract risk:</strong> The wISK contract governs minting and burning on Ethereum. Interacting with any contract carries technical risk.</li>
              <li><strong>Availability risk:</strong> Bridge operations depend on both the Iskander Coin and Ethereum networks and on third-party node providers, any of which may be unavailable or delayed.</li>
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
              <a href="mailto:support@iskandercoin.com" className="text-accent underline">support@iskandercoin.com</a>.
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
