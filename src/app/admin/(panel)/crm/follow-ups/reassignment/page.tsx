"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, UserCheck } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Button, Select, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { useUserTimeZone } from "@/lib/useUserTimeZone";

type Problem = "deactivated" | "not_allowed" | "missing";

interface Row {
  taskId: string;
  version: number;
  leadId: string;
  referenceNumber: string;
  customerName: string;
  priority: string;
  dueAt: string;
  ownerId: number;
  ownerName: string | null;
  problem: Problem;
}
interface Group {
  ownerId: number;
  ownerName: string | null;
  problem: Problem;
  tasks: number;
}
interface Report {
  canReassign: boolean;
  groups: Group[];
  tasks: Row[];
  truncated: boolean;
  totals: { tasks: number; owners: number };
}
interface OwnerOption {
  id: number;
  name: string;
}
interface Result {
  batchId: string;
  toOwnerName: string;
  reassigned: Array<{ taskId: string }>;
  skipped: Array<{ taskId: string; reason: string }>;
}

const PROBLEM_LABEL: Record<Problem, string> = {
  deactivated: "Deactivated",
  not_allowed: "No longer allowed to manage leads",
  missing: "No longer in this company",
};

const SKIP_TEXT: Record<string, string> = {
  not_found: "no longer exists",
  not_open: "was already completed or cancelled",
  owner_still_allowed: "its owner can own it again",
  changed: "was changed by someone else",
  lead_closed: "its lead is closed",
};

