"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileClock, History, Lock, PenLine } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { Button, Textarea } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { useUserTimeZone } from "@/lib/useUserTimeZone";

interface RevisionSummary {
  revision: number;
  issuedAt: string;
  issuedByName: string | null;
  reason: string | null;
  reconstructed: boolean;
  hasPdf: boolean;
  grandTotal: number;
  itemCount: number;
  superseded: { at: string; byRevision: number | null; statusWas: string | null } | null;
  approvedAt: string | null;
  current: boolean;
}
interface RevisionRequest {
  status: "pending" | "approved" | "rejected";
  requestedByName: string | null;
  requestedAt: string;
  reason: string;
  decidedByName: string | null;
  decisionNote: string | null;
}
interface RevisionData {
  currentRevision: number;
  status: string;
  draftReason: string | null;
  request: RevisionRequest | null;
  revisions: RevisionSummary[];
  canApprove: boolean;
}

const rupees = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);

/**
 * Where a quotation's versions are managed (#15): which revision this is, the history of issued versions with their PDFs, creating
 * a new revision of an issued quotation, and the approval step for approved or delivered ones. A draft revision 1 shows nothing.
 */
export default function QuotationRevisionBar({ quotationId, status, revision }: { quotationId: string; status: string; revision: number }) {
  const timeZone = useUserTimeZone();
  const [data, setData] = useState<RevisionData | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiJson.get<RevisionData>(`/api/quotations/${quotationId}/revisions`));
    } catch {
      setData(null);
    }
  }, [quotationId]);
  useEffect(() => {
    void load();
  }, [load, status, revision]);

  const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const issued = status !== "draft";
  const current = data?.currentRevision ?? revision;
  if (!issued && current <= 1) return null;
  const needsApproval = status === "approved" || status === "delivered";
  const pending = data?.request?.status === "pending" ? data.request : null;

  const create = async () => {
    setBusy(true);
    try {
      const result = await apiJson.post<{ kind: "revised" | "requested"; revision?: number }>(`/api/quotations/${quotationId}/revisions`, { reason: reason.trim() });
      setShowCreate(false);
      setReason("");
      if (result.kind === "revised") {
        notify.success("Revision created", `Revision ${result.revision} is open for editing. The issued version is kept as it was.`);
        window.location.reload();
      } else {
        notify.success("Request sent", "An approver will decide whether this quotation can be revised.");
        await load();
      }
    } catch (err) {
      notifyApiError(err, "Could not create the revision");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await apiJson.post(`/api/quotations/${quotationId}/revisions/request/decision`, { decision, note: note.trim() || undefined });
      notify.success(decision === "approve" ? "Revision approved" : "Request declined", decision === "approve" ? "The quotation is open for editing as the next revision." : "The quotation stays as it is.");
      setNote("");
      if (decision === "approve") window.location.reload();
      else await load();
    } catch (err) {
      notifyApiError(err, "Could not record the decision");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white px-4 py-3 print:hidden" aria-label="Quotation revisions" data-testid="revision-bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-800" data-testid="revision-badge">
          <FileClock size={13} aria-hidden /> Revision {current}
        </span>
        {issued ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600" data-testid="revision-locked">
            <Lock size={12} aria-hidden /> Issued and locked: to change it, create a new revision.
          </span>
        ) : (
          <span className="text-xs text-gray-600" data-testid="revision-draft">
            Being revised{data?.draftReason ? `: ${data.draftReason}` : ""}. Earlier versions are kept.
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowHistory(true)} data-testid="revision-history-open">
            <History className="mr-1 h-3.5 w-3.5" aria-hidden /> Revision history
          </Button>
          {issued && !pending && data && (
            <Button type="button" variant="primary" size="sm" onClick={() => setShowCreate(true)} data-testid="revision-create-open">
              <PenLine className="mr-1 h-3.5 w-3.5" aria-hidden /> {needsApproval && data && !data.canApprove ? "Request revision" : "Create revision"}
            </Button>
          )}
        </div>
      </div>

      {pending && (
        <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid="revision-request">
          <p>
            <strong>{pending.requestedByName ?? "Someone"}</strong> asked to revise this {status} quotation on {when(pending.requestedAt)}: “{pending.reason}”
          </p>
          {data?.canApprove ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note (optional)" aria-label="Note for the decision" className="h-9 min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 text-sm text-gray-900" data-testid="revision-decision-note" />
              <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => void decide("approve")} data-testid="revision-approve">Approve revision</Button>
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void decide("reject")} data-testid="revision-decline">Decline</Button>
            </div>
          ) : (
            <p className="text-xs">Waiting for an approver to decide. Nothing has changed.</p>
          )}
        </div>
      )}
      {data?.request?.status === "rejected" && issued && !pending && (
        <p className="mt-2 text-xs text-gray-500" data-testid="revision-declined">
          A revision request was declined by {data.request.decidedByName ?? "an approver"}{data.request.decisionNote ? `: “${data.request.decisionNote}”` : "."}
        </p>
      )}

      <Modal isOpen={showHistory} onClose={() => setShowHistory(false)} title="Revision history" size="2xl">
        <div className="space-y-3" data-testid="revision-history">
          {!data || data.revisions.length === 0 ? (
            <p className="text-sm text-gray-500">No version of this quotation has been issued yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.revisions.map((entry) => (
                <li key={entry.revision} className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid="revision-row" data-revision={entry.revision}>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-gray-900">
                      Revision {entry.revision}
                      {entry.current && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Current</span>}
                      {entry.superseded && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">Replaced{entry.superseded.byRevision ? ` by revision ${entry.superseded.byRevision}` : ""}</span>}
                    </p>
                    <p className="text-xs text-gray-600">
                      Issued {when(entry.issuedAt)}{entry.issuedByName ? ` by ${entry.issuedByName}` : ""} · {entry.itemCount} item{entry.itemCount === 1 ? "" : "s"} · {rupees(entry.grandTotal)}
                    </p>
                    {entry.reason && <p className="text-xs text-gray-600">Why: {entry.reason}</p>}
                    {entry.approvedAt && <p className="text-xs text-gray-500">Was approved {when(entry.approvedAt)}</p>}
                    {entry.reconstructed && <p className="text-xs text-amber-700">Rebuilt from the quotation as it stood when revisions began.</p>}
                  </div>
                  {entry.hasPdf ? (
                    <a href={`/api/quotations/${quotationId}/revisions/${entry.revision}/pdf`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50" data-testid="revision-pdf">
                      <Download className="h-3.5 w-3.5" aria-hidden /> PDF
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400" data-testid="revision-no-pdf">No PDF stored</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">Each PDF is the exact document issued for that version. It is never replaced or changed.</p>
        </div>
      </Modal>

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={needsApproval && data && !data.canApprove ? "Request a revision" : "Create a revision"} size="md">
        <div className="space-y-4" data-testid="revision-create">
          <p className="text-sm text-gray-600">
            Revision {current} stays exactly as it was issued, with its PDF. The quotation becomes revision {current + 1}, with the same quotation number, ready to edit; send it again to issue it.
            {needsApproval && data && !data.canApprove ? " Because it is " + status + ", an approver must agree first." : ""}
          </p>
          <Textarea label="Why is it being revised?" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Client wants two more switches in the living room" data-testid="revision-reason" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="button" variant="primary" size="sm" disabled={reason.trim().length < 3 || busy} loading={busy} onClick={() => void create()} data-testid="revision-create-submit">
              {needsApproval && data && !data.canApprove ? "Send request" : "Create revision"}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
