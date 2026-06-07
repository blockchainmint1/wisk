import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  adminAuditLog,
  adminBitmartBalances,
  adminGetSettings,
  adminInviteAdmin,
  adminListAdmins,
  adminListOrders,
  adminRetryOrder,
  adminRevokeAdmin,
  adminTelegramTest,
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

type Tab = "orders" | "treasury" | "wallet" | "settings" | "admins" | "audit";

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
        <button
          onClick={onSignOut}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background transition-colors"
        >
          Sign Out
        </button>
      </div>

      {tab === "orders" && <OrdersTab />}
      {tab === "treasury" && <TreasuryTab />}
      {tab === "wallet" && <WalletTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "admins" && <AdminsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

// ===== Orders Tab =====
function OrdersTab() {
  const listFn = useServerFn(adminListOrders);
  const balFn = useServerFn(adminBitmartBalances);
  const retryFn = useServerFn(adminRetryOrder);

  const orders = useQuery({
    queryKey: ["admin", "orders"],
    queryFn: () => listFn({ data: { limit: 100 } }),
    refetchInterval: 10_000,
  });
  const balances = useQuery({
    queryKey: ["admin", "bitmart-balances"],
    queryFn: () => balFn({}),
    refetchInterval: 30_000,
  });
  const retry = useMutation({
    mutationFn: (publicId: string) => retryFn({ data: { publicId } }),
    onSuccess: () => orders.refetch(),
  });

  const ordersErr = orders.error as Error | null;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
          Bitmart balances
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

      {ordersErr ? (
        <div className="text-xs font-mono text-accent">{ordersErr.message}</div>
      ) : null}

      <div className="overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-xs font-mono">
          <thead className="bg-secondary/40 text-muted-foreground uppercase tracking-widest text-[10px]">
            <tr>
              <th className="text-left p-3">Order</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Source</th>
              <th className="text-right p-3">USD</th>
              <th className="text-right p-3">TXC</th>
              <th className="text-left p-3">Dest</th>
              <th className="text-left p-3">Created</th>
              <th className="text-right p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.data?.map((o) => (
              <tr key={o.public_id} className="border-t border-border">
                <td className="p-3">{o.public_id}</td>
                <td className="p-3">
                  <span className="text-accent">{o.status.replace(/_/g, " ")}</span>
                  {o.error_message ? (
                    <div className="text-[10px] text-muted-foreground">{o.error_message}</div>
                  ) : null}
                </td>
                <td className="p-3">{o.source_chain} · {o.source_token}</td>
                <td className="p-3 text-right">${Number(o.source_amount_usd).toFixed(2)}</td>
                <td className="p-3 text-right">
                  {o.bitmart_filled_txc != null
                    ? Number(o.bitmart_filled_txc).toFixed(4)
                    : Number(o.quoted_txc_out).toFixed(4)}
                </td>
                <td className="p-3 truncate max-w-[14ch]">{o.dest_txc_address}</td>
                <td className="p-3">{new Date(o.created_at).toLocaleString()}</td>
                <td className="p-3 text-right">
                  {o.status === "failed" ? (
                    <button
                      onClick={() => retry.mutate(o.public_id)}
                      className="border border-border px-2 py-1 rounded hover:bg-foreground hover:text-background"
                    >
                      Retry
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!orders.data?.length && !orders.isLoading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  No orders yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
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
                    <div className="font-mono text-sm mt-1">
                      ${c.totalStableUsd.toFixed(2)}{" "}
                      <span className="text-muted-foreground text-[10px]">stables</span>
                    </div>
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
                  <th className="text-right p-3">Stables (USD)</th>
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
                    <td className="p-3 text-right">
                      {a.totalUsd > 0 ? `$${a.totalUsd.toFixed(2)}` : "—"}
                      {a.tokens.some((t) => t.balance > 0) ? (
                        <div className="text-[10px] text-muted-foreground">
                          {a.tokens
                            .filter((t) => t.balance > 0)
                            .map((t) => `${t.balance.toFixed(2)} ${t.symbol}`)
                            .join(" · ")}
                        </div>
                      ) : null}
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
      });
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          ...form!,
          paused_reason: form!.paused_reason.trim() || null,
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
        <Field label="Min order size (USD)">
          <NumberInput value={form.min_usd} onChange={(v) => set("min_usd", v)} />
        </Field>
        <Field label="Max order size (USD)">
          <NumberInput value={form.max_usd} onChange={(v) => set("max_usd", v)} />
        </Field>
        <Field label="Telegram: min USD for new-order alerts">
          <NumberInput value={form.notify_min_usd_created} onChange={(v) => set("notify_min_usd_created", v)} />
          <Hint>0 = notify every order</Hint>
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
