import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  adminBitmartBalances,
  adminListOrders,
  adminRetryOrder,
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
            Admin <span className="text-accent">/</span> Orders
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
      options: {
        emailRedirectTo: `${window.location.origin}/admin`,
      },
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="max-w-sm space-y-3 bg-secondary/40 border border-border rounded-xl p-6">
        <div className="text-[10px] font-mono uppercase tracking-widest text-accent">
          Magic link sent
        </div>
        <p className="text-sm font-mono text-muted-foreground leading-relaxed">
          Check <span className="text-foreground">{email}</span> for a sign-in link. It will return you here.
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
        Only emails whose accounts have the admin role can access this console.
      </p>
    </form>
  );
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const listFn = useServerFn(adminListOrders);
  const balFn = useServerFn(adminBitmartBalances);
  const retryFn = useServerFn(adminRetryOrder);

  const orders = useQuery({
    queryKey: ["admin", "orders"],
    queryFn: () => listFn({ data: { limit: 100 } }),
    refetchInterval: 10_000,
  });
  const balances = useQuery({
    queryKey: ["admin", "balances"],
    queryFn: () => balFn({}),
    refetchInterval: 30_000,
  });

  const retry = useMutation({
    mutationFn: (publicId: string) => retryFn({ data: { publicId } }),
    onSuccess: () => orders.refetch(),
  });

  const ordersErr = orders.error as Error | null;

  return (
    <div className="space-y-10">
      <div className="flex justify-between items-start">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1 mr-6">
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
              : null}
        </div>
        <button
          onClick={onSignOut}
          className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 rounded hover:bg-foreground hover:text-background transition-colors"
        >
          Sign Out
        </button>
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
