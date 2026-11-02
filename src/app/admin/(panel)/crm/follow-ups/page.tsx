"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarPlus, Check, CheckCircle2, Copy, MessageCircle, Phone, RefreshCw, Search, X } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Modal from "@/components/shared/Modal";
import Pagination from "@/components/shared/Pagination";
import { Button, Textarea } from "@/components/ui";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { FOLLOW_UP_TIME_ZONE, googleCalendarUrl } from "@/lib/followUps";
import { LEAD_PRIORITY_CONFIG } from "@/types/crm";
import type { LeadPriority } from "@/types/crm";

type View = "overdue" | "today" | "upcoming" | "all";

interface FollowUpRow {
  id: string;
  referenceNumber: string;
  customerName: string;
  phone: string | null;
  whatsapp: string | null;
  projectType: string | null;
  location: string | null;
  priority: LeadPriority;
  status: string;
  notes: string | null;
  nextFollowUpAt: string;
  lastContactedAt: string | null;
  bucket: "overdue" | "today" | "upcoming";
  dayOffset: number;
  assignedSalesName: string | null;
}

interface FollowUpsResponse {
  data: FollowUpRow[];
  pagination: { page: number; totalPages: number; total: number };
  summary: { overdue: number; today: number; upcoming: number };
}

interface FeedState {
  enabled: boolean;
  url: string | null;
  lastFetchedAt: string | null;
  fetchCount: number;
  publiclyReachable: boolean;
}

