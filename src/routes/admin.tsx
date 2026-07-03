import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { ThemeToggle } from "@/components/theme-toggle";

import { supabase } from "@/integrations/supabase/client";
import {
  adminAddBlockedAddress,
  adminAuditLog,
  adminEthDerivedBalances,
  adminForceComplete,
  adminForceFail,
  adminFundEthGas,
  adminFundWtxc,
  adminGetSettings,
  adminHotWalletBalances,
  adminInviteAdmin,
  adminListAdmins,
  adminListBlockedAddresses,
  adminListOrders,
  adminRemoveBlockedAddress,
  adminSearchOrders,

  adminOrderDetail,
  adminRetryOrder,
  adminRevokeAdmin,
  adminSweepWtxc,
  adminTelegramTest,
  adminTxcBalanceHistory,
  adminTxcTxHistory,
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

type Tab = "orders" | "treasury" | "wallet" | "settings" | "admins" | "blocklist" | "audit";

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
    { id: "treasury", label: "TXC Wallet" },
    { id: "wallet", label: "ETH Wallet" },
    { id: "settings", label: "Settings" },
    { id: "admins", label: "Admins" },
    { id: "blocklist", label: "Blocklist" },
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
      {tab === "treasury" && <TxcWalletTab />}
      {tab === "wallet" && <EthWalletTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "admins" && <AdminsTab />}
      {tab === "blocklist" && <BlocklistTab />}
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
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "completed" | "canceled" | "failed">("all");

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
    if (statusFilter === "canceled") return o.status === "canceled";
    if (statusFilter === "failed") return FAILED_STATUSES.has(o.status);
    // open = anything not completed, canceled, or in a failed/terminal state
    return !FAILED_STATUSES.has(o.status) && o.status !== "completed" && o.status !== "canceled";
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
          {(["all", "open", "completed", "canceled", "failed"] as const).map((s) => (
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

  const { order, deposits, events, audit, hotBalance } = q.data;
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
        <KV k="From" v={firstDeposit?.from_address ?? "—"} mono />
        <KV k="To" v={firstDeposit?.to_address ?? order.deposit_address} mono />
        <KV k="Tx hash" v={firstDeposit?.tx_hash ?? order.paid_tx_hash ?? "—"} mono />
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

// ===== TXC Wallet Tab =====
function TxcWalletTab() {
  const hotFn = useServerFn(adminHotWalletBalances);
  const txHistFn = useServerFn(adminTxcTxHistory);
  const balHistFn = useServerFn(adminTxcBalanceHistory);

  const hot = useQuery({
    queryKey: ["admin", "hot-wallet-balances"],
    queryFn: () => hotFn({}),
    refetchInterval: 60_000,
  });
  const txs = useQuery({
    queryKey: ["admin", "txc-tx-history"],
    queryFn: () => txHistFn({ data: { limit: 25 } }),
    refetchInterval: 60_000,
  });
  const hist = useQuery({
    queryKey: ["admin", "txc-balance-history"],
    queryFn: () => balHistFn({ data: { hours: 168 } }),
    refetchInterval: 5 * 60_000,
  });

  const txc = hot.data?.txc;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            TXC Wallet
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-2 max-w-xl leading-relaxed">
            The TXC hot wallet holds native TXC used to pay unwrap orders.
            Balance snapshots record whenever this page refreshes.
          </p>
        </div>
        <button
          onClick={() => { hot.refetch(); txs.refetch(); hist.refetch(); }}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background"
        >
          {hot.isFetching || txs.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!txc ? (
        <div className="text-[10px] font-mono text-muted-foreground">Loading TXC wallet…</div>
      ) : txc.ok === false ? (
        <div className="text-xs font-mono text-accent">TXC hot wallet: {txc.error}</div>
      ) : (
        <div className="border border-accent/40 bg-accent/5 rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-widest text-accent">
                TXC hot wallet address
              </div>
              <div className="font-mono text-sm mt-2 break-all">{txc.address}</div>
              <div className="flex gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => navigator.clipboard.writeText(txc.address)}
                  className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-1.5 rounded hover:bg-foreground hover:text-background"
                >
                  Copy
                </button>
                <a
                  href={`https://mempool.texitcoin.org/address/${txc.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-1.5 rounded hover:bg-foreground hover:text-background"
                >
                  View on mempool.texitcoin.org ↗
                </a>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Balance
              </div>
              <div className="font-mono text-2xl mt-1">
                {txc.confirmed.toFixed(4)} <span className="text-sm">TXC</span>
              </div>
              {txc.unconfirmed ? (
                <div className="text-[10px] font-mono text-muted-foreground">
                  +{txc.unconfirmed.toFixed(4)} pending
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="border border-border rounded-xl p-5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Balance history · 7 days
        </div>
        {hist.data && hist.data.length >= 2 ? (
          <BalanceSparkline points={hist.data} />
        ) : (
          <div className="text-[10px] font-mono text-muted-foreground py-6">
            Not enough snapshots yet — chart will populate as balances refresh over time.
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Recent transactions
        </div>
        {txs.error ? (
          <div className="text-xs font-mono text-accent">
            {(txs.error as Error).message}
          </div>
        ) : txs.data ? (
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-xs font-mono">
              <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
                <tr>
                  <th className="text-left p-3">When</th>
                  <th className="text-left p-3">Dir</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-left p-3">Counterparty</th>
                  <th className="text-left p-3">Txid</th>
                </tr>
              </thead>
              <tbody>
                {txs.data.txs.map((t) => (
                  <tr key={t.txid} className="border-t border-border">
                    <td className="p-3 text-muted-foreground">
                      {t.blockTime
                        ? new Date(t.blockTime * 1000).toLocaleString()
                        : "pending"}
                    </td>
                    <td className="p-3">
                      <span className={t.direction === "in" ? "text-foreground" : "text-accent"}>
                        {t.direction === "in" ? "IN" : "OUT"}
                      </span>
                    </td>
                    <td className="p-3 text-right">{t.amountTxc.toFixed(4)} TXC</td>
                    <td className="p-3 truncate max-w-[20ch] text-muted-foreground">
                      {t.counterparty ?? "—"}
                    </td>
                    <td className="p-3">
                      <a
                        href={`https://mempool.texitcoin.org/tx/${t.txid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        {t.txid.slice(0, 10)}…
                      </a>
                    </td>
                  </tr>
                ))}
                {!txs.data.txs.length ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      No transactions yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-[10px] font-mono text-muted-foreground">Loading transactions…</div>
        )}
      </div>
    </div>
  );
}

function BalanceSparkline({ points }: { points: Array<{ balance: number; takenAt: string }> }) {
  const W = 720;
  const H = 120;
  const PAD = 8;
  const values = points.map((p) => p.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (W - PAD * 2) / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => {
      const x = PAD + i * step;
      const y = H - PAD - ((p.balance - min) / range) * (H - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-accent" />
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
        <span>{new Date(points[0].takenAt).toLocaleDateString()}</span>
        <span>min {min.toFixed(2)} · max {max.toFixed(2)} · now {last.balance.toFixed(2)} TXC</span>
        <span>{new Date(last.takenAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ===== ETH Wallet Tab =====
function EthWalletTab() {
  const scanFn = useServerFn(adminWalletScan);
  const derivedFn = useServerFn(adminEthDerivedBalances);
  const sweepFn = useServerFn(adminSweepWtxc);
  const fundWtxcFn = useServerFn(adminFundWtxc);
  const fundGasFn = useServerFn(adminFundEthGas);
  const qc = useQueryClient();
  const ALL_CHAINS = ["ethereum", "bsc", "base", "arbitrum", "polygon"] as const;

  const [derivedCount, setDerivedCount] = useState(10);

  const scan = useQuery({
    queryKey: ["admin", "treasury-scan"],
    queryFn: () => scanFn({ data: { chains: ALL_CHAINS as unknown as never } }),
    refetchInterval: 60_000,
  });
  const derived = useQuery({
    queryKey: ["admin", "eth-derived", derivedCount],
    queryFn: () => derivedFn({ data: { count: derivedCount } }),
    refetchInterval: 60_000,
  });

  const sweep = useMutation({
    mutationFn: (fromIndex: number) => sweepFn({ data: { fromIndex } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "eth-derived"] }),
  });

  const [fundTarget, setFundTarget] = useState<{ index: number; kind: "wtxc" | "gas" } | null>(null);
  const [fundAmount, setFundAmount] = useState("");
  const fundWtxc = useMutation({
    mutationFn: (v: { toIndex: number; amountWtxc: number }) => fundWtxcFn({ data: v }),
    onSuccess: () => {
      setFundTarget(null);
      setFundAmount("");
      qc.invalidateQueries({ queryKey: ["admin", "eth-derived"] });
    },
  });
  const fundGas = useMutation({
    mutationFn: (v: { toIndex: number; amountEth: number }) => fundGasFn({ data: v }),
    onSuccess: () => {
      setFundTarget(null);
      setFundAmount("");
      qc.invalidateQueries({ queryKey: ["admin", "eth-derived"] });
    },
  });

  const data = scan.data;
  const admin = data?.addresses.find((a) => a.index === 0) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            ETH Wallet
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-2 max-w-xl leading-relaxed">
            HD-derived EVM addresses. Index <span className="text-foreground">#0</span> is the
            operator (holds wTXC + ETH gas, signs payouts). Indices #1+ are per-order
            deposit slots — sweep them back to #0 after use.
          </p>
        </div>
        <button
          onClick={() => { scan.refetch(); derived.refetch(); }}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background"
        >
          {scan.isFetching || derived.isFetching ? "Scanning…" : "Refresh"}
        </button>
      </div>

      {admin ? (
        <div className="border border-accent/40 bg-accent/5 rounded-xl p-5 space-y-3">
          <div className="flex justify-between items-start gap-3 flex-wrap">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-accent">
                Operator · index #0
              </div>
              <div className="font-mono text-sm mt-2 break-all">{admin.address}</div>
            </div>
            <a
              href={`https://etherscan.io/address/${admin.address}`}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-1.5 rounded hover:bg-foreground hover:text-background"
            >
              Etherscan ↗
            </a>
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex justify-between items-end flex-wrap gap-3 mb-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Derived addresses (wTXC + ETH)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDerivedCount((n) => Math.max(1, n - 5))}
              className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background"
            >
              -5
            </button>
            <button
              onClick={() => setDerivedCount((n) => n + 5)}
              className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background"
            >
              +5
            </button>
          </div>
        </div>
        {derived.error ? (
          <div className="text-xs font-mono text-accent">
            {(derived.error as Error).message}
          </div>
        ) : derived.data ? (
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-xs font-mono">
              <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
                <tr>
                  <th className="text-left p-3">#</th>
                  <th className="text-left p-3">Address</th>
                  <th className="text-right p-3">ETH</th>
                  <th className="text-right p-3">wTXC</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {derived.data.rows.map((r) => (
                  <tr key={r.address} className="border-t border-border">
                    <td className="p-3">
                      {r.index}
                      {r.index === 0 ? (
                        <span className="ml-1 text-[9px] uppercase tracking-widest text-accent">op</span>
                      ) : null}
                    </td>
                    <td className="p-3 truncate max-w-[22ch]">
                      <a
                        href={`https://etherscan.io/address/${r.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground text-muted-foreground"
                      >
                        {r.address.slice(0, 10)}…{r.address.slice(-6)}
                      </a>
                    </td>
                    <td className="p-3 text-right">
                      {r.eth > 0 ? r.eth.toFixed(6) : "—"}
                    </td>
                    <td className="p-3 text-right">
                      {r.wtxc > 0 ? r.wtxc.toFixed(4) : "—"}
                    </td>
                    <td className="p-3 text-right">
                      {r.index === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex gap-1 justify-end flex-wrap">
                          <button
                            onClick={() => { setFundTarget({ index: r.index, kind: "wtxc" }); setFundAmount(""); }}
                            className="text-[9px] font-mono uppercase tracking-widest border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background"
                          >
                            Fund wTXC
                          </button>
                          <button
                            onClick={() => { setFundTarget({ index: r.index, kind: "gas" }); setFundAmount(""); }}
                            className="text-[9px] font-mono uppercase tracking-widest border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background"
                          >
                            Fund gas
                          </button>
                          <button
                            disabled={r.wtxc <= 0 || sweep.isPending}
                            onClick={() => {
                              if (confirm(`Sweep ${r.wtxc.toFixed(4)} wTXC from #${r.index} → operator?`)) {
                                sweep.mutate(r.index);
                              }
                            }}
                            className="text-[9px] font-mono uppercase tracking-widest border border-accent bg-accent/10 text-accent px-2 py-1 rounded hover:bg-accent hover:text-background disabled:opacity-30"
                          >
                            Sweep wTXC
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-[10px] font-mono text-muted-foreground">Loading…</div>
        )}

        {sweep.data ? (
          <div className="text-[11px] font-mono mt-2">
            ✓ Swept {sweep.data.amountWtxc.toFixed(4)} wTXC ·{" "}
            <a
              href={`https://etherscan.io/tx/${sweep.data.txid}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {sweep.data.txid.slice(0, 12)}…
            </a>
          </div>
        ) : null}
        {sweep.error ? (
          <div className="text-[11px] font-mono text-accent mt-2">
            ✗ Sweep failed: {(sweep.error as Error).message}
          </div>
        ) : null}
      </div>

      {fundTarget ? (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur flex items-center justify-center p-4 z-50"
          onClick={() => setFundTarget(null)}
        >
          <div
            className="bg-background border border-border rounded-xl p-6 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Fund {fundTarget.kind === "wtxc" ? "wTXC" : "ETH gas"} → index #{fundTarget.index}
            </div>
            <input
              autoFocus
              type="number"
              step="any"
              min={0}
              placeholder={fundTarget.kind === "wtxc" ? "wTXC amount" : "ETH amount"}
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              className="w-full px-3 py-2 bg-secondary/40 border border-border rounded font-mono text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setFundTarget(null)}
                className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background"
              >
                Cancel
              </button>
              <button
                disabled={fundWtxc.isPending || fundGas.isPending}
                onClick={() => {
                  const n = parseFloat(fundAmount);
                  if (!Number.isFinite(n) || n <= 0) return;
                  if (fundTarget.kind === "wtxc") {
                    fundWtxc.mutate({ toIndex: fundTarget.index, amountWtxc: n });
                  } else {
                    fundGas.mutate({ toIndex: fundTarget.index, amountEth: n });
                  }
                }}
                className="text-[10px] font-mono uppercase tracking-widest border border-accent bg-accent/10 text-accent px-4 py-2 rounded hover:bg-accent hover:text-background disabled:opacity-50"
              >
                {fundWtxc.isPending || fundGas.isPending ? "Sending…" : "Send"}
              </button>
            </div>
            {(fundWtxc.error || fundGas.error) ? (
              <div className="text-[11px] font-mono text-accent">
                ✗ {((fundWtxc.error ?? fundGas.error) as Error).message}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {scan.error ? (
        <div className="text-xs font-mono text-accent">
          {(scan.error as Error).message}
        </div>
      ) : null}
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
    wrap_fee_bps: number;
    unwrap_fee_bps: number;
    low_txc_threshold: number;
    low_wtxc_threshold: number;
    payouts_frozen: boolean;
    payouts_frozen_reason: string;
    telegram_chat_id: string;
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
        wrap_fee_bps: Number(settings.data.wrap_fee_bps ?? 500),
        unwrap_fee_bps: Number(settings.data.unwrap_fee_bps ?? 0),
        low_txc_threshold: Number(settings.data.low_txc_threshold ?? 10_000),
        low_wtxc_threshold: Number(settings.data.low_wtxc_threshold ?? 10_000),
        payouts_frozen: Boolean((settings.data as { payouts_frozen?: boolean }).payouts_frozen),
        payouts_frozen_reason:
          (settings.data as { payouts_frozen_reason?: string | null }).payouts_frozen_reason ?? "",
        telegram_chat_id:
          (settings.data as { telegram_chat_id?: string | null }).telegram_chat_id ?? "",
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
          telegram_chat_id: form!.telegram_chat_id.trim() || null,
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
        <Field label="Wrap fee (basis points, 100 = 1%)">
          <NumberInput value={form.wrap_fee_bps} onChange={(v) => set("wrap_fee_bps", Math.round(v))} />
          <Hint>{(form.wrap_fee_bps / 100).toFixed(2)}% charged on TXC → wTXC (shown on homepage)</Hint>
        </Field>
        <Field label="Unwrap fee (basis points, 100 = 1%)">
          <NumberInput value={form.unwrap_fee_bps} onChange={(v) => set("unwrap_fee_bps", Math.round(v))} />
          <Hint>{(form.unwrap_fee_bps / 100).toFixed(2)}% charged on wTXC → TXC (shown on homepage)</Hint>
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
        <Field label="Notify chat / group ID">
          <input
            type="text"
            value={form.telegram_chat_id}
            onChange={(e) => set("telegram_chat_id", e.target.value)}
            placeholder="-1001234567890 or @channelname"
            className="w-full bg-background border border-border rounded p-2 font-mono text-sm focus:outline-none focus:border-accent"
          />
          <Hint>
            Group ID (starts with <code>-100</code>), user ID, or <code>@channel</code>. Save
            settings before testing. Add the bot to the group first.
          </Hint>
        </Field>
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


// ===== Blocklist Tab =====
function BlocklistTab() {
  const listFn = useServerFn(adminListBlockedAddresses);
  const addFn = useServerFn(adminAddBlockedAddress);
  const removeFn = useServerFn(adminRemoveBlockedAddress);
  const qc = useQueryClient();

  const blocked = useQuery({
    queryKey: ["admin", "blocklist"],
    queryFn: () => listFn({}),
  });

  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addFn({
        data: {
          address: address.trim(),
          reason: reason.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      setAddress("");
      setReason("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["admin", "blocklist"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "blocklist"] }),
  });

  return (
    <div className="space-y-6">
      <div className="border border-border rounded p-4 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Add address
        </div>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x… or txc1q…"
          className="w-full bg-background border border-border rounded p-2 font-mono text-xs focus:outline-none focus:border-accent"
        />
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (short)"
          className="w-full bg-background border border-border rounded p-2 font-mono text-xs focus:outline-none focus:border-accent"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full bg-background border border-border rounded p-2 font-mono text-xs focus:outline-none focus:border-accent"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => add.mutate()}
            disabled={add.isPending || !address.trim()}
            className="bg-accent text-accent-foreground px-4 py-2 rounded font-mono text-xs uppercase tracking-widest hover:opacity-90 disabled:opacity-50"
          >
            {add.isPending ? "Blocking…" : "Block address"}
          </button>
          {add.error ? (
            <span className="text-[10px] font-mono text-accent">
              {(add.error as Error).message}
            </span>
          ) : null}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          Blocks the address from being used as a destination on new orders. Compared
          case-insensitively. Existing orders are not affected.
        </div>
      </div>

      {blocked.isLoading ? (
        <div className="text-[10px] font-mono text-muted-foreground">Loading…</div>
      ) : blocked.error ? (
        <div className="text-xs font-mono text-accent">
          {(blocked.error as Error).message}
        </div>
      ) : (blocked.data ?? []).length === 0 ? (
        <div className="text-[10px] font-mono text-muted-foreground">No blocked addresses.</div>
      ) : (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-secondary/40">
              <tr>
                <th className="text-left p-2 font-normal text-[10px] uppercase tracking-widest text-muted-foreground">Address</th>
                <th className="text-left p-2 font-normal text-[10px] uppercase tracking-widest text-muted-foreground">Reason</th>
                <th className="text-left p-2 font-normal text-[10px] uppercase tracking-widest text-muted-foreground">Notes</th>
                <th className="text-left p-2 font-normal text-[10px] uppercase tracking-widest text-muted-foreground">Blocked</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(blocked.data ?? []).map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="p-2 break-all">{b.address}</td>
                  <td className="p-2">{b.reason ?? "—"}</td>
                  <td className="p-2 whitespace-pre-wrap max-w-md">{b.notes ?? "—"}</td>
                  <td className="p-2 text-muted-foreground">
                    {new Date(b.created_at).toLocaleString()}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Unblock ${b.address}?`)) remove.mutate(b.id);
                      }}
                      disabled={remove.isPending}
                      className="text-[10px] font-mono uppercase tracking-widest border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background disabled:opacity-50"
                    >
                      Unblock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
