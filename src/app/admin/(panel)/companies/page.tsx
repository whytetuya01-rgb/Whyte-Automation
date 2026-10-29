"use client";

import { useCallback, useEffect, useState } from "react";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { AlertCircle, Building, CheckCircle2, Clock, Eye, Mail, MapPin, Phone, Power, PowerOff, RefreshCw, User, XCircle } from "lucide-react";
import { apiJson, toErrorMessage } from "@/lib/apiClient";
import notify from "@/lib/notify";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Modal from "@/components/shared/Modal";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { RegistrationListItem, ReviewTab } from "@/lib/companyReview";

interface Listing {
  items: RegistrationListItem[];
  counts: Record<ReviewTab, number>;
}

const TABS: ReadonlyArray<{ key: ReviewTab; label: string }> = [
  { key: "pending_review", label: "Incoming Review Requests" },
  { key: "approved", label: "Approved Companies" },
  { key: "rejected", label: "Rejected Companies" },
];

const STATUS_STYLE: Record<RegistrationListItem["registrationStatus"], { label: string; className: string }> = {
  pending_review: { label: "Pending Review", className: "border-amber-200 bg-amber-50 text-amber-700" },
  approved: { label: "Approved", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", className: "border-red-200 bg-red-50 text-red-700" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusPill({ status, deactivated = false }: { status: RegistrationListItem["registrationStatus"]; deactivated?: boolean }) {
  const style = STATUS_STYLE[status];
  return (
    <>
      <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", style.className)} data-testid="registration-status">
        {style.label}
      </span>
      {deactivated && (
        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700" data-testid="deactivated-pill">
          <PowerOff size={11} /> Deactivated
        </span>
      )}
    </>
  );
}

function EmailStatus({ item }: { item: RegistrationListItem }) {
  if (!item.decisionEmail) return <span className="text-gray-500">No email was sent</span>;
  const { status, kind, attempts, lastError } = item.decisionEmail;
  const what = kind === "approved" ? "Approval email" : "Rejection email";
  if (status === "sent") return <span className="text-emerald-700">{what} delivered</span>;
  if (status === "pending") return <span className="text-amber-700">{what} sending…</span>;
  return (
    <span className="text-red-700">
      {what} failed{lastError ? ` (${lastError})` : ""} after {attempts} attempt{attempts === 1 ? "" : "s"}
    </span>
  );
}

export default function CompaniesPage() {
  const [tab, setTab] = useState<ReviewTab>("pending_review");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [details, setDetails] = useState<RegistrationListItem | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "approve" | "reject" | "deactivate" | "reactivate"; item: RegistrationListItem } | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [notifyOwner, setNotifyOwner] = useState(false);

  const load = useCallback(async (which: ReviewTab) => {
    setLoading(true);
    setLoadError(null);
    try {
      setListing(await apiJson.get<Listing>(`/api/platform/company-registrations?status=${which}`));
    } catch (error) {
      setLoadError(toErrorMessage(error, "Could not load company requests."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const openConfirm = (kind: "approve" | "reject" | "deactivate" | "reactivate", item: RegistrationListItem) => {
    setRejectNote("");
    setNotifyOwner(false);
    setConfirm({ kind, item });
  };

  const decide = async () => {
    if (!confirm || busyId !== null) return;
    const { kind, item } = confirm;
    setBusyId(item.id);
    try {
      if (kind === "approve") {
        const result = await apiJson.post<{ registration: RegistrationListItem; changed: boolean }>(`/api/platform/company-registrations/${item.id}/approve`);
        if (result.registration.decisionEmail?.status === "failed") {
          notify.error("Approved, but the email was not delivered", "Use Resend email on the company to try again.");
        } else {
          notify.success(result.changed ? "Company approved" : "Already approved", result.changed ? `${item.name} can now sign in.` : undefined);
        }
      } else if (kind === "reject") {
        await apiJson.post(`/api/platform/company-registrations/${item.id}/reject`, { note: rejectNote.trim() || undefined, notifyOwner });
        notify.success("Request rejected", `${item.name} cannot sign in.`);
      } else {
        await apiJson.post(`/api/platform/company-registrations/${item.id}/${kind}`);
        notify.success(kind === "deactivate" ? "Company deactivated" : "Company reactivated", kind === "deactivate" ? `No one from ${item.name} can sign in now.` : `${item.name} can sign in again.`);
      }
      setConfirm(null);
      setDetails(null);
      await load(tab);
    } catch (error) {
      notify.error(`Could not ${kind}`, toErrorMessage(error));
      await load(tab);
      setConfirm(null);
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (item: RegistrationListItem) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    try {
      const updated = await apiJson.post<RegistrationListItem>(`/api/platform/company-registrations/${item.id}/resend-email`);
      setDetails(updated);
      if (updated.decisionEmail?.status === "sent") notify.success("Email delivered");
      else notify.error("The email still could not be delivered", "Check the email provider settings and try again.");
      await load(tab);
    } catch (error) {
      notify.error("Could not resend", toErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const items = listing?.items ?? [];

  return (
    <div className="w-full">
      <PageHeader
        title="Companies"
        icon={Building}
        subtitle="Review companies that registered themselves, and see every approved or rejected company."
        className="mb-4 sm:mb-6"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void load(tab)} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />

      <div role="tablist" aria-label="Company review status" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`tab-${key}`}
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition",
              tab === key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            )}
          >
            {label}
            {listing && (
              <span className={cn("rounded-full px-2 text-xs", tab === key ? "bg-white/20" : "bg-gray-100 text-gray-600")}>{listing.counts[key]}</span>
            )}
          </button>
        ))}
      </div>

      {loadError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {loading && !listing ? (
        <LoadingSpinner />
      ) : items.length === 0 && !loadError ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500" data-testid="empty-state">
          <Clock size={28} className="mx-auto mb-2 text-gray-300" />
          {tab === "pending_review" ? "No requests are waiting for review." : tab === "approved" ? "No approved companies yet." : "No rejected companies."}
        </div>
      ) : (
        <ul className="space-y-3" aria-busy={loading}>
          {items.map((item) => (
            <li key={item.id} data-testid="company-row" data-company-name={item.name} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <CompanyLogo src={item.logoUrl} name={item.name} variant="thumb" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-gray-950">{item.name}</h3>
                    <StatusPill status={item.registrationStatus} deactivated={item.companyStatus === "suspended"} />
                    {item.origin === "platform" && <span className="text-xs text-gray-400">Existing company</span>}
                  </div>
                  <div className="grid gap-x-6 gap-y-1 text-sm text-gray-600 sm:grid-cols-2">
                    <p className="flex items-center gap-1.5"><Mail size={13} className="shrink-0 text-gray-400" />{item.email ?? "—"}</p>
                    <p className="flex items-center gap-1.5"><Phone size={13} className="shrink-0 text-gray-400" />{item.phone}</p>
                    <p className="flex items-start gap-1.5 sm:col-span-2"><MapPin size={13} className="mt-0.5 shrink-0 text-gray-400" />{item.address}</p>
                    <p className="flex items-center gap-1.5"><User size={13} className="shrink-0 text-gray-400" />{item.owner ? `${item.owner.name ?? "Owner"} · ${item.owner.email}` : "No owner account"}</p>
                    {item.owner?.phone && <p className="flex items-center gap-1.5"><Phone size={13} className="shrink-0 text-gray-400" />{item.owner.phone}</p>}
                  </div>
                  <p className="text-xs text-gray-400">Submitted {formatDate(item.submittedAt)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                  <Button type="button" variant="outline" size="sm" onClick={() => setDetails(item)}>
                    <Eye size={14} /> View details
                  </Button>
                  {item.registrationStatus === "approved" && (
                    item.companyStatus === "suspended" ? (
                      <Button type="button" size="sm" disabled={busyId !== null} onClick={() => openConfirm("reactivate", item)} data-testid="reactivate-button">
                        <Power size={14} /> Reactivate
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled={busyId !== null} onClick={() => openConfirm("deactivate", item)} data-testid="deactivate-button">
                        <PowerOff size={14} /> Deactivate
                      </Button>
                    )
                  )}
                  {item.registrationStatus === "pending_review" && (
                    <>
                      <Button type="button" size="sm" disabled={busyId !== null} onClick={() => openConfirm("approve", item)} data-testid="approve-button">
                        <CheckCircle2 size={14} /> Approve
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={busyId !== null} onClick={() => openConfirm("reject", item)} data-testid="reject-button">
                        <XCircle size={14} /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal isOpen={details !== null} onClose={() => setDetails(null)} title={details ? details.name : "Company"} size="2xl">
        {details && (
          <div className="space-y-4 text-sm" data-testid="details-modal">
            <div className="flex items-center gap-4">
              <CompanyLogo src={details.logoUrl} name={details.name} variant="thumb" size="lg" />
              <div>
                <StatusPill status={details.registrationStatus} deactivated={details.companyStatus === "suspended"} />
                <p className="mt-1 text-xs text-gray-500">Submitted {formatDate(details.submittedAt)}</p>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["Company email", details.email ?? "—"],
                ["Company phone", details.phone],
                ["Address", details.address],
                ["Owner", details.owner?.name ?? "—"],
                ["Owner email", details.owner?.email ?? "—"],
                ["Owner phone", details.owner?.phone ?? "—"],
                ["Reviewed", details.reviewedAt ? `${formatDate(details.reviewedAt)} by ${details.reviewedByName ?? "—"}` : "Not reviewed yet"],
              ].map(([label, value]) => (
                <div key={label} className={label === "Address" ? "sm:col-span-2" : undefined}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
                  <dd className="mt-0.5 text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
            {details.reviewNote && (
              <div className="rounded-xl bg-gray-50 p-3 text-gray-700">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Internal note (never emailed)</p>
                <p className="mt-1">{details.reviewNote}</p>
              </div>
            )}
            {details.decisionEmail && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 p-3">
                <EmailStatus item={details} />
                {details.decisionEmail.status !== "sent" && (
                  <Button type="button" variant="outline" size="sm" disabled={busyId !== null} onClick={() => void resend(details)}>
                    <RefreshCw size={14} /> Resend email
                  </Button>
                )}
              </div>
            )}
            {details.registrationStatus === "approved" && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                {details.companyStatus === "suspended" ? (
                  <Button type="button" disabled={busyId !== null} onClick={() => openConfirm("reactivate", details)}>
                    <Power size={14} /> Reactivate company
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled={busyId !== null} onClick={() => openConfirm("deactivate", details)}>
                    <PowerOff size={14} /> Deactivate company
                  </Button>
                )}
              </div>
            )}
            {details.registrationStatus === "pending_review" && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
                <Button type="button" variant="outline" disabled={busyId !== null} onClick={() => openConfirm("reject", details)}>
                  <XCircle size={14} /> Reject
                </Button>
                <Button type="button" disabled={busyId !== null} onClick={() => openConfirm("approve", details)}>
                  <CheckCircle2 size={14} /> Approve
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={confirm !== null}
        onClose={() => (busyId === null ? setConfirm(null) : undefined)}
        title={
          confirm?.kind === "approve" ? "Approve this company?" : confirm?.kind === "reject" ? "Reject this request?" : confirm?.kind === "deactivate" ? "Deactivate this company?" : "Reactivate this company?"
        }
        size="md"
      >
        {confirm && (
          <div className="space-y-4 text-sm" data-testid="confirm-modal">
            <p className="text-gray-600">
              {confirm.kind === "approve"
                ? `${confirm.item.name} will be able to sign in, and its owner will receive an approval email.`
                : confirm.kind === "reject"
                  ? `${confirm.item.name} will not be able to sign in.`
                  : confirm.kind === "deactivate"
                    ? `No one from ${confirm.item.name} will be able to sign in: not the owner, not its admins, not its dealers. People who are signed in are logged out on their next request. Nothing is deleted, and you can reactivate it at any time.`
                    : `Everyone from ${confirm.item.name} will be able to sign in again.`}
            </p>
            {confirm.kind === "reject" && (
              <>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Internal note (optional, never emailed)</span>
                  <textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    maxLength={500}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-gray-900 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-gray-700">
                  <input type="checkbox" checked={notifyOwner} onChange={(e) => setNotifyOwner(e.target.checked)} />
                  Email the owner that the request was not approved
                </label>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busyId !== null} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button type="button" loading={busyId !== null} onClick={() => void decide()} data-testid="confirm-button">
                {confirm.kind === "approve" ? "Yes, approve" : confirm.kind === "reject" ? "Yes, reject" : confirm.kind === "deactivate" ? "Yes, deactivate" : "Yes, reactivate"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