const dueFormat = new Intl.DateTimeFormat("en-IN", { timeZone: FOLLOW_UP_TIME_ZONE, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dateTimeFormat = new Intl.DateTimeFormat("en-IN", { timeZone: FOLLOW_UP_TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const BUCKET_STYLE: Record<FollowUpRow["bucket"], string> = {
  overdue: "bg-red-50 text-red-700 border-red-200",
  today: "bg-amber-50 text-amber-800 border-amber-200",
  upcoming: "bg-sky-50 text-sky-800 border-sky-200",
};

function dueLabel(row: FollowUpRow): string {
  if (row.bucket === "overdue") return `Overdue ${-row.dayOffset} ${-row.dayOffset === 1 ? "day" : "days"}`;
  if (row.bucket === "today") return "Due today";
  return row.dayOffset === 1 ? "Tomorrow" : `In ${row.dayOffset} days`;
}

/** A date-time input value (the browser's local time) for `days` from now at 10:00. */
function localInput(days: number, hour = 10): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const waLink = (row: FollowUpRow) => {
  const digits = (row.whatsapp || row.phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
};

export default function FollowUpsPage() {
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<FollowUpsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<{ row: FollowUpRow; mode: "done" | "reschedule" } | null>(null);
  const hasLoaded = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    try {
      const params = new URLSearchParams({ view, page: String(page), pageSize: String(pageSize) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      setData(await apiJson.get<FollowUpsResponse>(`/api/crm/follow-ups?${params.toString()}`));
      setError(null);
      hasLoaded.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load follow-ups.");
    } finally {
      setLoading(false);
    }
  }, [view, page, pageSize, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const rows = data?.data ?? [];
  const summary = data?.summary ?? { overdue: 0, today: 0, upcoming: 0 };
  const tabs: Array<{ id: View; label: string; count: number | null }> = [
    { id: "all", label: "All", count: summary.overdue + summary.today + summary.upcoming },
    { id: "overdue", label: "Overdue", count: summary.overdue },
    { id: "today", label: "Today", count: summary.today },
    { id: "upcoming", label: "Upcoming", count: summary.upcoming },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        icon={CalendarClock}
        subtitle="Leads that are due for a call or message, earliest first. Mark them done, move the date, or add them to Google Calendar."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-xs transition hover:border-gray-300 hover:bg-gray-50"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        }
      />

      <CalendarSyncCard />

      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div role="tablist" aria-label="Follow-up view" className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              onClick={() => {
                setView(tab.id);
                setPage(1);
              }}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                view === tab.id ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              )}
            >
              {tab.label}
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", view === tab.id ? "bg-white/20" : "bg-gray-100 text-gray-600")} data-testid={`followup-count-${tab.id}`}>
                {tab.count ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, reference, phone or project..."
            aria-label="Search follow-ups"
            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-9 pr-9 text-sm text-gray-800 placeholder:text-gray-400 hover:bg-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-20">
          <LoadingSpinner />
        </div>
      ) : error ? (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-800">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-12 text-center">
          <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
          <p className="text-sm font-semibold text-gray-700">{debouncedSearch ? "No follow-ups match your search" : view === "overdue" ? "Nothing overdue" : view === "today" ? "Nothing due today" : "No follow-ups to show"}</p>
          <p className="text-xs text-gray-400">Set a &ldquo;Next follow-up&rdquo; date on a lead and it appears here.</p>
        </div>
      ) : (
        <>
          <ul className="space-y-2.5" data-testid="followup-list">
            {rows.map((row) => {
              const due = new Date(row.nextFollowUpAt);
              const wa = waLink(row);
              return (
                <li key={row.id} className="rounded-2xl border border-gray-200 bg-white p-4" data-testid="followup-row" data-bucket={row.bucket}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-gray-950">{row.customerName}</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">{row.referenceNumber}</span>
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold", LEAD_PRIORITY_CONFIG[row.priority]?.bg, LEAD_PRIORITY_CONFIG[row.priority]?.text, LEAD_PRIORITY_CONFIG[row.priority]?.border)}>
                          {LEAD_PRIORITY_CONFIG[row.priority]?.label ?? row.priority}
                        </span>
                      </div>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        {row.projectType && <span>{row.projectType}</span>}
                        {row.location && <span>{row.location}</span>}
                        {row.assignedSalesName && <span>Owner: {row.assignedSalesName}</span>}
                        {row.lastContactedAt && <span>Last contacted {dateTimeFormat.format(new Date(row.lastContactedAt))}</span>}
                      </p>
                      {row.notes && <p className="line-clamp-2 text-xs text-gray-500">{row.notes}</p>}
                    </div>

                    <div className="flex flex-col gap-2 lg:items-end">
                      <div className="flex items-center gap-2">
                        <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold", BUCKET_STYLE[row.bucket])} data-testid="followup-bucket">
                          {dueLabel(row)}
                        </span>
                        <span className="text-xs font-semibold text-gray-700" data-testid="followup-due">{dueFormat.format(due)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.phone && (
                          <a href={`tel:${row.phone}`} aria-label={`Call ${row.customerName}`} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                            <Phone size={12} /> Call
                          </a>
                        )}
                        {wa && (
                          <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${row.customerName}`} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                            <MessageCircle size={12} /> WhatsApp
                          </a>
                        )}
                        <a
                          href={googleCalendarUrl(row, due, `${origin}/admin/crm/follow-ups`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="add-to-google-calendar"
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <CalendarPlus size={12} /> Add to Google Calendar
                        </a>
                        <button type="button" onClick={() => setAction({ row, mode: "reschedule" })} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                          <CalendarClock size={12} /> Reschedule
                        </button>
                        <button type="button" onClick={() => setAction({ row, mode: "done" })} className="inline-flex items-center gap-1 rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800">
                          <Check size={12} /> Done
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination
            currentPage={page}
            totalPages={data?.pagination.totalPages ?? 1}
            total={data?.pagination.total ?? 0}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            entityName="follow-ups"
          />
        </>
      )}

      {action && (
        <FollowUpActionModal
          row={action.row}
          mode={action.mode}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            void load();
          }}
        />
      )}
    </div>
  );

}

/** Mark a follow-up done (and plan the next one) or just move its date. */
function FollowUpActionModal({ row, mode, onClose, onSaved }: { row: FollowUpRow; mode: "done" | "reschedule"; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [noNext, setNoNext] = useState(false);
  const [next, setNext] = useState(localInput(1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!noNext && !next) {
      setError("Pick the next follow-up date, or choose “No next follow-up”.");
      return;
    }
    setSaving(true);
    try {
      await apiJson.post(`/api/crm/leads/${row.id}/follow-up`, {
        action: mode,
        note: note.trim() || undefined,
        nextFollowUpAt: noNext ? null : new Date(next).toISOString(),
      });
      notify.success(mode === "done" ? "Follow-up done" : "Follow-up rescheduled", noNext ? `${row.customerName} has no next follow-up.` : `Next: ${dateTimeFormat.format(new Date(next))}.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the follow-up.");
      notifyApiError(err, "Could not save the follow-up");
    } finally {
      setSaving(false);
    }
  };

  const quick: Array<{ label: string; days: number }> = [
    { label: "Tomorrow", days: 1 },
    { label: "In 3 days", days: 3 },
    { label: "Next week", days: 7 },
    { label: "In 2 weeks", days: 14 },
  ];

  return (
    <Modal isOpen onClose={onClose} title={mode === "done" ? `Follow-up done: ${row.customerName}` : `Reschedule: ${row.customerName}`} size="lg">
      <div className="space-y-4" data-testid="followup-modal">
        {mode === "done" && (
          <Textarea label="What happened? (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spoke to the client, will decide after the site visit." maxLength={1000} />
        )}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700">{mode === "done" ? "Next follow-up" : "New follow-up date"}</p>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => {
                  setNoNext(false);
                  setNext(localInput(option.days));
                }}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {option.label}
              </button>
            ))}
            {mode === "done" && (
              <button
                type="button"
                onClick={() => setNoNext(true)}
                aria-pressed={noNext}
                className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium", noNext ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50")}
              >
                No next follow-up
              </button>
            )}
          </div>
          <input
            type="datetime-local"
            value={next}
            disabled={noNext}
            onChange={(e) => setNext(e.target.value)}
            aria-label="Next follow-up date and time"
            className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={saving} onClick={() => void submit()}>
            {mode === "done" ? "Mark done" : "Save new date"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The person's private Google Calendar link: create it, copy it, replace it, or turn it off. */
function CalendarSyncCard() {
  const confirm = useConfirm();
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setFeed(await apiJson.get<FeedState>("/api/crm/follow-ups/calendar-feed"));
    } catch {
      setFeed(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const enable = async (replacing: boolean) => {
    if (replacing) {
      const ok = await confirm({
        title: "Generate a new link?",
        message: "The old link stops working at once. You will need to add the new link to Google Calendar again.",
        confirmText: "Generate new link",
        variant: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setFeed(await apiJson.post<FeedState>("/api/crm/follow-ups/calendar-feed"));
      setOpen(true);
    } catch (err) {
      notifyApiError(err, "Could not create the calendar link");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const ok = await confirm({
      title: "Turn off the calendar link?",
      message: "Google Calendar will stop receiving your follow-ups. You can turn it on again later with a new link.",
      confirmText: "Turn off",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      setFeed(await apiJson.delete<FeedState>("/api/crm/follow-ups/calendar-feed"));
    } catch (err) {
      notifyApiError(err, "Could not turn the link off");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!feed?.url) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      notify.success("Link copied", "Paste it into Google Calendar (see the steps below).");
    } catch {
      notify.error("Could not copy", "Select the link and copy it manually.");
    }
  };

  if (!feed) return null;
  return (
    <section aria-label="Google Calendar" className="rounded-2xl border border-gray-200 bg-white p-4" data-testid="calendar-sync">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <CalendarPlus size={16} aria-hidden /> See your follow-ups in Google Calendar
          </h2>
          <p className="text-xs text-gray-500">A private link that keeps your calendar up to date with the follow-ups you can see here. Free; no Google setup needed.</p>
        </div>
        {!feed.enabled ? (
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void enable(false)}>
            Create my calendar link
          </Button>
        ) : (
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="text-xs font-semibold text-gray-700 hover:underline">
            {open ? "Hide link" : "Show link"}
          </button>
        )}
      </div>

      {feed.enabled && open && (
        <div className="mt-3 space-y-3">
          {!feed.publiclyReachable && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              This workspace&apos;s address is not reachable from the internet over https, so Google cannot read the link yet. It will work once the app is published on its public address.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input readOnly value={feed.url ?? ""} aria-label="Your private calendar link" data-testid="calendar-feed-url" onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 font-mono text-xs text-gray-700" />
            <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
              <Copy size={13} /> Copy link
            </Button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600">
            <li>Open Google Calendar on a computer (calendar.google.com).</li>
            <li>Next to &ldquo;Other calendars&rdquo;, click <strong>+</strong> then <strong>From URL</strong>.</li>
            <li>Paste your link and click <strong>Add calendar</strong>.</li>
          </ol>
          <p className="text-[11px] text-gray-400">
            Google refreshes added calendars on its own schedule, so a changed date can take a few hours to appear. For one follow-up right now, use &ldquo;Add to Google Calendar&rdquo; on that follow-up.{" "}
            {feed.lastFetchedAt ? `Last read by a calendar app: ${dateTimeFormat.format(new Date(feed.lastFetchedAt))}.` : "Not read by a calendar app yet."} Anyone with this link can see these follow-ups, so keep it private.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void enable(true)}>
              Generate a new link
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void disable()}>
              Turn off
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
