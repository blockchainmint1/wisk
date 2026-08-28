import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

export const Route = createFileRoute("/embed-builder")({
  head: () => ({
    meta: [
      { title: "Embed the wISK ↔ ISK bridge — snippet builder" },
      {
        name: "description",
        content:
          "Drop the wISK ↔ ISK bridge widget into any website with a single iframe snippet. Pick default direction, amount, and theme.",
      },
    ],
  }),
  component: EmbedBuilder,
});

const ORIGIN = "https://wisk.iskandercoin.com";

type Side = "wISK" | "ISK";

function EmbedBuilder() {
  const [have, setHave] = useState<Side>("wISK");
  const [amount, setAmount] = useState<string>("100");
  const [lock, setLock] = useState<boolean>(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [width, setWidth] = useState<string>("100%");
  const [height, setHeight] = useState<string>("680");
  const [autoResize, setAutoResize] = useState<boolean>(true);
  const [copied, setCopied] = useState(false);

  const buildUrl = (origin: string) => {
    const u = new URL(`${origin}/embed`);
    u.searchParams.set("have", have);
    if (amount) u.searchParams.set("amount", amount);
    if (theme) u.searchParams.set("theme", theme);
    if (lock) u.searchParams.set("lock", "1");
    return u.toString();
  };

  const url = useMemo(() => buildUrl(ORIGIN), [have, amount, lock, theme]);
  const previewUrl = useMemo(
    () =>
      buildUrl(
        typeof window !== "undefined" ? window.location.origin : ORIGIN,
      ),
    [have, amount, lock, theme],
  );

  const want: Side = have === "wISK" ? "ISK" : "wISK";

  const snippet = useMemo(() => {
    const widthAttr = /^\d+$/.test(width) ? `${width}px` : width;
    const heightAttr = /^\d+$/.test(height) ? `${height}px` : height;
    const iframe = `<iframe id="wisk-bridge" src="${url}" style="width:${widthAttr};height:${heightAttr};border:0;background:transparent" allow="clipboard-write" loading="lazy" title="${have} to ${want} bridge"></iframe>`;
    const resizer = autoResize
      ? `\n<script>(function(){window.addEventListener("message",function(e){if(!e.data||e.data.type!=="swap-embed:height")return;var f=document.getElementById("wisk-bridge");if(f&&typeof e.data.height==="number")f.style.height=e.data.height+"px"});})();</script>`
      : "";
    return iframe + resizer;
  }, [url, width, height, autoResize, have, want]);

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
            Embed the bridge <span className="text-accent">anywhere</span>
          </h1>
          <p className="mt-4 text-muted-foreground max-w-2xl font-mono text-sm">
            Drop this iframe on any site — wallet, docs, project page — and
            your visitors can swap wISK ↔ ISK without leaving. No keys, no
            SDK, no signup.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <section className="space-y-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              1 · Configure defaults
            </h2>

            <Field label="Default direction">
              <div className="grid grid-cols-2 gap-2">
                {(["wISK", "ISK"] as const).map((a) => {
                  const active = have === a;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setHave(a)}
                      className={`p-3 rounded-lg font-mono text-sm border transition-colors ${
                        active
                          ? "border-accent text-accent bg-accent/10"
                          : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {active ? "✓ " : ""}Have {a} → Want{" "}
                      {a === "wISK" ? "ISK" : "wISK"}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground pt-1">
                <input
                  type="checkbox"
                  checked={lock}
                  onChange={(e) => setLock(e.target.checked)}
                  className="accent-accent"
                />
                Lock direction (hide flip button)
              </label>
            </Field>

            <Field label={`Default amount (${have})`}>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-secondary border border-border p-3 rounded-lg font-mono text-sm focus:outline-none focus:border-accent"
              />
            </Field>

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
                src={previewUrl}
                title="Bridge embed preview"
                style={{
                  width: "100%",
                  height: `${Number(height) || 680}px`,
                  border: 0,
                }}
                allow="clipboard-write"
              />
            </div>

            <div className="text-xs font-mono text-muted-foreground space-y-2 pt-2">
              <p className="text-foreground">Sharing tips</p>
              <p>· Responsive by default — width:100% inside any container.</p>
              <p>
                · On order creation we post{" "}
                <code className="text-accent">swap-embed:order-created</code>{" "}
                to the parent window with the order ID.
              </p>
              <p>· No keys or SDK. Anyone can embed.</p>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest px-1">
        {label}
      </div>
      {children}
    </div>
  );
}
