"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Kanban,
  UserCheck,
  Plus,
  RefreshCw,
  Search,
  Flame,
  FileText,
  Clock,
  Trophy,
  TrendingUp,
  AlertTriangle,
  CalendarClock,
  Inbox,
  X,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import Modal from "@/components/shared/Modal";
import { Button, Input, Textarea } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { cn, formatCurrency } from "@/lib/utils";
import type { Lead, OpportunityCard, PipelineStageData, PipelineStageId } from "@/types/crm";
import { LEAD_PRIORITY_CONFIG } from "@/types/crm";
import LeadDetailDrawer from "@/components/admin/crm/LeadDetailDrawer";
import LeadModal from "@/components/admin/crm/LeadModal";

const STAGE_OPTIONS: Array<{ id: PipelineStageId; label: string }> = [
  { id: "new", label: "New Lead" },
  { id: "contacted", label: "Contacted" },
  { id: "site_visit", label: "Site Visit" },
  { id: "quoted", label: "Proposal Sent" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Closed Won" },
  { id: "lost", label: "Closed Lost" },
];

const LOST_REASONS = ["Price", "Competitor", "Budget", "Timing", "No response"];

/** Stages whose cards still need work: the figures and warnings on this page leave won and lost out. */
const isOpenStage = (id: PipelineStageId) => id !== "won" && id !== "lost";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

/** "Due today" / "Overdue 3d" / "In 2d" for a follow-up date, with the tone the chip uses. */
function followUpInfo(iso: string | null | undefined): { text: string; tone: "overdue" | "today" | "later" } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDue = new Date(due);
  startOfDue.setHours(0, 0, 0, 0);
  const days = Math.round((startOfDue.getTime() - startOfToday.getTime()) / 86_400_000);
  if (days < 0) return { text: `Overdue ${-days}d`, tone: "overdue" };
  if (days === 0) return { text: "Follow-up today", tone: "today" };
  return { text: `Follow-up in ${days}d`, tone: "later" };
}

/** The stage list with one card moved to another stage and the counts and totals recomputed (shown before the server answers). */
function withCardMoved(stages: PipelineStageData[], cardId: string, target: PipelineStageId): PipelineStageData[] {
  const card = stages.flatMap((stage) => stage.items).find((item) => item.id === cardId);
  if (!card || card.stage === target) return stages;
  const moved: OpportunityCard = { ...card, stage: target, daysInStage: 0 };
  return stages.map((stage) => {
    const items = stage.id === card.stage ? stage.items.filter((item) => item.id !== cardId) : stage.id === target ? [moved, ...stage.items] : stage.items;
    return { ...stage, items, count: items.length, totalValue: items.reduce((sum, item) => sum + (item.estimatedValue || 0), 0) };
  });
}

