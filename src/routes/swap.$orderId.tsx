import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { z } from "zod";
import { EmbedResize } from "@/components/embed-resize";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { acceptUnderpayment, getOrder } from "@/lib/orders.functions";
import { recordSwap } from "@/lib/swap-history";

export const Route = createFileRoute("/swap/$orderId")({
  validateSearch: (s) => z.object({ embed: z.coerce.number().optional() }).parse(s),
  loader: ({ params }) => getOrder({ data: { publicId: params.orderId } }),
  head: ({ params }) => ({
    meta: [
      { title: `Order ${params.orderId} — TEXIT Runner` },
      { name: "description", content: "Track your TXC swap order in real time." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center font-mono text-sm">
        <div className="text-accent mb-2">ERROR</div>
        <div className="text-muted-foreground">{error.message}</div>
        <Link to="/swap" className="text-accent underline mt-4 inline-block">
          Start a new swap
        </Link>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">Order not found.</div>
  ),
});

function makeSteps(asset: string) {
  return [
    { key: "awaiting_payment", label: "Awaiting Payment", detail: "Send the exact amount to the deposit address" },
    { key: "payment_detected", label: "Payment Detected", detail: "Waiting for chain confirmations" },
    { key: "confirmed", label: "Payment Confirmed", detail: "Preparing release" },
    { key: "buying_on_bitmart", label: `Issuing ${asset}`, detail: "Sending from operator wallet" },
    { key: "bought", label: `${asset} Issued`, detail: "Preparing withdrawal" },
    { key: "withdrawing", label: `Withdrawing ${asset}`, detail: "Broadcasting to network" },
    { key: "completed", label: "Completed", detail: `Funds delivered to your ${asset} address` },
  ] as const;
}

function OrderPage() {
  const { orderId } = Route.useParams();
  const search = Route.useSearch();
  const isEmbed = search.embed === 1;
  const initialOrder = Route.useLoaderData();
  const fn = useServerFn(getOrder);
  const { data: order, error, isError, isPending } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => fn({ data: { publicId: orderId } }),
    initialData: initialOrder,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "completed" || s === "failed" || s === "expired" || s === "refunded") return false;
      return 8000;
    },
  });

  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!order?.deposit_address) return;
    const isDark =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark");
    QRCode.toDataURL(order.deposit_address, {
      width: 320,
      margin: 1,
      color: {
        dark: isDark ? "#ffffff" : "#000000",
        light: "#00000000",
      },
    }).then(setQrUrl).catch(console.error);
  }, [order?.deposit_address]);


  useEffect(() => {
    if (!order?.public_id) return;
    recordSwap({
      publicId: order.public_id,
      destAsset: order.dest_asset ?? "TXC",
      sourceAmountUsd: Number(order.source_amount_usd ?? 0),
      createdAt: order.created_at ?? new Date().toISOString(),
    });
  }, [order?.public_id, order?.dest_asset, order?.source_amount_usd, order?.created_at]);

  if (isPending) {
    return (
      <div className="min-h-screen">
        {isEmbed ? <EmbedResize /> : <SiteHeader ticker={<LiveTicker />} />}
        <div className="max-w-4xl mx-auto px-4 py-20 font-mono text-sm text-muted-foreground">
          Loading order…
        </div>
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="min-h-screen">
        {isEmbed ? <EmbedResize /> : <SiteHeader ticker={<LiveTicker />} />}
        <main className="max-w-4xl mx-auto px-4 py-20 font-mono text-sm">
          <div className="text-accent mb-2">Order not found</div>
          <div className="text-muted-foreground break-all">
            {isError ? error.message : `No order exists for ${orderId}.`}
          </div>
          <Link to="/swap" className="text-accent underline mt-4 inline-block">
            Start a new swap
          </Link>
        </main>
        {isEmbed ? null : <SiteFooter />}
      </div>
    );
  }

  const destAsset = order.dest_asset || "TXC";
  const steps = makeSteps(destAsset);
  // Backend uses "sending" for the wrap flow (TXC→wTXC) where the operator
  // wallet is broadcasting the payout — map it to the "Issuing" step so the
  // UI advances instead of appearing stuck on "Awaiting Payment".
  const normalizedStatus = order.status === "sending" ? "buying_on_bitmart" : order.status;
  const stepIdx = Math.max(
    0,
    steps.findIndex((s) => s.key === normalizedStatus),
  );
  const failed = order.status === "failed" || order.status === "expired";

  // Underpayment prompt: backend flags `underpayment_ack='pending'` when
  // the paid amount is >0.5% short of the original quote. Ask the user
  // to top up OR continue with the repriced (smaller) payout.
  const isTxcSource = order.source_chain === "txc";
  const feeMul = 1 - Math.abs(Number(order.premium_bps ?? 0)) / 10_000;
  const paidTxc = feeMul > 0 ? Number(order.quoted_dest_out) / feeMul : 0;
  const requiredTxc =
    feeMul > 0 && order.original_quoted_dest_out
      ? Number(order.original_quoted_dest_out) / feeMul
      : 0;
  const shortfallTxc = Math.max(0, requiredTxc - paidTxc);
  const isUnderpayment =
    isTxcSource && order.underpayment_ack === "pending" && shortfallTxc > 0;

  const [dismissed, setDismissed] = useState(false);
  const showUnderpayment = isUnderpayment && !dismissed;
  const qc = useQueryClient();
  const acceptFn = useServerFn(acceptUnderpayment);
  const accept = useMutation({
    mutationFn: () => acceptFn({ data: { publicId: order.public_id } }),
    onSuccess: () => {
      toast.success("Continuing with the amount you sent");
      setDismissed(true);
      qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="min-h-screen">
      {isEmbed ? <EmbedResize /> : <SiteHeader ticker={<LiveTicker />} />}
      <main className="max-w-5xl mx-auto px-4 py-12 md:py-16">
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Order
            </div>
            <h1 className="font-mono text-2xl font-bold mt-1">{order.public_id}</h1>
          </div>
          <StatusBadge status={order.status} />
        </div>

        <div className="grid md:grid-cols-5 gap-12">
          {/* Steps */}
          <div className="md:col-span-3">
            <div className="relative space-y-10 pl-8 border-l border-border">
              {steps.map((s, i) => {
                const done = i < stepIdx && !failed;
                const active = i === stepIdx && !failed;
                return (
                  <div key={s.key} className={`relative ${i > stepIdx && !failed ? "opacity-30" : ""}`}>
                    <div
                      className={`absolute -left-[37px] top-1 size-4 rounded-full border-4 border-background ${
                        done ? "bg-success" : active ? "bg-accent animate-pulse-dot" : "bg-border"
                      }`}
                    />
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="text-sm font-bold">{s.label}</div>
                        <div className="text-xs text-muted-foreground font-mono">{s.detail}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {failed ? (
                <div className="relative">
                  <div className="absolute -left-[37px] top-1 size-4 rounded-full border-4 border-background bg-accent" />
                  <div className="text-sm font-bold text-accent">
                    {order.status === "expired" ? "Quote Expired" : "Failed"}
                  </div>
                  {order.error_message ? (
                    <div className="text-xs text-muted-foreground font-mono mt-1">
                      {order.error_message}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-10 bg-secondary/50 border border-border rounded-xl p-4 font-mono text-xs space-y-2">
              <KV label="Source" value={`${order.chainName} · ${order.source_token}`} />
              <KV
                label="Sending"
                value={
                  order.sourceNativeAmount
                    ? `≈ ${order.sourceNativeAmount.toFixed(6)} ${order.source_token}`
                    : `$${Number(order.source_amount_usd).toFixed(2)}`
                }
              />
              <KV
                label="Quote"
                value={`${Number(order.quoted_dest_out).toFixed(4)} ${destAsset}`}
              />
              {order.paid_tx_hash ? (
                <KV
                  label="Deposit Tx"
                  value={
                    <a
                      className="text-accent hover:underline break-all"
                      href={`${order.chainExplorer}/tx/${order.paid_tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {order.paid_tx_hash.slice(0, 10)}…{order.paid_tx_hash.slice(-8)}
                    </a>
                  }
                />
              ) : null}
              {order.dest_tx_hash ? (
                <KV
                  label={`${destAsset} Tx`}
                  value={
                    <a
                      className="text-success hover:underline break-all"
                      href={`${destAsset === "wTXC" ? "https://etherscan.io" : "https://mempool.texitcoin.org"}/tx/${order.dest_tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {order.dest_tx_hash.slice(0, 10)}…{order.dest_tx_hash.slice(-8)}
                    </a>
                  }
                />
              ) : null}
            </div>
          </div>

          {/* Deposit panel */}
          <div className="md:col-span-2">
            <div className="bg-background border border-border p-6 rounded-xl space-y-6">
              <div className="aspect-square bg-secondary/40 rounded-lg flex items-center justify-center border border-border p-4">
                {qrUrl ? (
                  <img src={qrUrl} alt="Deposit QR" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    Generating QR…
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  {order.sourceNativeAmount
                    ? `Send ≈ ${order.sourceNativeAmount.toFixed(6)} ${order.source_token} on ${order.chainName} to`
                    : `Send ${order.source_token} on ${order.chainName} to`}
                </div>
                <div className="font-mono text-[11px] bg-secondary p-3 rounded border border-border break-all leading-relaxed">
                  {order.deposit_address}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(order.deposit_address)}
                  className="w-full text-[10px] font-mono uppercase tracking-widest border border-border py-2 rounded hover:bg-foreground hover:text-background transition-colors"
                >
                  Copy Address
                </button>
              </div>
              <Countdown to={order.expires_at} />
            </div>
          </div>
        </div>
      </main>
      {isEmbed ? null : <SiteFooter />}

      {showUnderpayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-background border border-border rounded-xl p-6 space-y-5 shadow-2xl">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
                Underpayment
              </div>
              <h2 className="font-mono text-lg font-bold mt-1">
                We received less than the quote
              </h2>
            </div>
            <div className="bg-secondary/50 border border-border rounded-lg p-4 font-mono text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Received</span>
                <span>{paidTxc.toFixed(6)} TXC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quote called for</span>
                <span>{requiredTxc.toFixed(6)} TXC</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Short by</span>
                <span className="text-accent">
                  {shortfallTxc.toFixed(6)} TXC
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground font-mono leading-relaxed">
              Send the missing {shortfallTxc.toFixed(6)} TXC to the same
              deposit address and we'll pay the full quote — or continue now
              and receive{" "}
              <span className="text-foreground">
                {Number(order.quoted_dest_out).toFixed(4)} {destAsset}
              </span>{" "}
              for what you sent.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setDismissed(true)}
                className="w-full text-[11px] font-mono uppercase tracking-widest border border-border py-3 rounded hover:bg-foreground hover:text-background transition-colors"
              >
                I'll send the difference
              </button>
              <button
                onClick={() => accept.mutate()}
                disabled={accept.isPending}
                className="w-full text-[11px] font-mono uppercase tracking-widest bg-accent text-accent-foreground py-3 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {accept.isPending
                  ? "Continuing…"
                  : `Continue with ${paidTxc.toFixed(6)} TXC`}
              </button>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground text-center">
              No action? We'll auto-continue when the quote timer runs out.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isDone = status === "completed";
  const isBad = status === "failed" || status === "expired";
  const cls = isDone
    ? "text-success border-success/40"
    : isBad
      ? "text-accent border-accent/40"
      : "text-accent border-accent/40 animate-pulse";
  return (
    <div className={`text-xs font-mono uppercase tracking-[0.2em] border px-3 py-1.5 ${cls}`}>
      {status.replace(/_/g, " ")}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, new Date(to).getTime() - now);
  const mins = Math.floor(diff / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);
  return (
    <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-widest">
      <span className="text-muted-foreground">Quote expires in</span>
      <span className="text-accent">
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </span>
    </div>
  );
}
