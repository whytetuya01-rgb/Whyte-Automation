"use client";

import { useEffect, useState } from "react";

export interface CompanyContextState {
  /** False until we know; only a Super Admin ever has to wait for an answer. */
  ready: boolean;
  /** True for any role that belongs to a company; for a Super Admin, only while acting as one. */
  hasCompanyContext: boolean;
  companyName: string | null;
}

/**
 * Whether the signed-in user is working inside a company. Every role except
 * `super_admin` always is. A Super Admin is only while it has an active
 * "act as company" grant, which lives server-side (see `/api/platform/act-as`).
 * UI hint only: the API re-checks on every request.
 */
export function useCompanyContext(role: string | null | undefined, sessionReady: boolean): CompanyContextState {
  const isSuperAdmin = role?.trim().toLowerCase() === "super_admin";
  const [state, setState] = useState<CompanyContextState>({ ready: false, hasCompanyContext: false, companyName: null });

  useEffect(() => {
    if (!sessionReady) return;
    if (!isSuperAdmin) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/act-as");
        const json = (await res.json().catch(() => null)) as
          | { data?: { actingAsCompany?: boolean; companyName?: string | null } }
          | null;
        if (cancelled) return;
        setState({
          ready: true,
          hasCompanyContext: res.ok && json?.data?.actingAsCompany === true,
          companyName: json?.data?.companyName ?? null,
        });
      } catch {
        if (!cancelled) setState({ ready: true, hasCompanyContext: false, companyName: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionReady, isSuperAdmin]);

  if (!isSuperAdmin) {
    return { ready: sessionReady, hasCompanyContext: true, companyName: null };
  }
  return state;
}
