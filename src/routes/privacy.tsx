import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — wISK Bridge" },
      {
        name: "description",
        content:
          "What the wISK bridge collects, why, who it is shared with, and how long it is kept when you wrap ISK into wISK or unwrap it.",
      },
      { property: "og:title", content: "Privacy Policy — wISK Bridge" },
      {
        property: "og:description",
        content: "What the wISK bridge collects, why, and how long it is kept.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 py-16 md:py-24">
        <div className="space-y-2 mb-12">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Legal
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground">Last updated: June 7, 2026</p>
        </div>

        <div className="space-y-12 text-sm leading-relaxed text-muted-foreground">
          <Section title="1. Overview">
            <p>
              This Privacy Policy describes how the wISK bridge collects, uses, and protects your information when you wrap native Iskander Coin (ISK) into wISK or unwrap it back. By using the protocol, you consent to the practices described herein.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <p className="mb-4">We collect minimal information necessary to process swaps:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>On-chain data:</strong> Wallet addresses, transaction hashes, and deposit/withdrawal details required to execute swaps.</li>
              <li><strong>Destination addresses:</strong> Native ISK or wISK wallet addresses provided for settlement.</li>
              <li><strong>Contact information:</strong> Optional email or Telegram handle if you choose to receive order status notifications.</li>
              <li><strong>Technical data:</strong> IP addresses and browser metadata for fraud prevention and service security.</li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Information">
            <ul className="list-disc list-inside space-y-2">
              <li>To process and settle wrap and unwrap orders between ISK and wISK.</li>
              <li>To communicate order status, confirmations, and important service updates.</li>
              <li>To detect and prevent fraud, abuse, or unauthorized access.</li>
              <li>To comply with legal obligations and respond to lawful requests.</li>
            </ul>
          </Section>

          <Section title="4. Data Sharing & Disclosure">
            <p className="mb-4">We do not sell your personal data. We may share information only with:</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong>Infrastructure providers:</strong> Hosting, blockchain node providers, and notification services, limited to the data needed to run the bridge.</li>
              <li><strong>Legal authorities:</strong> When required by applicable law, regulation, or court order.</li>
            </ul>
          </Section>

          <Section title="5. Blockchain Data">
            <p>
              All blockchain transactions are public and immutable. Your wallet addresses, transaction amounts, and on-chain activity are permanently recorded on the respective blockchains and are not within our control to delete or modify.
            </p>
          </Section>

          <Section title="6. Security">
            <p>
              We implement industry-standard security measures to protect your data, including encrypted communications, access controls, and regular security audits. However, no system is completely secure. You are responsible for safeguarding your wallet private keys and credentials.
            </p>
          </Section>

          <Section title="7. Your Rights">
            <p className="mb-4">Depending on your jurisdiction, you may have the right to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Access, correct, or delete personal data we hold about you.</li>
              <li>Object to or restrict certain processing activities.</li>
              <li>Withdraw consent for optional communications at any time.</li>
            </ul>
            <p className="mt-4">Contact us at <a href="mailto:support@iskandercoin.com" className="text-accent underline">support@iskandercoin.com</a> to exercise these rights.</p>
          </Section>

          <Section title="8. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated effective date. Continued use of the service after changes constitutes acceptance.
            </p>
          </Section>

          <Section title="9. Contact">
            <p>
              For questions about this Privacy Policy or our data practices, contact us at{" "}
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