/** The Company Owner's review of follow-ups that belong to people who can no longer own them. Nothing moves until they choose. */
export default function FollowUpReassignmentPage() {
  const confirm = useConfirm();
  const timeZone = useUserTimeZone();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [toOwnerId, setToOwnerId] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiJson.get<Report>("/api/crm/follow-ups/reassignment");
      setReport(data);
      setSelected((current) => new Set([...current].filter((id) => data.tasks.some((task) => task.taskId === id))));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the follow-ups.");
    }
  }, []);
  useEffect(() => {
    void load();
    apiJson
      .get<OwnerOption[]>("/api/crm/follow-up-owners")
      .then((list) => Array.isArray(list) && setOwners(list))
      .catch(() => undefined);
  }, [load]);

  const dueFormat = useMemo(() => new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), [timeZone]);
  const tasks = report?.tasks ?? [];
  const byOwner = useMemo(() => {
    const map = new Map<number, Row[]>();
    for (const task of tasks) map.set(task.ownerId, [...(map.get(task.ownerId) ?? []), task]);
    return map;
  }, [tasks]);
  const toOwnerName = owners.find((owner) => String(owner.id) === toOwnerId)?.name ?? "";

  const toggle = (taskId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  const toggleGroup = (ownerId: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const task of byOwner.get(ownerId) ?? []) {
        if (on) next.add(task.taskId);
        else next.delete(task.taskId);
      }
      return next;
    });

  const reassign = async (ids: string[]) => {
    if (ids.length === 0 || !toOwnerId) return;
    const ok = await confirm({
      title: `Give ${ids.length} follow-up${ids.length === 1 ? "" : "s"} to ${toOwnerName}?`,
      message: "Each follow-up moves to the new owner. The previous owner stays in its history, and the lead's timeline records the change.",
      confirmText: "Reassign",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const saved = await apiJson.post<Result>("/api/crm/follow-ups/reassign", {
        toOwnerId: Number(toOwnerId),
        tasks: ids.map((id) => ({ id, version: tasks.find((task) => task.taskId === id)?.version })),
        note: note.trim() || undefined,
      });
      setResult(saved);
      setSelected(new Set());
      notify.success("Follow-ups reassigned", `${saved.reassigned.length} now belong to ${saved.toOwnerName}.`);
      await load();
    } catch (err) {
      notifyApiError(err, "Could not reassign the follow-ups");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups that need a new owner"
        icon={UserCheck}
        subtitle="These belong to people who can no longer own them. Nothing changes until you choose a new owner."
        actions={
          <Link href="/admin/crm/follow-ups" className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50">
            <ArrowLeft size={14} /> Follow-ups
          </Link>
        }
      />

      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-800">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : !report ? (
        <div className="py-20">
          <LoadingSpinner />
        </div>
      ) : report.groups.length === 0 ? (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-12 text-center" data-testid="reassign-empty">
          <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
          <p className="text-sm font-semibold text-gray-700">Every follow-up has an owner who can work on it.</p>
          {result && <p className="text-xs text-gray-500" data-testid="reassign-result">{result.reassigned.length} follow-up{result.reassigned.length === 1 ? "" : "s"} moved to {result.toOwnerName}.</p>}
        </div>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4" aria-label="New owner">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Give them to"
                value={toOwnerId}
                onChange={(event) => setToOwnerId(event.target.value)}
                options={[{ value: "", label: "Choose the new owner" }, ...owners.map((owner) => ({ value: String(owner.id), label: owner.name }))]}
              />
              <Textarea label="Note for the timeline (optional)" rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="e.g. Taking over from Ravi, who left." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="primary" size="sm" loading={saving} disabled={selected.size === 0 || !toOwnerId} onClick={() => void reassign([...selected])} data-testid="reassign-selected">
                Reassign selected ({selected.size})
              </Button>
              <p className="text-xs text-gray-500">{report.totals.tasks} follow-up{report.totals.tasks === 1 ? "" : "s"} from {report.totals.owners} {report.totals.owners === 1 ? "person" : "people"}.</p>
            </div>
            {report.truncated && <p className="text-xs font-medium text-amber-700">Showing the earliest {report.tasks.length}. Reassign these first; more will appear.</p>}
            {result && result.skipped.length > 0 && (
              <ul className="space-y-0.5 text-xs text-amber-800" data-testid="reassign-skipped">
                {result.skipped.map((skipped) => (
                  <li key={skipped.taskId}>One follow-up was left as it was: {SKIP_TEXT[skipped.reason] ?? skipped.reason}.</li>
                ))}
              </ul>
            )}
          </section>

          {report.groups.map((group) => {
            const rows = byOwner.get(group.ownerId) ?? [];
            const allOn = rows.length > 0 && rows.every((row) => selected.has(row.taskId));
            return (
              <section key={group.ownerId} className="overflow-hidden rounded-2xl border border-gray-200 bg-white" data-testid="reassign-group" data-owner={group.ownerId}>
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-bold text-gray-900">
                      <input type="checkbox" checked={allOn} onChange={(event) => toggleGroup(group.ownerId, event.target.checked)} aria-label={`Select all follow-ups of ${group.ownerName ?? "a former team member"}`} className="rounded border-gray-300" />
                      {group.ownerName ?? "A former team member"}
                    </label>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">{PROBLEM_LABEL[group.problem]}</span>
                    <span className="text-xs text-gray-500">{group.tasks} follow-up{group.tasks === 1 ? "" : "s"}</span>
                  </div>
                  <Button type="button" variant="secondary" size="sm" disabled={saving || !toOwnerId} onClick={() => void reassign(rows.map((row) => row.taskId))}>
                    Reassign all {rows.length}
                  </Button>
                </header>
                <ul className="divide-y divide-gray-100">
                  {rows.map((row) => (
                    <li key={row.taskId} className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm", selected.has(row.taskId) && "bg-accent/5")} data-testid="reassign-row">
                      <input type="checkbox" checked={selected.has(row.taskId)} onChange={() => toggle(row.taskId)} aria-label={`Select ${row.customerName}`} className="rounded border-gray-300" />
                      <span className="font-semibold text-gray-900">{row.customerName}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">{row.referenceNumber}</span>
                      <span className="text-xs text-gray-500">Due {dueFormat.format(new Date(row.dueAt))}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
