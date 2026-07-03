import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { ThemeToggle } from "@/components/theme-toggle";

import { supabase } from "@/integrations/supabase/client";
import {
  adminAuditLog,
  adminBitmartBalances,
  adminBulkReplenish,
  adminCreateCustomToken,
  adminDeleteCustomToken,
  adminForceComplete,
  adminForceFail,
  adminGetSettings,
  adminHotWalletBalances,
  adminInviteAdmin,
  adminListAdmins,
  adminListCustomTokens,
  adminListOrders,
  adminReconcile,
  adminSearchOrders,

  adminOrderDetail,
  adminRetryOrder,
  adminRevokeAdmin,
  adminTelegramTest,
  adminTreasuryDebt,
  adminUpdateCustomToken,
  adminUpdateSettings,
  adminWalletScan,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — TEXIT Runner" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Tab = "orders" | "treasury" | "wallet" | "market" | "tokens" | "settings" | "admins" | "audit";

function AdminPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
      setChecking(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="mb-10">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-3">
            Operator Console
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tighter">
            Admin <span className="text-accent">/</span> Console
          </h1>
        </div>
        {checking ? (
          <p className="font-mono text-xs text-muted-foreground">Checking session…</p>
        ) : userId ? (
          <Dashboard onSignOut={() => supabase.auth.signOut()} />
        ) : (
          <LoginForm />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="max-w-sm space-y-3 bg-secondary/40 border border-border rounded-xl p-6">
        <div className="text-[10px] font-mono uppercase tracking-widest text-accent">
          Magic link sent
        </div>
        <p className="text-sm font-mono text-muted-foreground leading-relaxed">
          Check <span className="text-foreground">{email}</span> for a sign-in link.
        </p>
        <button
          onClick={() => { setSent(false); setEmail(""); }}
          className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-4 bg-secondary/40 border border-border rounded-xl p-6">
      <div className="space-y-1">
        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-background border border-border rounded p-3 font-mono text-sm focus:outline-none focus:border-accent"
        />
      </div>
      {err ? <div className="text-xs font-mono text-accent">{err}</div> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-accent text-accent-foreground py-3 rounded font-mono text-xs uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send Magic Link"}
      </button>
      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
        Only emails with the admin role can sign in.
      </p>
    </form>
  );
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("orders");
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "orders", label: "Orders" },
    { id: "treasury", label: "Treasury" },
    { id: "wallet", label: "Wallet" },
    { id: "market", label: "Market" },
    { id: "tokens", label: "Tokens" },
    { id: "settings", label: "Settings" },
    { id: "admins", label: "Admins" },
    { id: "audit", label: "Audit" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="flex gap-1 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest rounded border ${
                tab === t.id
                  ? "bg-foreground text-background border-foreground"
                  : "border-border hover:border-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={onSignOut}
            className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background transition-colors"
          >
            Sign Out
          </button>
        </div>

      </div>

      {tab === "orders" && <OrdersTab />}
      {tab === "treasury" && <TreasuryTab />}
      {tab === "wallet" && <WalletTab />}
      {tab === "market" && <MarketTab />}
      {tab === "tokens" && <TokensTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "admins" && <AdminsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

// ===== Orders Tab =====
function OrdersTab() {
  const listFn = useServerFn(adminListOrders);
  const searchFn = useServerFn(adminSearchOrders);
  const hotFn = useServerFn(adminHotWalletBalances);
  const retryFn = useServerFn(adminRetryOrder);
  const forceCompleteFn = useServerFn(adminForceComplete);
  const forceFailFn = useServerFn(adminForceFail);

  const [pageSize, setPageSize] = useState<10 | 25 | 50>(25);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "completed" | "failed">("all");

  // Debounce input → query (300ms).
  useEffect(() => {
    const id = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [query]);

  const orders = useQuery({
    queryKey: ["admin", "orders", query],
    queryFn: () =>
      query
        ? searchFn({ data: { query, limit: 200 } })
        : listFn({ data: { limit: 200 } }),
    refetchInterval: query ? false : 10_000,
  });

  const hot = useQuery({
    queryKey: ["admin", "hot-wallet-balances"],
    queryFn: () => hotFn({}),
    refetchInterval: 60_000,
  });
  const retry = useMutation({
    mutationFn: (publicId: string) => retryFn({ data: { publicId } }),
    onSuccess: () => orders.refetch(),
  });
  const forceComplete = useMutation({
    mutationFn: (publicId: string) => forceCompleteFn({ data: { publicId } }),
    onSuccess: () => orders.refetch(),
  });
  const forceFail = useMutation({
    mutationFn: (vars: { publicId: string; reason?: string }) =>
      forceFailFn({ data: vars }),
    onSuccess: () => orders.refetch(),
  });

  const ordersErr = orders.error as Error | null;

  const OPEN_STATUSES = new Set([
    "awaiting_payment", "pending", "paid", "confirmed",
    "buying_on_bitmart", "paying_out", "withdrawing",
  ]);
  const FAILED_STATUSES = new Set(["failed", "expired", "refunded"]);
  const filteredOrders = (orders.data ?? []).filter((o) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "completed") return o.status === "completed";
    if (statusFilter === "failed") return FAILED_STATUSES.has(o.status);
    // open = anything not completed and not in a failed/terminal state
    return !FAILED_STATUSES.has(o.status) && o.status !== "completed";
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Hot wallet balances
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalanceCard
            label="TXC"
            value={
              hot.data?.txc.ok
                ? `${hot.data.txc.confirmed.toFixed(4)}${
                    hot.data.txc.unconfirmed ? ` (+${hot.data.txc.unconfirmed.toFixed(4)})` : ""
                  }`
                : null
            }
            error={hot.data?.txc.ok === false ? hot.data.txc.error : null}
          />
          <BalanceCard
            label="wTXC"
            value={hot.data?.wtxc.ok ? hot.data.wtxc.balance.toFixed(4) : null}
            error={hot.data?.wtxc.ok === false ? hot.data.wtxc.error : null}
          />
        </div>
      </div>


      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px]">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search ID · address · tx hash · withdrawal · bitmart order · chain · status · error…"
            className="w-full bg-secondary/40 border border-border rounded px-3 py-2 pr-20 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-foreground/60"
          />
          {searchInput ? (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="flex gap-1">
          {(["all", "open", "completed", "failed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(0); }}
              className={`px-3 py-2 text-[10px] font-mono uppercase tracking-widest rounded border ${
                statusFilter === s
                  ? "bg-foreground text-background border-foreground"
                  : "border-border hover:border-foreground/60"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {query ? (
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {orders.isFetching
              ? "Searching…"
              : `${orders.data?.length ?? 0} match${orders.data?.length === 1 ? "" : "es"}`}
          </span>
        ) : null}
      </div>


      {ordersErr ? (
        <div className="text-xs font-mono text-accent">{ordersErr.message}</div>
      ) : null}



      <div className="overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-xs font-mono">
          <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
            <tr>
              <th className="w-6 p-3"></th>
              <th className="text-left p-3">Order</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Source</th>
              <th className="text-right p-3">TXC</th>
              <th className="text-right p-3">wTXC</th>
              <th className="text-left p-3">Dest</th>
              <th className="text-left p-3">Created</th>
              <th className="text-right p-3">Action</th>

            </tr>
          </thead>
          <tbody>
            {filteredOrders
              .slice(page * pageSize, page * pageSize + pageSize)
              .map((o) => (
                <OrderRow
                  key={o.public_id}
                  order={o}
                  onRetry={() => retry.mutate(o.public_id)}
                  onForceComplete={() => {
                    if (confirm(`Force ${o.public_id} back into the payout queue?`)) {
                      forceComplete.mutate(o.public_id);
                    }
                  }}
                  onForceFail={() => {
                    const reason = prompt(
                      `Mark ${o.public_id} as failed. Optional reason:`,
                      "",
                    );
                    if (reason === null) return;
                    forceFail.mutate({ publicId: o.public_id, reason: reason || undefined });
                  }}
                />
              ))}
            {!filteredOrders.length && !orders.isLoading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  No orders match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {filteredOrders.length ? (
        <div className="flex items-center justify-between flex-wrap gap-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            {[10, 25, 50].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setPageSize(n as 10 | 25 | 50);
                  setPage(0);
                }}
                className={`px-2 py-1 rounded border ${
                  pageSize === n
                    ? "bg-foreground text-background border-foreground"
                    : "border-border hover:border-foreground/60"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span>
              {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, filteredOrders.length)} of{" "}
              {filteredOrders.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-border hover:border-foreground/60 disabled:opacity-30 disabled:hover:border-border"
            >
              Prev
            </button>
            <button
              onClick={() =>
                setPage((p) =>
                  (p + 1) * pageSize < filteredOrders.length ? p + 1 : p,
                )
              }
              disabled={(page + 1) * pageSize >= filteredOrders.length}
              className="px-2 py-1 rounded border border-border hover:border-foreground/60 disabled:opacity-30 disabled:hover:border-border"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type OrderRowData = {
  public_id: string;
  status: string;
  source_chain: string;
  source_token: string;
  dest_address: string;
  dest_asset: string | null;
  quoted_dest_out: number;
  created_at: string;
  bitmart_filled_dest: number | null;
  dest_tx_hash: string | null;
  error_message: string | null;
};


function OrderRow({
  order: o,
  onRetry,
  onForceComplete,
  onForceFail,
}: {
  order: OrderRowData;
  onRetry: () => void;
  onForceComplete: () => void;
  onForceFail: () => void;
}) {
  const [open, setOpen] = useState(false);
  const terminal = o.status === "completed" || o.status === "failed" || o.status === "expired" || o.status === "refunded";
  return (
    <>
      <tr className="border-t border-border hover:bg-secondary/20 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <td className="p-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="p-3">{o.public_id}</td>
        <td className="p-3">
          <span className="text-accent">{o.status.replace(/_/g, " ")}</span>
          {o.error_message ? (
            <div className="text-[10px] text-muted-foreground">{o.error_message}</div>
          ) : null}
        </td>
        <td className="p-3">{o.source_chain} · {o.source_token}</td>
        <td className="p-3 text-right">
          {(o.dest_asset ?? "TXC") === "TXC"
            ? (o.bitmart_filled_dest != null
                ? Number(o.bitmart_filled_dest).toFixed(4)
                : Number(o.quoted_dest_out).toFixed(4))
            : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="p-3 text-right">
          {(o.dest_asset ?? "TXC") === "wTXC"
            ? Number(o.quoted_dest_out).toFixed(4)
            : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="p-3 truncate max-w-[14ch]">{o.dest_address}</td>

        <td className="p-3">{new Date(o.created_at).toLocaleString()}</td>
        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-1 flex-wrap">
            {o.status === "failed" ? (
              <button
                onClick={onRetry}
                className="border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background"
              >
                Retry
              </button>
            ) : null}
            {!terminal ? (
              <>
                <button
                  onClick={onForceComplete}
                  title="Reset to confirmed so the payout job sends the native asset"
                  className="border border-success/50 text-success px-2 py-1 rounded hover:bg-success hover:text-background"
                >
                  Force payout
                </button>
                <button
                  onClick={onForceFail}
                  title="Mark this order as failed (stops the swap-tick from retrying)"
                  className="border border-accent/50 text-accent px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground"
                >
                  Force fail
                </button>
              </>
            ) : null}
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-border bg-background/40">
          <td colSpan={9} className="p-0">
            <OrderDetail publicId={o.public_id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function OrderDetail({ publicId }: { publicId: string }) {
  const detailFn = useServerFn(adminOrderDetail);
  const q = useQuery({
    queryKey: ["admin", "order-detail", publicId],
    queryFn: () => detailFn({ data: { publicId } }),
    refetchInterval: 8000,
  });

  if (q.isLoading) {
    return <div className="p-6 text-[10px] font-mono text-muted-foreground">Loading detail…</div>;
  }
  if (q.error) {
    return <div className="p-6 text-xs font-mono text-accent">{(q.error as Error).message}</div>;
  }
  if (!q.data) return null;

  const { order, deposits, events, audit, bitmartLive, hotBalance } = q.data;
  const asset = order.dest_asset ?? "TXC";
  const explorer = (txid: string) =>
    asset === "wTXC"
      ? `https://etherscan.io/tx/${txid}`
      : `https://mempool.texitcoin.org/tx/${txid}`;

  const srcToken = (order.source_token ?? "").toUpperCase();
  const dstAsset = (order.dest_asset ?? "TXC").toUpperCase();
  const service =
    srcToken === "TXC" && dstAsset === "WTXC"
      ? "Wrap"
      : srcToken === "WTXC" && dstAsset === "TXC"
        ? "Unwrap"
        : "Swap";
  const firstDeposit = deposits[0];
  const receivedAmount =
    firstDeposit?.amount_source != null
      ? Number(firstDeposit.amount_source)
      : firstDeposit?.amount_usd != null
        ? Number(firstDeposit.amount_usd)
        : null;
  const quotedInLabel = order.source_token ?? "—";

  return (
    <div className="p-5 space-y-5">
      {/* Quote */}
      <DetailGrid title="Quote">
        <KV k="Service" v={service} />
        <KV k="Premium" v={`${(order.premium_bps / 100).toFixed(2)}%`} />
        <KV k="Timestamp" v={new Date(order.created_at).toLocaleString()} />
        <KV k="Quoted in" v={`${Number(order.source_amount_usd).toFixed(4)} ${quotedInLabel}`} />
        <KV k="Quoted out" v={`${Number(order.quoted_dest_out).toFixed(4)} ${asset}`} />
        <KV k="Expires" v={new Date(order.expires_at).toLocaleString()} />
      </DetailGrid>

      {/* Deposit */}
      <DetailGrid title="Deposit">
        <KV k="Address" v={order.deposit_address} mono />
        <KV k="Tx hash" v={order.paid_tx_hash ?? "—"} mono />
        <KV
          k="Received"
          v={
            receivedAmount != null
              ? `${receivedAmount.toFixed(8)} ${quotedInLabel}`
              : "—"
          }
        />
      </DetailGrid>

      {/* Payout */}
      <DetailGrid title="Payout">
        <KV k="From" v={order.dest_from_address ?? hotBalance?.address ?? "—"} mono />
        <KV k="To" v={order.dest_address} mono />
        <KV
          k="Tx hash"
          v={
            order.dest_tx_hash ? (
              <a
                href={explorer(order.dest_tx_hash)}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline break-all"
              >
                {order.dest_tx_hash}
              </a>
            ) : (
              "—"
            )
          }
        />
        <KV
          k="Amount sent"
          v={
            order.bitmart_filled_dest != null
              ? `${Number(order.bitmart_filled_dest).toFixed(8)} ${asset}`
              : order.dest_tx_hash
                ? `${Number(order.quoted_dest_out).toFixed(8)} ${asset}`
                : "—"
          }
        />
        <KV
          k="Fee"
          v={
            order.dest_fee_sats != null
              ? `${(Number(order.dest_fee_sats) / 1e8).toFixed(8)} ${asset}`
              : "—"
          }
        />
        {hotBalance ? (
          <KV
            k="Hot balance"
            v={`${hotBalance.confirmedTxc.toFixed(4)} ${asset}${
              hotBalance.unconfirmedTxc
                ? ` (+${hotBalance.unconfirmedTxc.toFixed(4)} pending)`
                : ""
            }`}
          />
        ) : null}
      </DetailGrid>

      {/* Timeline */}
      <div>
        <SectionHeader>Event timeline</SectionHeader>
        <div className="border border-border rounded">
          {events.length ? (
            events.map((e) => (
              <div
                key={e.id}
                className="px-3 py-2 border-b border-border last:border-b-0 grid grid-cols-[140px_90px_120px_1fr] gap-3 items-start text-[11px]"
              >
                <span className="text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </span>
                <span className="uppercase tracking-widest text-accent text-[10px]">{e.kind}</span>
                <span>{e.event}</span>
                <span className="text-muted-foreground break-all">
                  {e.details ? JSON.stringify(e.details) : ""}
                </span>
              </div>
            ))
          ) : (
            <div className="px-3 py-3 text-[10px] text-muted-foreground">No events yet.</div>
          )}
        </div>
      </div>

      {audit.length ? (
        <div>
          <SectionHeader>Admin actions</SectionHeader>
          <div className="border border-border rounded">
            {audit.map((a) => (
              <div
                key={a.id}
                className="px-3 py-2 border-b border-border last:border-b-0 grid grid-cols-[140px_120px_1fr] gap-3 text-[11px]"
              >
                <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                <span>{a.action}</span>
                <span className="text-muted-foreground break-all">
                  {a.details ? JSON.stringify(a.details) : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 border border-border rounded p-4">
        {children}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
      {children}
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-[11px]">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "break-all" : ""}>{v}</span>
    </div>
  );
}

// ===== Treasury Tab =====
function TreasuryTab() {
  const scanFn = useServerFn(adminWalletScan);
  const debtFn = useServerFn(adminTreasuryDebt);
  const bulkBuyFn = useServerFn(adminBulkReplenish);
  const reconcileFn = useServerFn(adminReconcile);
  const qc = useQueryClient();
  const ALL_CHAINS = ["ethereum", "bsc", "base", "arbitrum", "polygon"] as const;

  const scan = useQuery({
    queryKey: ["admin", "treasury-scan"],
    queryFn: () => scanFn({ data: { chains: ALL_CHAINS as unknown as never } }),
    refetchInterval: 60_000,
  });

  const debt = useQuery({
    queryKey: ["admin", "treasury-debt"],
    queryFn: () => debtFn(),
    refetchInterval: 30_000,
  });

  const reconcile = useQuery({
    queryKey: ["admin", "reconcile"],
    queryFn: () => reconcileFn({}),
    refetchInterval: 60_000,
  });

  const hotFn = useServerFn(adminHotWalletBalances);
  const hot = useQuery({
    queryKey: ["admin", "hot-wallet-balances"],
    queryFn: () => hotFn({}),
    refetchInterval: 60_000,
  });

  const [bulkAmount, setBulkAmount] = useState("");
  const bulkBuy = useMutation({
    mutationFn: (notionalUsdt: number) => bulkBuyFn({ data: { notionalUsdt } }),
    onSuccess: () => {
      setBulkAmount("");
      qc.invalidateQueries({ queryKey: ["admin", "treasury-debt"] });
    },
  });

  const data = scan.data;
  const admin = data?.addresses.find((a) => a.index === 0) ?? null;
  const customer = data?.addresses.filter((a) => a.index !== 0) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Treasury
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-2 max-w-xl leading-relaxed">
            Live balances across the TXC hot wallet and every xpub-derived EVM
            receive address. Index <span className="text-foreground">#0</span> is the admin
            treasury; customer deposits rotate through index #1+.
          </p>
        </div>
        <button
          onClick={() => { scan.refetch(); hot.refetch(); }}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background"
        >
          {scan.isFetching || hot.isFetching ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {/* TXC hot wallet treasury address */}
      {(() => {
        const txc = hot.data?.txc;
        if (!txc || txc.ok === false) {
          return txc?.ok === false ? (
            <div className="text-xs font-mono text-accent">TXC hot wallet: {txc.error}</div>
          ) : (
            <div className="text-[10px] font-mono text-muted-foreground">Loading TXC treasury…</div>
          );
        }
        return (
          <div className="border border-accent/40 bg-accent/5 rounded-xl p-5 space-y-3">
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-accent">
                  TXC treasury · hot wallet
                </div>
                <div className="font-mono text-sm mt-2 break-all">{txc.address}</div>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(txc.address)}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-1.5 rounded hover:bg-foreground hover:text-background"
              >
                Copy
              </button>
            </div>
            <div className="pt-2 border-t border-border">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Balance
              </div>
              <div className="font-mono text-lg mt-1">
                {txc.confirmed.toFixed(4)} TXC
                {txc.unconfirmed ? (
                  <span className="text-muted-foreground text-sm">
                    {" "}(+{txc.unconfirmed.toFixed(4)} pending)
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Reconciliation — asset debt */}
      {reconcile.data ? (
        <ReconcilePanel data={reconcile.data} onRefetch={() => reconcile.refetch()} loading={reconcile.isFetching} />
      ) : reconcile.error ? (
        <div className="text-xs font-mono text-accent">
          Reconcile: {(reconcile.error as Error).message}
        </div>
      ) : (
        <div className="text-[10px] font-mono text-muted-foreground">Reconciling…</div>
      )}

      {/* Treasury debt — TXC sold vs TXC re-bought on Bitmart */}
      {debt.data ? (
        <div className="border border-border bg-secondary/30 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Treasury debt · TXC owed to hot wallet
              </div>
              <p className="text-[11px] font-mono text-muted-foreground mt-2 max-w-xl leading-relaxed">
                Sum of TXC sent to customers minus TXC re-bought on Bitmart.
                Small market buys can partially cancel when the remainder drops
                under Bitmart's minimum — those gaps land here.
              </p>
            </div>
            <button
              onClick={() => debt.refetch()}
              className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background"
            >
              {debt.isFetching ? "…" : "Refresh"}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-background/60 border border-border rounded-lg p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                TXC sold
              </div>
              <div className="font-mono text-xl mt-1">{debt.data.txcSold.toFixed(4)}</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {debt.data.orderCount} orders
              </div>
            </div>
            <div className="bg-background/60 border border-border rounded-lg p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                TXC bought
              </div>
              <div className="font-mono text-xl mt-1">{debt.data.txcBought.toFixed(4)}</div>
            </div>
            <div className="bg-accent/10 border border-accent/40 rounded-lg p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-accent">
                Outstanding
              </div>
              <div className="font-mono text-xl mt-1">{debt.data.txcDebt.toFixed(4)} TXC</div>
            </div>
          </div>

          <div className="flex items-end gap-2 flex-wrap pt-2 border-t border-border">
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Square-up market buy
              </label>
              <input
                type="number"
                min={5}
                max={5000}
                step={1}
                value={bulkAmount}
                onChange={(e) => setBulkAmount(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-background border border-border rounded font-mono text-sm"
              />
            </div>
            <button
              onClick={() => {
                const n = parseFloat(bulkAmount || String(debt.data?.estUsdtToSquareUp ?? 0));
                if (n >= 5) bulkBuy.mutate(n);
              }}
              disabled={bulkBuy.isPending}
              className="text-[10px] font-mono uppercase tracking-widest border border-accent bg-accent/10 text-accent px-4 py-2 rounded hover:bg-accent hover:text-background disabled:opacity-50"
            >
              {bulkBuy.isPending ? "Submitting…" : "Buy TXC now"}
            </button>
          </div>
          {bulkBuy.data?.ok === true ? (
            <div className="text-[11px] font-mono text-foreground">
              ✓ Bitmart order {bulkBuy.data.bitmart_order_id} submitted.
            </div>
          ) : null}
          {bulkBuy.data?.ok === false ? (
            <div className="text-[11px] font-mono text-accent">
              ✗ {bulkBuy.data.error}
            </div>
          ) : null}

          {debt.data.topShortfalls.length > 0 ? (
            <details className="text-[11px] font-mono">
              <summary className="cursor-pointer text-muted-foreground uppercase tracking-widest text-[10px]">
                Top shortfalls ({debt.data.topShortfalls.length})
              </summary>
              <div className="mt-2 space-y-1">
                {debt.data.topShortfalls.map((s) => (
                  <div key={s.public_id} className="grid grid-cols-[1fr_auto_auto] gap-3">
                    <span>{s.public_id}</span>
                    <span className="text-muted-foreground">
                      {s.bought.toFixed(4)} / {s.sold.toFixed(4)}
                    </span>
                    <span className="text-accent">-{s.shortfall.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {scan.error ? (
        <div className="text-xs font-mono text-accent">
          {(scan.error as Error).message}
        </div>
      ) : null}

      {!data ? (
        <div className="text-[10px] font-mono text-muted-foreground">Scanning all chains…</div>
      ) : (
        <>
          {/* Admin treasury card */}
          {admin ? (
            <div className="border border-accent/40 bg-accent/5 rounded-xl p-5 space-y-3">
              <div className="flex justify-between items-start gap-3 flex-wrap">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-accent">
                    Admin treasury · index #0
                  </div>
                  <div className="font-mono text-sm mt-2 break-all">{admin.address}</div>
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(admin.address)}
                  className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-1.5 rounded hover:bg-foreground hover:text-background"
                >
                  Copy
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 pt-2 border-t border-border">
                {data.chains.map((c) => {
                  // Pull this address's per-chain row to show its breakdown
                  // (scan stores one row per chain per address)
                  const row = data.addresses.find(
                    (r) => r.index === 0 && r.chain === c.chain,
                  );
                  return (
                    <div key={c.chain} className="text-[10px] font-mono">
                      <div className="uppercase tracking-widest text-muted-foreground">
                        {c.chainName}
                      </div>
                      <div className="text-muted-foreground">
                        {(row?.native ?? 0).toFixed(6)} {c.nativeSymbol}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Per-chain totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {data.chains.map((c) => (
              <div key={c.chain} className="bg-secondary/40 border border-border rounded p-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {c.chainName}
                </div>
                {c.error ? (
                  <div className="text-[10px] font-mono text-accent mt-1">{c.error}</div>
                ) : (
                  <>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {c.totalNative.toFixed(6)} {c.nativeSymbol}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      blk {c.blockNumber} · {c.latencyMs}ms
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Customer slots with funds */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
              Funded customer slots
            </div>
            <div className="overflow-x-auto border border-border rounded-xl">
              <table className="w-full text-xs font-mono">
                <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
                  <tr>
                    <th className="text-left p-3">#</th>
                    <th className="text-left p-3">Address</th>
                    <th className="text-left p-3">Chain</th>
                    <th className="text-right p-3">Native</th>
                    <th className="text-left p-3">Linked order</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.map((a) => (
                    <tr key={`${a.chain}-${a.address}`} className="border-t border-border">
                      <td className="p-3">{a.index}</td>
                      <td className="p-3 truncate max-w-[20ch]">{a.address}</td>
                      <td className="p-3">{a.chainName}</td>
                      <td className="p-3 text-right">
                        {a.native > 0 ? `${a.native.toFixed(6)} ${a.nativeSymbol}` : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">{a.linkedOrderId ?? "—"}</td>
                    </tr>
                  ))}
                  {!customer.length ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        No customer slots currently hold a balance.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[10px] font-mono text-muted-foreground">
            Generated {new Date(data.generatedAt).toLocaleTimeString()} ·{" "}
            {data.scannedAddresses} addresses scanned
            {data.errors.length ? ` · ${data.errors.join(" · ")}` : ""}
          </div>
        </>
      )}
    </div>
  );
}

// ===== Wallet Tab =====
function WalletTab() {
  const scanFn = useServerFn(adminWalletScan);
  const [chains, setChains] = useState<string[]>(["ethereum", "bsc"]);

  const scan = useQuery({
    queryKey: ["admin", "wallet-scan", chains.join(",")],
    queryFn: () => scanFn({ data: { chains: chains as never } }),
    refetchInterval: 60_000,
  });

  const ALL = ["ethereum", "bsc", "base", "arbitrum", "polygon"];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Chains to scan
          </div>
          <div className="flex gap-2 flex-wrap">
            {ALL.map((c) => (
              <button
                key={c}
                onClick={() =>
                  setChains((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
                  )
                }
                className={`px-2 py-1 text-[10px] font-mono uppercase tracking-widest rounded border ${
                  chains.includes(c)
                    ? "bg-accent text-accent-foreground border-accent"
                    : "border-border hover:border-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => scan.refetch()}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background"
        >
          {scan.isFetching ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {scan.data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {scan.data.chains.map((c) => (
              <div key={c.chain} className="bg-secondary/40 border border-border rounded p-4">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {c.chainName}
                </div>
                {c.error ? (
                  <div className="text-[10px] font-mono text-accent mt-1">{c.error}</div>
                ) : (
                  <>
                    <div className="font-mono text-[10px] text-muted-foreground mt-1">
                      {c.totalNative.toFixed(6)} {c.nativeSymbol} · blk {c.blockNumber}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      RPC {c.latencyMs}ms
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="text-[10px] font-mono text-muted-foreground">
            Scanned {scan.data.scannedAddresses} of {scan.data.totalAddresses} derived
            addresses · {scan.data.addresses.length} with funds · generated{" "}
            {new Date(scan.data.generatedAt).toLocaleTimeString()}
          </div>

          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-xs font-mono">
              <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
                <tr>
                  <th className="text-left p-3">#</th>
                  <th className="text-left p-3">Address</th>
                  <th className="text-left p-3">Chain</th>
                  <th className="text-right p-3">Native</th>
                  <th className="text-left p-3">Tokens</th>
                  <th className="text-left p-3">Linked order</th>
                </tr>
              </thead>
              <tbody>
                {scan.data.addresses.map((a) => (
                  <tr key={`${a.chain}-${a.address}`} className="border-t border-border">
                    <td className="p-3">{a.index}</td>
                    <td className="p-3 truncate max-w-[20ch]">{a.address}</td>
                    <td className="p-3">{a.chainName}</td>
                    <td className="p-3 text-right">
                      {a.native > 0 ? `${a.native.toFixed(6)} ${a.nativeSymbol}` : "—"}
                    </td>
                    <td className="p-3 text-left">
                      {a.tokens.some((t) => t.balance > 0) ? (
                        <div className="text-[10px] text-muted-foreground">
                          {a.tokens
                            .filter((t) => t.balance > 0)
                            .map((t) => `${t.balance.toFixed(2)} ${t.symbol}`)
                            .join(" · ")}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {a.linkedOrderId ?? "—"}
                    </td>
                  </tr>
                ))}
                {!scan.data.addresses.length ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No addresses with non-zero balances.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {scan.data.errors.length ? (
            <div className="text-[10px] font-mono text-accent">
              {scan.data.errors.join(" · ")}
            </div>
          ) : null}

          <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
            To sweep funds, import the HD mnemonic (env: <code>HD_WALLET_MNEMONIC</code>)
            into a wallet like Rabby or MetaMask. The app only derives addresses
            here — it never holds private keys.
          </p>
        </>
      ) : scan.error ? (
        <div className="text-xs font-mono text-accent">{(scan.error as Error).message}</div>
      ) : (
        <div className="text-[10px] font-mono text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}

// ===== Settings Tab =====
function SettingsTab() {
  const getFn = useServerFn(adminGetSettings);
  const updateFn = useServerFn(adminUpdateSettings);
  const telegramFn = useServerFn(adminTelegramTest);
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => getFn({}),
  });

  const [form, setForm] = useState<null | {
    premium_bps: number;
    expiry_minutes: number;
    min_usd: number;
    max_usd: number;
    paused: boolean;
    paused_reason: string;
    notify_min_usd_created: number;
    low_txc_threshold: number;
    low_wtxc_threshold: number;
    payouts_frozen: boolean;
    payouts_frozen_reason: string;
  }>(null);

  useEffect(() => {
    if (settings.data && !form) {
      setForm({
        premium_bps: settings.data.premium_bps,
        expiry_minutes: settings.data.expiry_minutes,
        min_usd: Number(settings.data.min_usd),
        max_usd: Number(settings.data.max_usd),
        paused: settings.data.paused,
        paused_reason: settings.data.paused_reason ?? "",
        notify_min_usd_created: Number(settings.data.notify_min_usd_created),
        low_txc_threshold: Number(settings.data.low_txc_threshold ?? 10_000),
        low_wtxc_threshold: Number(settings.data.low_wtxc_threshold ?? 10_000),
        payouts_frozen: Boolean((settings.data as { payouts_frozen?: boolean }).payouts_frozen),
        payouts_frozen_reason:
          (settings.data as { payouts_frozen_reason?: string | null }).payouts_frozen_reason ?? "",
      });
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          ...form!,
          paused_reason: form!.paused_reason.trim() || null,
          payouts_frozen_reason: form!.payouts_frozen_reason.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
  });

  const tg = useMutation({
    mutationFn: () => telegramFn({}),
  });

  if (!form) {
    return <div className="text-[10px] font-mono text-muted-foreground">Loading…</div>;
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p!, [k]: v }));

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <Field label="Spread (basis points, 100 = 1%)">
          <NumberInput value={form.premium_bps} onChange={(v) => set("premium_bps", Math.round(v))} />
          <Hint>{(form.premium_bps / 100).toFixed(2)}% added to spot price</Hint>
        </Field>
        <Field label="Order expiry (minutes)">
          <NumberInput value={form.expiry_minutes} onChange={(v) => set("expiry_minutes", Math.round(v))} />
        </Field>
        <Field label="Low TXC alert threshold">
          <NumberInput value={form.low_txc_threshold} onChange={(v) => set("low_txc_threshold", v)} />
          <Hint>Telegram alert fires when TXC hot wallet drops below this</Hint>
        </Field>
        <Field label="Low wTXC alert threshold">
          <NumberInput value={form.low_wtxc_threshold} onChange={(v) => set("low_wtxc_threshold", v)} />
          <Hint>Telegram alert fires when wTXC operator wallet drops below this</Hint>
        </Field>
        <Field label="Kill switch (block new orders)">
          <label className="flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              checked={form.paused}
              onChange={(e) => set("paused", e.target.checked)}
            />
            <span className="text-sm font-mono">
              {form.paused ? "PAUSED — quoting still works, creation blocked" : "Active"}
            </span>
          </label>
          {form.paused ? (
            <input
              type="text"
              placeholder="Reason shown to users…"
              value={form.paused_reason}
              onChange={(e) => set("paused_reason", e.target.value)}
              className="mt-2 w-full bg-background border border-border rounded p-2 font-mono text-sm"
            />
          ) : null}
        </Field>
        <Field label="Freeze payouts (halt all outbound sends)">
          <label className="flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              checked={form.payouts_frozen}
              onChange={(e) => set("payouts_frozen", e.target.checked)}
            />
            <span className="text-sm font-mono">
              {form.payouts_frozen
                ? "FROZEN — confirmed orders stay queued, no funds leave the wallet"
                : "Payouts flowing"}
            </span>
          </label>
          {form.payouts_frozen ? (
            <input
              type="text"
              placeholder="Reason (internal, shown in logs)…"
              value={form.payouts_frozen_reason}
              onChange={(e) => set("payouts_frozen_reason", e.target.value)}
              className="mt-2 w-full bg-background border border-border rounded p-2 font-mono text-sm"
            />
          ) : null}
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="bg-accent text-accent-foreground px-4 py-2 rounded font-mono text-xs uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
        {save.isSuccess ? (
          <span className="text-[10px] font-mono text-accent self-center">Saved.</span>
        ) : null}
        {save.error ? (
          <span className="text-[10px] font-mono text-accent self-center">
            {(save.error as Error).message}
          </span>
        ) : null}
      </div>

      <div className="border-t border-border pt-6 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Telegram
        </div>
        <button
          onClick={() => tg.mutate()}
          disabled={tg.isPending}
          className="border border-border px-3 py-2 rounded font-mono text-xs uppercase tracking-widest hover:bg-foreground hover:text-background disabled:opacity-50"
        >
          {tg.isPending ? "Sending…" : "Send test ping"}
        </button>
        {tg.data?.ok ? (
          <div className="text-[10px] font-mono text-accent">
            Sent to chat {tg.data.chatId}.
          </div>
        ) : tg.data && !tg.data.ok ? (
          <div className="text-[10px] font-mono text-accent">{tg.data.error}</div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full bg-background border border-border rounded p-2 font-mono text-sm focus:outline-none focus:border-accent"
    />
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-mono text-muted-foreground">{children}</div>;
}

// ===== Admins Tab =====
function AdminsTab() {
  const listFn = useServerFn(adminListAdmins);
  const inviteFn = useServerFn(adminInviteAdmin);
  const revokeFn = useServerFn(adminRevokeAdmin);
  const qc = useQueryClient();

  const admins = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: () => listFn({}),
  });

  const [email, setEmail] = useState("");
  const invite = useMutation({
    mutationFn: (e: string) => inviteFn({ data: { email: e } }),
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin", "admins"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => revokeFn({ data: { userId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "admins"] }),
  });

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) invite.mutate(email.trim());
        }}
        className="flex gap-2 flex-wrap"
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@example.com"
          className="flex-1 min-w-[200px] bg-background border border-border rounded p-2 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={invite.isPending}
          className="bg-accent text-accent-foreground px-4 py-2 rounded font-mono text-xs uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
        >
          {invite.isPending ? "Adding…" : "Add admin"}
        </button>
      </form>
      {invite.error ? (
        <div className="text-[10px] font-mono text-accent">{(invite.error as Error).message}</div>
      ) : null}
      <p className="text-[10px] font-mono text-muted-foreground">
        If the email doesn't yet have an account, one is created. They sign in via magic link at /admin.
      </p>

      <div className="overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-xs font-mono">
          <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
            <tr>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Granted</th>
              <th className="text-right p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {admins.data?.map((a) => (
              <tr key={a.role_id} className="border-t border-border">
                <td className="p-3">
                  {a.email}
                  {a.is_self ? (
                    <span className="text-[10px] text-muted-foreground"> · you</span>
                  ) : null}
                </td>
                <td className="p-3">{new Date(a.created_at).toLocaleString()}</td>
                <td className="p-3 text-right">
                  {a.is_self ? (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  ) : (
                    <button
                      onClick={() => {
                        if (confirm(`Revoke admin from ${a.email}?`)) revoke.mutate(a.user_id);
                      }}
                      className="border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!admins.data?.length ? (
              <tr>
                <td colSpan={3} className="p-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== Audit Tab =====
function AuditTab() {
  const logFn = useServerFn(adminAuditLog);
  const log = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => logFn({ data: { limit: 200 } }),
    refetchInterval: 15_000,
  });

  return (
    <div className="overflow-x-auto border border-border rounded-xl">
      <table className="w-full text-xs font-mono">
        <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
          <tr>
            <th className="text-left p-3">When</th>
            <th className="text-left p-3">Actor</th>
            <th className="text-left p-3">Action</th>
            <th className="text-left p-3">Details</th>
          </tr>
        </thead>
        <tbody>
          {log.data?.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
              <td className="p-3">{r.actor_email}</td>
              <td className="p-3 text-accent">{r.action}</td>
              <td className="p-3 max-w-[40ch]">
                <pre className="text-[10px] whitespace-pre-wrap break-all text-muted-foreground">
                  {JSON.stringify(r.details, null, 2)}
                </pre>
                {r.order_id ? (
                  <div className="text-[10px] text-muted-foreground">order: {r.order_id}</div>
                ) : null}
              </td>
            </tr>
          ))}
          {!log.data?.length && !log.isLoading ? (
            <tr>
              <td colSpan={4} className="p-8 text-center text-muted-foreground">
                No audit entries yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// ===== Tokens Tab (admin-managed source asset registry) =====
const TOKEN_CHAINS = ["ethereum", "base", "arbitrum", "polygon", "bsc"] as const;
type TokenChain = (typeof TOKEN_CHAINS)[number];

function TokensTab() {
  const listFn = useServerFn(adminListCustomTokens);
  const createFn = useServerFn(adminCreateCustomToken);
  const updateFn = useServerFn(adminUpdateCustomToken);
  const deleteFn = useServerFn(adminDeleteCustomToken);
  const qc = useQueryClient();

  const tokens = useQuery({
    queryKey: ["admin", "custom-tokens"],
    queryFn: () => listFn({}),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "custom-tokens"] });
    qc.invalidateQueries({ queryKey: ["chains"] });
  };

  const create = useMutation({
    mutationFn: (data: {
      chain: TokenChain;
      symbol: string;
      address: string;
      decimals: number;
      isNative: boolean;
      bitmartSymbol?: string;
      enabled: boolean;
    }) => createFn({ data }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (vars: { id: string; enabled?: boolean; decimals?: number; bitmartSymbol?: string | null }) =>
      updateFn({ data: vars }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const [chain, setChain] = useState<TokenChain>("ethereum");
  const [symbol, setSymbol] = useState("");
  const [address, setAddress] = useState("");
  const [decimals, setDecimals] = useState("18");
  const [isNative, setIsNative] = useState(false);
  const [bitmartSymbol, setBitmartSymbol] = useState("");

  function reset() {
    setSymbol("");
    setAddress("");
    setDecimals("18");
    setIsNative(false);
    setBitmartSymbol("");
  }

  return (
    <div className="space-y-6">
      <div className="bg-secondary/40 border border-border rounded-xl p-5 space-y-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Add a token
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const dec = Number.parseInt(decimals, 10);
            if (!Number.isFinite(dec)) return;
            create.mutate(
              {
                chain,
                symbol: symbol.trim(),
                address: isNative ? "" : address.trim(),
                decimals: dec,
                isNative,
                bitmartSymbol: bitmartSymbol.trim() || undefined,
                enabled: true,
              },
              { onSuccess: () => reset() },
            );
          }}
          className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end"
        >
          <Field label="Chain">
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value as TokenChain)}
              className="w-full bg-background border border-border rounded p-2 font-mono text-xs"
            >
              {TOKEN_CHAINS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Symbol">
            <input
              required
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="GHO"
              className="w-full bg-background border border-border rounded p-2 font-mono text-xs"
            />
          </Field>
          <Field label={isNative ? "Address (n/a)" : "Contract address"}>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              disabled={isNative}
              className="w-full bg-background border border-border rounded p-2 font-mono text-xs disabled:opacity-40"
            />
          </Field>
          <Field label="Decimals">
            <input
              required
              type="number"
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
              min={0}
              max={36}
              className="w-full bg-background border border-border rounded p-2 font-mono text-xs"
            />
          </Field>
          <Field label="Bitmart (non-stable)">
            <input
              value={bitmartSymbol}
              onChange={(e) => setBitmartSymbol(e.target.value.toUpperCase())}
              placeholder="ETH_USDT"
              className="w-full bg-background border border-border rounded p-2 font-mono text-xs"
            />
          </Field>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <input
                type="checkbox"
                checked={isNative}
                onChange={(e) => setIsNative(e.target.checked)}
              />
              Native coin
            </label>
            <button
              type="submit"
              disabled={create.isPending}
              className="bg-accent text-accent-foreground py-2 px-3 rounded font-mono text-[10px] uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? "Adding…" : "Add token"}
            </button>
          </div>
        </form>
        {create.error ? (
          <div className="text-[10px] font-mono text-accent">{(create.error as Error).message}</div>
        ) : null}
        <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
          Stables are priced at par value. For non-stables (e.g. native ETH or other
          volatile tokens), set a Bitmart symbol like <span className="text-foreground">ETH_USDT</span> so
          deposits get repriced at detection. Tokens added here appear instantly in the swap form.
        </p>
      </div>

      <div className="overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-xs font-mono">
          <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
            <tr>
              <th className="text-left p-3">Chain</th>
              <th className="text-left p-3">Symbol</th>
              <th className="text-left p-3">Address</th>
              <th className="text-right p-3">Decimals</th>
              <th className="text-left p-3">Bitmart</th>
              <th className="text-left p-3">Native</th>
              <th className="text-left p-3">Enabled</th>
              <th className="text-right p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {(tokens.data ?? []).map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="p-3">{t.chain}</td>
                <td className="p-3 text-foreground">{t.symbol}</td>
                <td className="p-3 truncate max-w-[20ch]">{t.address}</td>
                <td className="p-3 text-right">{t.decimals}</td>
                <td className="p-3">{t.bitmart_symbol ?? "—"}</td>
                <td className="p-3">{t.is_native ? "yes" : "—"}</td>
                <td className="p-3">
                  <button
                    onClick={() => update.mutate({ id: t.id, enabled: !t.enabled })}
                    className={`px-2 py-1 rounded border ${
                      t.enabled
                        ? "border-success/50 text-success"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {t.enabled ? "on" : "off"}
                  </button>
                </td>
                <td className="p-3 text-right">
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${t.chain}/${t.symbol}? Existing orders are unaffected.`)) {
                        del.mutate(t.id);
                      }
                    }}
                    className="border border-accent/50 text-accent px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!tokens.data?.length && !tokens.isLoading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  No custom tokens yet. The built-in catalog is always available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== Shared balance card =====
function BalanceCard({
  label,
  value,
  error,
}: {
  label: string;
  value: string | null;
  error: string | null;
}) {
  return (
    <div className="bg-secondary/40 border border-border rounded p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {error ? (
        <div className="font-mono text-xs mt-1 text-accent">{error}</div>
      ) : (
        <div className="font-mono text-lg mt-1">{value ?? "…"}</div>
      )}
    </div>
  );
}

// ===== Market Tab (Bitmart exchange balances) =====
function MarketTab() {
  const balFn = useServerFn(adminBitmartBalances);
  const balances = useQuery({
    queryKey: ["admin", "bitmart-balances"],
    queryFn: () => balFn({}),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Bitmart
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-2 max-w-xl leading-relaxed">
          Live spot balances on the Bitmart exchange account used for
          replenishment buys and TXC/wTXC liquidity.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Bitmart balances
          </div>
          <button
            onClick={() => balances.refetch()}
            className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-1 rounded hover:bg-foreground hover:text-background"
          >
            {balances.isFetching ? "…" : "Refresh"}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {balances.data?.ok
            ? balances.data.items.map((b) => (
                <div key={b.currency} className="bg-secondary/40 border border-border rounded p-4">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    {b.currency}
                  </div>
                  <div className="font-mono text-lg mt-1">{b.available}</div>
                </div>
              ))
            : balances.data?.ok === false
              ? <div className="col-span-full text-xs font-mono text-accent">Bitmart: {balances.data.error}</div>
              : <div className="col-span-full text-[10px] font-mono text-muted-foreground">Loading…</div>}
        </div>
      </div>
    </div>
  );
}

// ===== Reconciliation panel =====
type ReconcileData = {
  usdIn: number;
  usdSpentBuying: number;
  expectedStablesUsd: number;
  actualStablesUsd: number;
  stablesDiff: number;
  evmStablesUsd: number;
  bitmartUsdt: number;
  bitmartTxc: number;
  operatorWtxc: number;
  bitmartTxcUsd: number;
  operatorWtxcUsd: number;
  txcDebt: number;
  wtxcDebt: number;
  txcDebtUsd: number;
  wtxcDebtUsd: number;
  txcPrice: number;
  netPositionUsd: number;
  orderCount: number;
  pendingTxcBuys: number;
  pendingWtxcBuys: number;
  bitmartError: string | null;
  evmError: string | null;
};

function ReconcilePanel({
  data: r,
  onRefetch,
  loading,
}: {
  data: ReconcileData;
  onRefetch: () => void;
  loading: boolean;
}) {
  return (
    <div className="border border-border bg-secondary/30 rounded-xl p-5 space-y-4">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Asset debt
          </div>
          <p className="text-[11px] font-mono text-muted-foreground mt-2 max-w-xl leading-relaxed">
            TXC and wTXC we have paid out to customers minus what we have re-bought.
            Positive numbers mean we still owe assets to the hot wallet.
          </p>
        </div>
        <button
          onClick={onRefetch}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border">
        <div className="bg-background/60 border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            TXC debt owed
          </div>
          <div className="font-mono text-lg mt-1">{r.txcDebt.toFixed(4)} TXC</div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {r.pendingTxcBuys} pending buys
          </div>
        </div>
        <div className="bg-background/60 border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            wTXC debt owed
          </div>
          <div className="font-mono text-lg mt-1">{r.wtxcDebt.toFixed(4)} wTXC</div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {r.pendingWtxcBuys} pending buys
          </div>
        </div>
      </div>

      {(r.bitmartError || r.evmError) ? (
        <div className="text-[10px] font-mono text-accent space-y-1">
          {r.evmError ? <div>EVM scan: {r.evmError}</div> : null}
          {r.bitmartError ? <div>Bitmart: {r.bitmartError}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
