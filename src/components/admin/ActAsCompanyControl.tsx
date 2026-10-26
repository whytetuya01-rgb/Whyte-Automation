"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Building2, LogOut, X } from "lucide-react";
import { SearchableSelect, type SelectOption } from "@/components/ui/SearchableSelect";

interface ActAsState {
  actingAsCompany: boolean;
  companyId: number | null;
  companyName: string | null;
  reason: string | null;
  expiresAt: string | null;
}

interface CompanyOption {
  id: number;
  name: string;
  slug: string;
  status: string;
}

const REASON_MAX = 500;
const POLL_MS = 60_000;

async function readJson<T>(res: Response): Promise<{ data?: T; error?: { message?: string } } | null> {
  return (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
}

/**
 * Super Admin "Act as company" control. Renders nothing for any other role.
 *
 * Starting a session POSTs to the audited `/api/platform/act-as` (reason is
 * mandatory); the grant itself lives server-side in an httpOnly cookie, so this
 * component only reflects state — the API re-checks on every request. The
 * banner is always visible while a grant is active, and Exit ends it.
 */
export default function ActAsCompanyControl() {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role?.trim().toLowerCase();
  const isSuperAdmin = role === "super_admin";

  const [state, setState] = useState<ActAsState | null>(null);
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companyId, setCompanyId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/act-as", { headers: { "x-skip-api-loader": "true" } });
      const json = await readJson<ActAsState>(res);
      if (res.ok && json?.data) return json.data;
    } catch {
      // Treated as "not acting": the safe default.
    }
    return { actingAsCompany: false, companyId: null, companyName: null, reason: null, expiresAt: null } satisfies ActAsState;
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      setLoadingCompanies(true);
      const res = await fetch("/api/platform/companies");
      const json = await readJson<CompanyOption[]>(res);
      if (res.ok && json?.data) {
        const list = json.data;
        setCompanies(list);
        if (list.length === 1 && !companyId) {
          setCompanyId(String(list[0].id));
        }
      }
    } catch {
      // Handled during openDialog if failed
    } finally {
      setLoadingCompanies(false);
    }
  }, [companyId]);

  // Preload companies immediately when Super Admin is active so opening the dialog has zero delay
  useEffect(() => {
    if (isSuperAdmin) {
      void loadCompanies();
    }
  }, [isSuperAdmin, loadCompanies]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    const tick = async () => {
      const next = await refresh();
      if (cancelled) return;
      setState((prev) => {
        // The grant expired (or was ended elsewhere): reload so every screen drops company data.
        if (prev?.actingAsCompany && !next.actingAsCompany) window.location.reload();
        return next;
      });
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isSuperAdmin, refresh]);

  const openDialog = async () => {
    setError(null);
    setOpen(true);
    if (companies.length === 0) {
      void loadCompanies();
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/act-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: Number(companyId), reason: reason.trim() }),
      });
      const json = await readJson<unknown>(res);
      if (!res.ok) throw new Error(json?.error?.message ?? "Could not start the session.");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the session.");
      setBusy(false);
    }
  };

  const exit = async () => {
    setBusy(true);
    try {
      await fetch("/api/platform/act-as", { method: "DELETE" });
    } finally {
      window.location.reload();
    }
  };

  // Hooks must run on every render, so this stays above the early return below.
  const companyOptions: SelectOption[] = useMemo(() => {
    return companies.map((c) => ({
      value: String(c.id),
      label: c.name,
      badge: c.status,
    }));
  }, [companies]);

  if (status !== "authenticated" || !isSuperAdmin) return null;

  const canStart = companyId !== "" && reason.trim().length > 0 && reason.trim().length <= REASON_MAX && !busy;

  return (
    <>
      <div className="flex items-center gap-2" data-testid="act-as-control">
        {state?.actingAsCompany ? (
          <>
            <span
              className="inline-flex items-center gap-1.5 max-w-[40vw] truncate rounded-md border border-amber-400/40 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-200"
              data-testid="act-as-chip"
            >
              <Building2 size={12} className="shrink-0" />
              <span className="truncate">Acting as {state.companyName ?? `Company ${state.companyId}`}</span>
            </span>
            <button
              type="button"
              onClick={exit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] font-semibold text-neutral-200 hover:bg-white/10 disabled:opacity-50 cursor-pointer"
              data-testid="act-as-exit"
            >
              <LogOut size={12} /> Exit
            </button>
          </>
        ) : state ? (
          <button
            type="button"
            onClick={openDialog}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-neutral-200 hover:bg-white/10 cursor-pointer"
            data-testid="act-as-open"
          >
            <Building2 size={12} /> Act as company
          </button>
        ) : null}
      </div>

      {state?.actingAsCompany && (
        <div
          role="status"
          className="fixed left-0 right-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-black"
          data-testid="act-as-banner"
        >
          <span>
            You are acting as <strong>{state.companyName ?? `Company ${state.companyId}`}</strong>. Actions are audit-logged.
          </span>
          {state.reason && <span className="font-normal">Reason: {state.reason}</span>}
          {state.expiresAt && (
            <span className="font-normal">Expires {new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          )}
          <button type="button" onClick={exit} disabled={busy} className="underline cursor-pointer" data-testid="act-as-banner-exit">
            Exit
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Act as company">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl text-neutral-900 border border-neutral-100" data-testid="act-as-dialog">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-950">Act as company</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer text-neutral-400 hover:text-neutral-900 p-1 rounded-lg hover:bg-neutral-100 transition-colors">
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-xs text-neutral-500 leading-relaxed">
              Company data is only visible while acting as a company. Every session is audit-logged with your reason and expires automatically after 4 hours.
            </p>

            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-bold text-neutral-700" htmlFor="act-as-company-searchable">
                Company
              </label>
              <SearchableSelect
                id="act-as-company-searchable"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                options={companyOptions}
                placeholder={loadingCompanies && companies.length === 0 ? "Loading companies..." : "Select a company…"}
                searchPlaceholder="Search company by name or slug..."
                emptyText={loadingCompanies ? "Loading companies..." : "No companies found"}
                disabled={loadingCompanies && companies.length === 0}
                triggerClassName="w-full rounded-xl border border-neutral-300 bg-white text-sm shadow-2xs hover:border-neutral-400"
              />
              {/* Synchronized select for browser automation & accessibility */}
              <select
                id="act-as-company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="sr-only absolute h-0 w-0 opacity-0 pointer-events-none"
                data-testid="act-as-company"
                tabIndex={-1}
                aria-hidden="true"
              >
                <option value="">Select a company…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-2">
              <label className="mb-1.5 block text-xs font-bold text-neutral-700" htmlFor="act-as-reason">
                Reason (required)
              </label>
              <textarea
                id="act-as-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
                rows={3}
                className="w-full rounded-xl border border-neutral-300 p-3 text-sm focus:outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 transition-colors shadow-2xs"
                placeholder="Why do you need to act as this company?"
                data-testid="act-as-reason"
              />
              <div className="mt-1 text-right text-[11px] text-neutral-400">{reason.length}/{REASON_MAX}</div>
            </div>

            {error && (
              <p className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700 font-medium" role="alert" data-testid="act-as-error">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={start}
                disabled={!canStart}
                className="rounded-xl bg-neutral-950 hover:bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 transition cursor-pointer shadow-xs"
                data-testid="act-as-start"
              >
                {busy ? "Starting…" : "Start session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
