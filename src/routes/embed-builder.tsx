import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { DESTINATIONS } from "@/lib/destinations";

export const Route = createFileRoute("/embed-builder")({
  head: () => ({
    meta: [
      { title: "Embed the swap on your site — SWAP" },
      {
        name: "description",
        content:
          "Drop the swap widget into any website with a single iframe snippet. Pre-set destination asset, source chain, amount, and theme.",
      },
    ],
  }),
  component: EmbedBuilder,
});

const ORIGIN = "https://swap.honest.money";

function EmbedBuilder() {
  const [asset, setAsset] = useState<"TXC" | "ISK$">("TXC");
  const [amount, setAmount] = useState<string>("1000");
  const [chain, setChain] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [width, setWidth] = useState<string>("100%");
  const [height, setHeight] = useState<string>("760");
  const [autoResize, setAutoResize] = useState<boolean>(true);
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    const u = new URL(`${ORIGIN}/embed`);
    if (asset) u.searchParams.set("asset", asset);
    if (amount) u.searchParams.set("amount", amount);
    if (chain) u.searchParams.set("chain", chain);
    if (token) u.searchParams.set("token", token);
    if (theme) u.searchParams.set("theme", theme);
    return u.toString();
  }, [asset, amount, chain, token, theme]);

  const snippet = useMemo(() => {
    const widthAttr = /^\d+$/.test(width) ? `${width}` : width;
    const heightAttr = /^\d+$/.test(height) ? `${height}` : height;
    const iframe = `<iframe id="swap-honest-money" src="${url}" style="width:${widthAttr === "100%" ? "100%" : `${widthAttr}px`};height:${/^\d+$/.test(heightAttr) ? `${heightAttr}px` : heightAttr};border:0;background:transparent" allow="clipboard-write" loading="lazy" title="Swap to ${DESTINATIONS[asset].label} — honest.money"></iframe>`;
    const resizer = autoResize
      ? `\n<script>(function(){window.addEventListener("message",function(e){if(!e.data||e.data.type!=="swap-embed:height")return;var f=document.getElementById("swap-honest-money");if(f&&typeof e.data.height==="number")f.style.height=e.data.height+"px"});})();</script>`
      : "";
    return iframe + resizer;
  }, [url, width, height, autoResize, asset]);


  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-5xl mx-auto px-4 py-12 md:py-16">
        <div className="mb-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Distribution Kit
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter leading-none">
            Embed the swap <span className="text-accent">anywhere</span>
          </h1>
          <p className="mt-4 text-muted-foreground max-w-2xl font-mono text-sm">
            Drop this iframe on any site — blog, wallet docs, project page — and your visitors can swap stablecoins for native TXC or ISK$ without leaving. No keys, no SDK, no signup.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <section className="space-y-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              1 · Configure defaults
            </h2>

            <Field label="Destination asset">
              <div className="p-3 rounded-lg font-mono text-sm border border-accent text-accent bg-accent/10">
                {DESTINATIONS.TXC.label} — TEXITcoin (only asset supported in embed)
              </div>
            </Field>


            <Field label="Default USD amount">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-secondary border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Default chain (optional)">
                <select
                  value={chain}
                  onChange={(e) => setChain(e.target.value)}
                  className="w-full bg-secondary border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">(let user pick)</option>
                  <option value="ethereum">Ethereum</option>
                  <option value="base">Base</option>
                  <option value="arbitrum">Arbitrum</option>
                  <option value="polygon">Polygon</option>
                  <option value="bsc">BNB Chain</option>
                </select>
              </Field>
              <Field label="Default token (optional)">
                <input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value.toUpperCase())}
                  placeholder="e.g. USDC"
                  className="w-full bg-secondary border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
                />
              </Field>
            </div>

            <Field label="Theme">
              <div className="grid grid-cols-2 gap-2">
                {(["dark", "light"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTheme(t)}
                    className={`p-3 rounded-lg font-mono text-sm border transition-colors capitalize ${
                      t === theme
                        ? "border-accent text-accent bg-accent/10"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Width (px or %)">
                <input
                  type="text"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  className="w-full bg-secondary border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
                />
              </Field>
              <Field label="Height (px)">
                <input
                  type="text"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  className="w-full bg-secondary border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <input
                type="checkbox"
                checked={autoResize}
                onChange={(e) => setAutoResize(e.target.checked)}
                className="accent-accent"
              />
              Include auto-resize script (recommended)
            </label>
          </section>

          <section className="space-y-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              2 · Copy the snippet
            </h2>
            <div className="relative">
              <pre className="bg-secondary border border-border rounded-lg p-4 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all">
                {snippet}
              </pre>
              <button
                onClick={copy}
                className="absolute top-2 right-2 px-3 py-1 text-[10px] font-mono uppercase tracking-widest border border-border rounded bg-background hover:bg-foreground hover:text-background transition-colors"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground pt-2">
              3 · Live preview
            </h2>
            <div className="border border-border rounded-lg overflow-hidden bg-secondary/30">
              <iframe
                src={url}
                title="Swap embed preview"
                style={{ width: "100%", height: `${Number(height) || 760}px`, border: 0 }}
                allow="clipboard-write"
              />
            </div>

            <div className="text-xs font-mono text-muted-foreground space-y-2 pt-2">
              <p className="text-foreground">Sharing tips</p>
              <p>· The widget is responsive — width:100% inside any container.</p>
              <p>· When a user creates an order we post a <code className="text-accent">swap-embed:order-created</code> message to your page so you can react.</p>
              <p>· No keys or SDK required. Anyone can embed.</p>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest px-1">
        {label}
      </div>
      {children}
    </div>
  );
}
