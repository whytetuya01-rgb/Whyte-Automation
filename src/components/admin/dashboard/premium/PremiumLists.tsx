"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { FileText, Plus, Trophy, Users } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { EASE } from "@/components/admin/sidebar/motionTokens";
import type { DealerPerformanceRow, DeliveryAnalyticsSummary, RecentQuotationRow } from "@/lib/adminDashboardData";
import type { CrmOpportunityStage, CrmSalespersonPerformance } from "@/lib/dashboard/demoData";
import { STATUS_STYLE } from "@/components/admin/dashboard/statusStyle";
import { CountUp } from "./motion";
import { EmptyHint } from "./PremiumCards";
import { RingGauge } from "./charts";
import { compactINR, initialsOf } from "./format";

const ACCENT = "var(--color-admin-primary,#D85B83)";
const MEDAL = ["#E0B341", "#B4B8C0", "#C98A58"];

/** The latest quotations as a tidy list: who, which client, how much, what status. */
export function RecentQuotationList({ rows }: { rows: RecentQuotationRow[] }) {
  if (rows.length === 0) {
    return (
      <div>
        <EmptyHint icon={FileText} title="No quotations created yet" text="Proposals created by your team or dealers will appear here as they happen." />
        <div className="pb-6 text-center">
          <Link href="/quotation/new" className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-950 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800">
            <Plus size={13} aria-hidden="true" />
            Create first quotation
          </Link>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-neutral-100" data-testid="recent-quotations">
      {rows.slice(0, 7).map((row, index) => {
        const status = STATUS_STYLE[row.status] ?? { label: row.status, badge: "bg-neutral-100 text-neutral-600 border-neutral-200" };
        return (
          <motion.li key={row.id} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.35, delay: index * 0.04, ease: EASE }}>
            <Link href={`/quotation/${row.id}`} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-neutral-50/80 sm:px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-[11px] font-bold text-neutral-600 transition group-hover:bg-neutral-950 group-hover:text-white">{initialsOf(row.clientName)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-900">{row.clientName}</span>
                <span className="block truncate text-[11px] text-neutral-500">
                  <span className="font-mono">{row.quotationNumber}</span>
                  {row.ownerName ? ` · ${row.ownerName}${row.ownerIsDealer ? " (dealer)" : ""}` : ""} · {formatDate(row.createdAt)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold text-neutral-950 tabular-nums">{formatCurrency(row.amount)}</span>
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", status.badge)}>{status.label}</span>
              </span>
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}

/** How the quotations that were sent are doing: success ring and the status counts. */
export function DeliveryHealth({ deliveries }: { deliveries: DeliveryAnalyticsSummary }) {
  const chips: Array<{ label: string; value: number; tone: string }> = [
    { label: "Sent", value: deliveries.byStatus.sent, tone: "bg-neutral-100 text-neutral-700" },
    { label: "Delivered", value: deliveries.byStatus.delivered, tone: "bg-emerald-50 text-emerald-700" },
    { label: "Read", value: deliveries.byStatus.read, tone: "bg-sky-50 text-sky-700" },
    { label: "Failed", value: deliveries.byStatus.failed, tone: "bg-rose-50 text-rose-700" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 sm:flex-row" data-testid="delivery-health">
      <RingGauge value={deliveries.total ? deliveries.successRate : 0} label="Success" color="#10B981" />
      <div className="w-full min-w-0 flex-1 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {chips.map((chip) => (
            <div key={chip.label} className={cn("rounded-xl px-3 py-2", chip.tone)}>
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{chip.label}</p>
              <p className="text-lg font-semibold tabular-nums">
                <CountUp value={chip.value} />
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500">
          {deliveries.total} {deliveries.total === 1 ? "dispatch" : "dispatches"} · {deliveries.retryCount} {deliveries.retryCount === 1 ? "retry" : "retries"}
        </p>
      </div>
    </div>
  );
}

/**
 * Deals by stage. Open stages are one hue, lighter to darker as a deal moves on (an ordered scale, not a rainbow); won and
 * lost sit apart below as the outcome. Thin bars on a hairline track; an empty stage shows only its track.
 */
export function StageFunnel({ stages, pipelineValue }: { stages: CrmOpportunityStage[]; pipelineValue: number }) {
  const reduce = useReducedMotion();
  const max = Math.max(...stages.map((s) => s.count), 0);
  if (stages.length === 0 || max === 0) return <EmptyHint icon={Users} title="No deals in the pipeline yet" text="Create a lead and move it through the stages to see the funnel." />;

  const open = stages.filter((s) => s.id !== "won" && s.id !== "lost");
  const won = stages.find((s) => s.id === "won");
  const lost = stages.find((s) => s.id === "lost");
  const decided = (won?.count ?? 0) + (lost?.count ?? 0);
  const winRate = decided > 0 ? Math.round(((won?.count ?? 0) / decided) * 100) : null;
  const openDeals = open.filter((s) => s.id !== "new").reduce((sum, s) => sum + s.count, 0);
  const shade = (index: number) => `color-mix(in srgb, ${ACCENT} ${Math.round(38 + (62 * index) / Math.max(open.length - 1, 1))}%, #ffffff)`;

  const row = (stage: CrmOpportunityStage, color: string, index: number) => (
    <li key={stage.id} className="grid grid-cols-[minmax(0,6.5rem)_minmax(2.5rem,1fr)_auto] items-center gap-3 py-[7px]" data-testid="funnel-stage">
      <span className="truncate text-xs font-medium text-neutral-700">{stage.name}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={`${stage.name}: ${stage.count}`}>
        {stage.count > 0 && (
          <motion.span
            className="block h-full rounded-full"
            style={{ background: color }}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${Math.max((stage.count / max) * 100, 4)}%` }}
            transition={{ duration: 0.7, delay: 0.05 * index, ease: EASE }}
          />
        )}
      </span>
      <span className="w-[4.75rem] text-right text-xs tabular-nums">
        <strong className={cn("font-semibold", stage.count > 0 ? "text-neutral-950" : "text-neutral-400")}>{stage.count}</strong>
        <span className="text-neutral-400"> · {compactINR(stage.value)}</span>
      </span>
    </li>
  );

  return (
    <div className="flex h-full flex-col" data-testid="stage-funnel">
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
          <dt className="text-[11px] font-medium text-neutral-500">In pipeline</dt>
          <dd className="text-lg font-semibold tracking-tight text-neutral-950">{compactINR(pipelineValue)}</dd>
          <dd className="text-[11px] text-neutral-500">
            {openDeals} {openDeals === 1 ? "deal" : "deals"} past first contact
          </dd>
        </div>
        <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
          <dt className="text-[11px] font-medium text-neutral-500">Win rate</dt>
          <dd className="text-lg font-semibold tracking-tight text-neutral-950">{winRate === null ? "—" : `${winRate}%`}</dd>
          <dd className="text-[11px] text-neutral-500">{decided > 0 ? `${won?.count ?? 0} won of ${decided} closed` : "No deals closed yet"}</dd>
        </div>
      </dl>

      <ul className="mt-3">{open.map((stage, index) => row(stage, shade(index), index))}</ul>

      {(won || lost) && (
        <>
          <p className="mt-2 border-t border-neutral-100 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Closed</p>
          <ul>
            {won && row(won, "#10B981", open.length)}
            {lost && row(lost, "#A1A1AA", open.length + 1)}
          </ul>
        </>
      )}
    </div>
  );
}

/** Salespeople ranked by won revenue, with their conversion rate and target. */
export function SalespersonLeaderboard({ people, isDemo }: { people: CrmSalespersonPerformance[]; isDemo?: boolean }) {
  const reduce = useReducedMotion();
  if (people.length === 0) return <EmptyHint icon={Trophy} title="No sales activity yet" text="Assign leads to your sales team and their results will rank here." />;
  const ranked = [...people].sort((a, b) => b.wonRevenue - a.wonRevenue || b.conversionRate - a.conversionRate);
  const top = Math.max(...ranked.map((p) => p.wonRevenue), 1);
  return (
    <ul className="divide-y divide-neutral-100" data-testid="salesperson-leaderboard" data-demo={isDemo ? "true" : undefined}>
      {ranked.map((person, index) => (
        <motion.li key={person.id} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: index * 0.05, ease: EASE }} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-xs font-bold text-white">
            {initialsOf(person.name)}
            {index < 3 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white ring-2 ring-white" style={{ background: MEDAL[index] }} aria-label={`Rank ${index + 1}`}>
                {index + 1}
              </span>
            )}
          </span>
          <span className="min-w-[8rem] flex-1">
            <span className="block truncate text-sm font-semibold text-neutral-900">{person.name}</span>
            <span className="block truncate text-[11px] text-neutral-500">
              {person.leadsAssigned} leads · {person.opportunitiesActive ?? 0} active · {person.quotationsCreated} quotes · {person.wonQuotations} won
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <motion.span
                className="block h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${ACCENT}, color-mix(in srgb, ${ACCENT} 60%, #111114))` }}
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${Math.max((person.wonRevenue / top) * 100, person.wonRevenue > 0 ? 3 : 0)}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.05 * index, ease: EASE }}
              />
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-4 text-right">
            <span>
              <span className="block text-sm font-semibold text-neutral-950 tabular-nums">{compactINR(person.wonRevenue)}</span>
              <span className="block text-[10px] uppercase tracking-wider text-neutral-400">Won</span>
            </span>
            <span>
              <span className="block text-sm font-semibold text-neutral-950 tabular-nums">{person.conversionRate}%</span>
              <span className="block text-[10px] uppercase tracking-wider text-neutral-400">Convert</span>
            </span>
            {person.targetAchievement !== undefined && (
              <span
                className={cn(
                  "rounded-full px-2 py-1 text-[11px] font-bold tabular-nums",
                  person.targetAchievement >= 80 ? "bg-emerald-50 text-emerald-700" : person.targetAchievement >= 60 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
                )}
                title="Achievement against target"
              >
                {person.targetAchievement}%
              </span>
            )}
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

/** Dealers ranked by approved value, with approval rate and earnings. */
export function DealerLeaderboard({ dealers, canViewEarnings, totalActive }: { dealers: DealerPerformanceRow[]; canViewEarnings: boolean; totalActive: number }) {
  if (dealers.length === 0) return <EmptyHint icon={Users} title="No dealer activity yet" text={totalActive ? "Your dealers have not created quotations in this period." : "Add dealers to build your partner network."} />;
  const top = Math.max(...dealers.map((d) => d.approvedValue), 1);
  return (
    <ul className="divide-y divide-neutral-100" data-testid="dealer-leaderboard">
      {dealers.slice(0, 8).map((dealer, index) => (
        <motion.li key={dealer.dealerId} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: index * 0.05, ease: EASE }} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold text-neutral-700">{initialsOf(dealer.name)}</span>
          <span className="min-w-[8rem] flex-1">
            <span className="block truncate text-sm font-semibold text-neutral-900">{dealer.name}</span>
            <span className="block truncate text-[11px] text-neutral-500">
              {dealer.totalQuotations} quotes · {dealer.approvedQuotations} approved · {dealer.approvalRate}% approval
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <span className="block h-full rounded-full bg-neutral-900" style={{ width: `${Math.max((dealer.approvedValue / top) * 100, dealer.approvedValue > 0 ? 3 : 0)}%` }} />
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-4 text-right">
            <span>
              <span className="block text-sm font-semibold text-neutral-950 tabular-nums">{compactINR(dealer.approvedValue)}</span>
              <span className="block text-[10px] uppercase tracking-wider text-neutral-400">Approved</span>
            </span>
            {canViewEarnings && (
              <span>
                <span className="block text-sm font-semibold text-emerald-700 tabular-nums">{compactINR(dealer.earnings)}</span>
                <span className="block text-[10px] uppercase tracking-wider text-neutral-400">Earned</span>
              </span>
            )}
          </span>
        </motion.li>
      ))}
    </ul>
  );
}
