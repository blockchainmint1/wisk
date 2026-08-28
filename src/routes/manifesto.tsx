import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

const TITLE = "Manifesto — Why the wISK Bridge Exists";
const DESCRIPTION =
  "The principles behind the wISK bridge: one for one, no pre-mine, supply that equals reserves, and a custodian that tells you it is a custodian.";

export const Route = createFileRoute("/manifesto")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://wisk.iskandercoin.com/manifesto" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://wisk.iskandercoin.com/manifesto" }],
  }),
  component: ManifestoPage,
});

const TENETS: Array<{ n: string; title: string; body: string }> = [
  {
    n: "01",
    title: "One for one. Always.",
    body:
      "A wrap is not a trade. You are not selling ISK and buying something else, and we are not taking a position against you. Send one ISK, get one wISK, less a published fee. There is no spread, no slippage, and no reference to any currency — the number of coins in equals the number of tokens out.",
  },
  {
    n: "02",
    title: "No pre-mine. Supply equals reserves.",
    body:
      "The wISK contract started at zero and stays honest by construction. Tokens are minted only when a deposit confirms and burned the moment someone unwraps. That makes total supply a live proof-of-reserves figure: read it off Ethereum, compare it to the ISK in the reserve, and the two match. Nobody has to take our word for it.",
  },
  {
    n: "03",
    title: "We are a custodian, and we say so.",
    body:
      "Iskander Coin is a Bitcoin-derived chain with no smart contracts, so somebody has to hold the native coin. Pretending otherwise would be the dishonest part. We hold it in one operator wallet, we tell you that plainly on every page, and we keep the surface area small enough to actually audit.",
  },
  {
    n: "04",
    title: "Boring beats clever.",
    body:
      "Bridges get drained because they are complicated. Ours is deliberately dull: a standard ERC-20 with mint and burn behind role control, a kill switch, and a deposit watcher that refuses anything it has already credited or anything mined before your order existed. Fewer moving parts, fewer ways to lose your money.",
  },
  {
    n: "05",
    title: "Your keys on both ends.",
    body:
      "We custody the reserve, never your wallet. You give us a destination address, we pay it, and the relationship ends. There are no accounts, no balances held on your behalf, and nothing to withdraw later. The only window in which we hold anything of yours is the few minutes between your deposit confirming and the payout broadcasting.",
  },
  {
    n: "06",
    title: "Fees you can read before you commit.",
    body:
      "The wrap and unwrap fees are shown on the swap form and in the footer of every page, pulled live from the same configuration the bridge itself uses. Changing them can never reach backwards into an order you already created.",
  },
];

function ManifestoPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 py-16 md:py-24">
        <div className="mb-16">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Principles
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tighter leading-none">
            THE <span className="text-accent">MANIFESTO</span>
          </h1>
          <p className="text-base text-muted-foreground mt-6 max-w-prose leading-relaxed">
            Wrapped assets have a bad reputation, and mostly they have earned it. Opaque reserves,
            supply nobody can reconcile, and operators who describe themselves as decentralised
            right up until the withdrawals stop. This bridge is built the other way round.
          </p>
        </div>

        <div className="space-y-12">
          {TENETS.map((t) => (
            <section key={t.n} className="grid grid-cols-[auto_1fr] gap-6">
              <div className="font-mono text-xs text-accent pt-1">{t.n}</div>
              <div className="space-y-3">
                <h2 className="text-lg font-bold tracking-tight text-foreground">{t.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{t.body}</p>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-20 border-t border-border pt-10 space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
            The wISK bridge is part of the{" "}
            <a
              href="https://honest.money"
              className="text-accent underline underline-offset-2"
            >
              honest.money
            </a>{" "}
            ecosystem — a set of tools built on the premise that sound money only works if the
            plumbing around it is legible to the people using it.
          </p>
          <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-widest pt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              ← Home
            </Link>
            <Link to="/swap" className="text-accent hover:underline">
              Start a swap →
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