function SummaryTile({ icon: Icon, label, value, hint, tone }: { icon: typeof TrendingUp; label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-2xs">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone)}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
        <p className="truncate text-lg font-bold leading-tight text-neutral-900">{value}</p>
        <p className="truncate text-[11px] text-neutral-400">{hint}</p>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-busy="true" aria-label="Loading pipeline" data-testid="pipeline-skeleton">
      {[3, 2, 2, 1, 1, 1, 1].map((cards, column) => (
        <div key={column} className="w-[19rem] shrink-0 rounded-2xl border border-neutral-200 bg-neutral-100/60 p-3">
          <div className="mb-3 h-4 w-28 animate-pulse rounded bg-neutral-200" />
          <div className="space-y-2.5">
            {Array.from({ length: cards }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-xl border border-neutral-200 bg-white" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PipelinePage() {
  const [stages, setStages] = useState<PipelineStageData[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStageId | null>(null);

  // Drawer / modals
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [lostCardId, setLostCardId] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [savingLost, setSavingLost] = useState(false);

  const hasLoaded = useRef(false);

  // The search box waits for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchPipeline = useCallback(async () => {
    // Only the first load replaces the board with a skeleton; later refreshes keep it on screen.
    if (hasLoaded.current) setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await apiJson.get<PipelineStageData[]>(`/api/crm/pipeline?${params.toString()}`);
      if (Array.isArray(res)) setStages(res);
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      notifyApiError(err, "Failed to load pipeline");
    } finally {
      hasLoaded.current = true;
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  useEffect(() => {
    void fetchPipeline();
  }, [fetchPipeline]);

  /** Moves a card (drag and drop or the stage selector). The board updates at once and is re-read afterwards. */
  const moveCard = async (leadId: string, targetStage: PipelineStageId, lostReasonText?: string) => {
    const before = stages;
    setStages((current) => withCardMoved(current, leadId, targetStage));
    try {
      // Negotiation is stored as the "quoted" lead status.
      const leadStatus = targetStage === "negotiation" ? "quoted" : targetStage;
      await apiJson.patch(`/api/crm/leads/${leadId}/status`, {
        status: leadStatus,
        lostReason: lostReasonText,
        notes: targetStage === "negotiation" ? "Negotiation & customer revisions in progress" : undefined,
      });
      notify.success("Opportunity moved", "Pipeline stage updated.");
      void fetchPipeline();
    } catch (err) {
      setStages(before);
      notifyApiError(err, "Failed to move opportunity");
    }
  };

  const requestMove = (leadId: string, targetStage: PipelineStageId) => {
    const card = stages.flatMap((stage) => stage.items).find((item) => item.id === leadId);
    if (!card || card.stage === targetStage) return;
    if (targetStage === "lost") {
      setLostReason("");
      setLostCardId(leadId);
      return;
    }
    void moveCard(leadId, targetStage);
  };

  const confirmLost = async () => {
    if (!lostCardId) return;
    setSavingLost(true);
    await moveCard(lostCardId, "lost", lostReason.trim() || undefined);
    setSavingLost(false);
    setLostCardId(null);
  };

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData("text/plain", cardId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingCardId(cardId);
  };

  const handleDrop = (e: React.DragEvent, targetStage: PipelineStageId) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("text/plain") || draggingCardId;
    setDraggingCardId(null);
    setDragOverStage(null);
    if (cardId) requestMove(cardId, targetStage);
  };

  const openCard = async (leadId: string) => {
    try {
      const res = await apiJson.get<Lead>(`/api/crm/leads/${leadId}`);
      if (res) {
        setSelectedLead(res);
        setDrawerOpen(true);
      }
    } catch (err) {
      notifyApiError(err, "Failed to load lead details");
    }
  };

  const summary = useMemo(() => {
    const open = stages.filter((stage) => isOpenStage(stage.id));
    const won = stages.find((stage) => stage.id === "won");
    const openCards = open.flatMap((stage) => stage.items);
    return {
      openValue: open.reduce((sum, stage) => sum + stage.totalValue, 0),
      openCount: openCards.length,
      wonValue: won?.totalValue ?? 0,
      wonCount: won?.count ?? 0,
      hot: openCards.filter((card) => card.isHotLead).length,
      stale: openCards.filter((card) => card.daysInStage >= 7).length,
      overdue: openCards.filter((card) => followUpInfo(card.nextFollowUpAt)?.tone === "overdue").length,
      attention: openCards.filter((card) => card.daysInStage >= 7 || followUpInfo(card.nextFollowUpAt)?.tone === "overdue").length,
      total: stages.reduce((sum, stage) => sum + stage.count, 0),
    };
  }, [stages]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Opportunity Pipeline"
        subtitle="Drag opportunities between stages, or use the stage selector on each card."
        icon={Kanban}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/crm/leads"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 shadow-2xs transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <UserCheck size={14} className="text-neutral-500" aria-hidden="true" />
              Leads table
            </Link>
            <Button type="button" variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={() => setLeadModalOpen(true)}>
              New lead
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="pipeline-summary">
        <SummaryTile icon={TrendingUp} label="Open pipeline" value={formatCurrency(summary.openValue)} hint={`${summary.openCount} open ${summary.openCount === 1 ? "opportunity" : "opportunities"}`} tone="bg-sky-50 text-sky-600" />
        <SummaryTile icon={Trophy} label="Closed won" value={formatCurrency(summary.wonValue)} hint={`${summary.wonCount} ${summary.wonCount === 1 ? "deal" : "deals"} won`} tone="bg-emerald-50 text-emerald-600" />
        <SummaryTile icon={Flame} label="Hot leads" value={String(summary.hot)} hint="Quotation viewed several times" tone="bg-amber-50 text-amber-600" />
        <SummaryTile
          icon={AlertTriangle}
          label="Needs attention"
          value={String(summary.attention)}
          hint={`${summary.stale} stuck 7+ days · ${summary.overdue} overdue follow-ups`}
          tone="bg-rose-50 text-rose-600"
        />
      </div>

      {/* Search and refresh */}
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, reference, phone or project"
            aria-label="Search opportunities"
            leftIcon={<Search size={14} />}
            className="text-xs"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="text-xs text-neutral-500" aria-live="polite">
            {summary.total} {summary.total === 1 ? "opportunity" : "opportunities"}
            {search ? ` matching “${search}”` : ""}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchPipeline()} disabled={refreshing} leftIcon={<RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} />}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Board */}
      {initialLoading ? (
        <BoardSkeleton />
      ) : loadFailed && stages.length === 0 ? (
        <div role="alert" className="rounded-2xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-600" data-testid="pipeline-error">
          The pipeline could not be loaded.{" "}
          <button type="button" onClick={() => void fetchPipeline()} className="font-semibold text-accent underline underline-offset-2">
            Try again
          </button>
        </div>
      ) : (
        <div className={cn("-mx-1 overflow-x-auto px-1 pb-4 transition-opacity", refreshing && "opacity-80")} data-testid="pipeline-board">
          <div className="flex snap-x snap-mandatory items-start gap-3 sm:snap-none">
            {stages.map((stage) => {
              const isTarget = dragOverStage === stage.id && draggingCardId !== null;
              return (
                <section
                  key={stage.id}
                  aria-label={`${stage.name}, ${stage.count} ${stage.count === 1 ? "opportunity" : "opportunities"}`}
                  data-testid="pipeline-column"
                  data-stage={stage.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverStage !== stage.id) setDragOverStage(stage.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverStage((current) => (current === stage.id ? null : current));
                  }}
                  onDrop={(e) => handleDrop(e, stage.id)}
                  className={cn(
                    "flex max-h-[calc(100vh-17rem)] min-h-[16rem] w-[84vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-2xl border bg-neutral-100/70 transition sm:w-[19rem]",
                    isTarget ? "border-accent bg-accent-light/40 ring-2 ring-accent/30" : "border-neutral-200",
                    stage.id === "lost" && !isTarget && "bg-neutral-100/40"
                  )}
                >
                  <header className="rounded-t-2xl border-t-[3px] px-3 pb-2.5 pt-3" style={{ borderTopColor: stage.color }}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-[13px] font-bold tracking-tight text-neutral-900">{stage.name}</h3>
                      <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-bold text-neutral-600">{stage.count}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-neutral-500">{formatCurrency(stage.totalValue)}</p>
                  </header>

                  <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3">
                    {stage.items.length === 0 ? (
                      <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-neutral-300 bg-white/50 px-3 py-9 text-center text-neutral-400">
                        <Inbox size={20} aria-hidden="true" />
                        <span className="text-xs font-medium">{isTarget ? "Drop to move here" : search ? "No match" : "Nothing here yet"}</span>
                      </div>
                    ) : (
                      stage.items.map((card) => {
                        const priority = LEAD_PRIORITY_CONFIG[card.priority] || LEAD_PRIORITY_CONFIG.medium;
                        const owner = card.assignedSalesName || card.dealerName || "Direct";
                        const followUp = isOpenStage(card.stage) ? followUpInfo(card.nextFollowUpAt) : null;
                        const stuck = isOpenStage(card.stage) && card.daysInStage >= 7;
                        return (
                          <article
                            key={card.id}
                            draggable
                            data-testid="pipeline-card"
                            onDragStart={(e) => handleDragStart(e, card.id)}
                            onDragEnd={() => {
                              setDraggingCardId(null);
                              setDragOverStage(null);
                            }}
                            onClick={() => void openCard(card.id)}
                            onKeyDown={(e) => {
                              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault();
                                void openCard(card.id);
                              }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`${card.customerName}, ${formatCurrency(card.estimatedValue)}. Open details`}
                            className={cn(
                              "group cursor-pointer select-none space-y-2.5 rounded-xl border border-neutral-200 bg-white p-3 shadow-2xs transition hover:border-neutral-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                              draggingCardId === card.id && "opacity-40"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="rounded border border-accent-border bg-accent-light px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">{card.referenceNumber}</span>
                              <span className="flex items-center gap-1.5">
                                {card.isHotLead && (
                                  <span title="Hot lead: quotation viewed several times" className="inline-flex">
                                    <Flame size={13} className="fill-amber-500 text-amber-500" aria-label="Hot lead" />
                                  </span>
                                )}
                                <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold", priority.bg, priority.text, priority.border)}>
                                  <span className={cn("h-1.5 w-1.5 rounded-full", priority.dot)} aria-hidden="true" />
                                  {priority.label}
                                </span>
                              </span>
                            </div>

                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-bold leading-tight text-neutral-900 transition group-hover:text-accent">{card.customerName}</h4>
                              {card.projectType && <p className="mt-0.5 truncate text-xs text-neutral-500">{card.projectType}</p>}
                            </div>

                            <div className="flex items-end justify-between gap-2">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Value</p>
                                <p className="font-mono text-[15px] font-bold leading-tight text-neutral-900">{formatCurrency(card.estimatedValue)}</p>
                              </div>
                              {card.quotationNumber && (
                                <span className="inline-flex min-w-0 items-center gap-1 rounded-lg border border-neutral-100 bg-neutral-50 px-2 py-1 text-[10px] font-semibold text-neutral-600" title={`Quotation ${card.quotationNumber} (${card.quotationStatus ?? "draft"})`}>
                                  <FileText size={11} className="shrink-0 text-accent" aria-hidden="true" />
                                  <span className="truncate">{card.quotationNumber}</span>
                                  {card.quotationStatus && <span className="shrink-0 font-medium capitalize text-neutral-400">· {card.quotationStatus}</span>}
                                </span>
                              )}
                            </div>

                            {(stuck || followUp) && (
                              <div className="flex flex-wrap gap-1.5">
                                {stuck && (
                                  <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", card.daysInStage >= 14 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>
                                    <Clock size={10} aria-hidden="true" />
                                    {card.daysInStage}d in stage
                                  </span>
                                )}
                                {followUp && (
                                  <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", followUp.tone === "overdue" ? "bg-rose-50 text-rose-700" : followUp.tone === "today" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600")}>
                                    <CalendarClock size={10} aria-hidden="true" />
                                    {followUp.text}
                                  </span>
                                )}
                              </div>
                            )}

                            <div className="flex items-center justify-between gap-2 border-t border-neutral-100 pt-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500" title={owner}>
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[9px] font-bold text-neutral-600" aria-hidden="true">
                                  {initials(owner)}
                                </span>
                                <span className="truncate font-medium">{owner}</span>
                                {!stuck && <span className="shrink-0 text-neutral-300">· {card.daysInStage}d</span>}
                              </span>
                              <select
                                value={card.stage}
                                onChange={(e) => requestMove(card.id, e.target.value as PipelineStageId)}
                                aria-label={`Move ${card.customerName} to another stage`}
                                data-testid="pipeline-stage-select"
                                className="max-w-[7.5rem] shrink-0 cursor-pointer rounded-lg border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-[11px] font-medium text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                {STAGE_OPTIONS.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {/* Lead detail drawer */}
      <LeadDetailDrawer
        isOpen={drawerOpen}
        lead={selectedLead}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedLead(null);
        }}
        onLeadUpdated={() => {
          void fetchPipeline();
          if (selectedLead) {
            apiJson.get<Lead>(`/api/crm/leads/${selectedLead.id}`).then((r) => {
              if (r) setSelectedLead(r);
            });
          }
        }}
      />

      {/* New lead */}
      <LeadModal isOpen={leadModalOpen} onClose={() => setLeadModalOpen(false)} onSaved={() => void fetchPipeline()} />

      {/* Why was it lost? */}
      <Modal isOpen={lostCardId !== null} onClose={() => !savingLost && setLostCardId(null)} title="Mark as lost" size="md">
        <form
          className="space-y-4"
          data-testid="lost-reason-form"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmLost();
          }}
        >
          <p className="text-sm text-neutral-600">Why was this opportunity lost? The reason is saved on the lead (optional).</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common reasons">
            {LOST_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setLostReason(reason)}
                aria-pressed={lostReason === reason}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  lostReason === reason ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                )}
              >
                {reason}
              </button>
            ))}
          </div>
          <Textarea label="Reason" rows={3} value={lostReason} maxLength={300} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Chose a competitor with a lower quote" />
          <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setLostCardId(null)} disabled={savingLost}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={savingLost} data-testid="lost-reason-confirm">
              Mark as lost
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
