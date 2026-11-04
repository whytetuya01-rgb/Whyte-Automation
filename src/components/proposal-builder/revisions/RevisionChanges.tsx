"use client";

import { ArrowDownRight, ArrowUpRight, Minus, PenLine, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LineChange, RevisionComparison } from "@/lib/revisionCompare";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const signedMoney = (value: number) => (value === 0 ? "No change" : `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`);

/** Green for added / more, red for removed / less, amber for a change that is neither. Always with a word or sign, never colour alone. */
const tone = {
  up: "text-emerald-700 bg-emerald-50 border-emerald-200",
  down: "text-rose-700 bg-rose-50 border-rose-200",
  changed: "text-amber-800 bg-amber-50 border-amber-200",
  none: "text-gray-500 bg-gray-50 border-gray-200",
};

function DeltaPill({ value }: { value: number }) {
  const kind = value > 0 ? "up" : value < 0 ? "down" : "none";
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums", tone[kind])}>
      <Icon size={11} aria-hidden /> {signedMoney(value)}
    </span>
  );
}

function KindBadge({ line }: { line: LineChange }) {
  const meta = line.kind === "added" ? { label: "Added", cls: tone.up, Icon: Plus } : line.kind === "removed" ? { label: "Removed", cls: tone.down, Icon: Minus } : { label: "Changed", cls: tone.changed, Icon: PenLine };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", meta.cls)} data-testid="change-kind">
      <meta.Icon size={10} aria-hidden /> {meta.label}
    </span>
  );
}

/** One side of a line, written out: "6 × ₹1,180 (White, 10% off)". */
function describe(side: LineChange["from"]): string {
  if (!side) return "—";
  const extras = [side.variant, side.discount].filter(Boolean).join(", ");
  return `${side.quantity} × ${money(side.unitPrice)}${extras ? ` (${extras})` : ""}`;
}

/** What changed on a modified line, in words: "Quantity 4 → 6 (+2)". */
function fieldNotes(line: LineChange): string[] {
  if (line.kind !== "modified" || !line.from || !line.to) return [];
  return line.fields.map((field) => {
    const a = line.from!;
    const b = line.to!;
    if (field === "quantity") return `Quantity ${a.quantity} → ${b.quantity} (${b.quantity - a.quantity > 0 ? "+" : ""}${b.quantity - a.quantity})`;
    if (field === "unitPrice") return `Unit price ${money(a.unitPrice)} → ${money(b.unitPrice)}`;
    if (field === "variant") return `Variant ${a.variant ?? "—"} → ${b.variant ?? "—"}`;
    if (field === "discount") return `Product discount ${a.discount ?? "none"} → ${b.discount ?? "none"}`;
    return `GST per unit ${money((a.gst ?? 0) / a.quantity)} → ${money((b.gst ?? 0) / b.quantity)}`;
  });
}

export default function RevisionChanges({ comparison, fromLabel, toLabel }: { comparison: RevisionComparison; fromLabel: string; toLabel: string }) {
  const { lines, rooms, totals, summary } = comparison;
  const grand = totals.find((row) => row.key === "grandTotal");

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" aria-label="Changes summary" data-testid="revision-changes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-gray-950">Changes summary</h2>
          <p className="text-xs text-gray-500">
            {fromLabel} → {toLabel}, read from what was frozen when each was issued. The PDFs below are shown exactly as issued.
          </p>
        </div>
        {grand && (
          <div className="text-right">
            <p className="text-[11px] font-medium text-gray-500">Final total</p>
            <p className="text-base font-bold text-gray-950" data-testid="changes-grand-total">
              {money(grand.from)} → {money(grand.to)}
            </p>
            <DeltaPill value={grand.delta} />
          </div>
        )}
      </div>

      {summary.identical ? (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600" data-testid="changes-identical">
          These two revisions have the same products, quantities, prices and totals.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2 text-xs" data-testid="changes-counts">
          <li className={cn("rounded-full border px-2.5 py-1 font-semibold", tone.up)}>{summary.added} added</li>
          <li className={cn("rounded-full border px-2.5 py-1 font-semibold", tone.down)}>{summary.removed} removed</li>
          <li className={cn("rounded-full border px-2.5 py-1 font-semibold", tone.changed)}>{summary.modified} changed</li>
          {summary.roomsAdded > 0 && <li className={cn("rounded-full border px-2.5 py-1 font-semibold", tone.up)}>{summary.roomsAdded} room{summary.roomsAdded === 1 ? "" : "s"} added</li>}
          {summary.roomsRemoved > 0 && <li className={cn("rounded-full border px-2.5 py-1 font-semibold", tone.down)}>{summary.roomsRemoved} room{summary.roomsRemoved === 1 ? "" : "s"} removed</li>}
        </ul>
      )}

      {lines.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 sm:hidden" data-testid="changes-lines-cards">
          {lines.map((line) => (
            <li key={line.key} className="space-y-1.5 px-3 py-3 text-xs" data-testid="change-line" data-kind={line.kind}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-gray-950">{line.product}</span>
                    <KindBadge line={line} />
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {line.room}
                    {line.code ? ` · ${line.code}` : ""}
                  </p>
                </div>
                <DeltaPill value={line.totalDelta} />
              </div>
              {fieldNotes(line).map((note) => (
                <p key={note} className="text-[11px] font-medium text-amber-800">{note}</p>
              ))}
              <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-0.5 tabular-nums">
                <dt className="text-gray-500">{fromLabel}</dt>
                <dd className={cn(line.kind === "removed" && "text-rose-700 line-through decoration-rose-300")}>{line.from ? `${describe(line.from)} = ${money(line.from.lineTotal)}` : "—"}</dd>
                <dt className="text-gray-500">{toLabel}</dt>
                <dd className={cn(line.kind === "added" && "font-semibold text-emerald-700")}>{line.to ? `${describe(line.to)} = ${money(line.to.lineTotal)}` : "—"}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="hidden overflow-x-auto rounded-xl border border-gray-100 sm:block">
          <table className="w-full min-w-[640px] text-left text-xs" data-testid="changes-lines">
            <caption className="sr-only">Products that changed between {fromLabel} and {toLabel}</caption>
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2">Item</th>
                <th scope="col" className="px-3 py-2">{fromLabel}</th>
                <th scope="col" className="px-3 py-2">{toLabel}</th>
                <th scope="col" className="px-3 py-2 text-right">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line) => (
                <tr key={line.key} data-testid="change-line" data-kind={line.kind}>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-gray-950">{line.product}</span>
                      <KindBadge line={line} />
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {line.room}
                      {line.code ? ` · ${line.code}` : ""}
                    </p>
                    {fieldNotes(line).map((note) => (
                      <p key={note} className="text-[11px] font-medium text-amber-800" data-testid="change-note">{note}</p>
                    ))}
                  </td>
                  <td className={cn("px-3 py-2.5 align-top tabular-nums", line.kind === "removed" && "text-rose-700 line-through decoration-rose-300")}>
                    {describe(line.from)}
                    {line.from && <p className="text-[11px] text-gray-500">{money(line.from.lineTotal)}</p>}
                  </td>
                  <td className={cn("px-3 py-2.5 align-top tabular-nums", line.kind === "added" && "font-semibold text-emerald-700")}>
                    {describe(line.to)}
                    {line.to && <p className="text-[11px] text-gray-500">{money(line.to.lineTotal)}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right align-top">
                    <DeltaPill value={line.totalDelta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rooms.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs" data-testid="changes-rooms">
          {rooms.map((room) => (
            <li key={`${room.kind}-${room.name}-${room.previousName}`} className={cn("rounded-lg border px-2.5 py-1", room.kind === "added" ? tone.up : room.kind === "removed" ? tone.down : tone.changed)}>
              {room.kind === "added" ? `Room added: ${room.name}` : room.kind === "removed" ? `Room removed: ${room.name}` : `Room renamed: ${room.previousName} → ${room.name}`}
              {room.kind !== "renamed" ? ` (${room.items} item${room.items === 1 ? "" : "s"})` : ""}
            </li>
          ))}
        </ul>
      )}

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 sm:hidden" data-testid="changes-totals">
        {totals.map((row) => (
          <li key={row.key} className={cn("flex items-center justify-between gap-2 px-3 py-2 text-xs", row.key === "grandTotal" && "bg-gray-50 font-bold")} data-testid="total-row" data-key={row.key}>
            <div className="min-w-0">
              <p className="font-medium text-gray-800">{row.label}</p>
              <p className="tabular-nums text-gray-600">
                {money(row.from)} → <span className="text-gray-950">{money(row.to)}</span>
              </p>
            </div>
            <DeltaPill value={row.delta} />
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-gray-100 sm:block">
        <table className="w-full min-w-[480px] text-left text-xs" data-testid="changes-totals">
          <caption className="sr-only">Totals of {fromLabel} and {toLabel}</caption>
          <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2">Totals</th>
              <th scope="col" className="px-3 py-2 text-right">{fromLabel}</th>
              <th scope="col" className="px-3 py-2 text-right">{toLabel}</th>
              <th scope="col" className="px-3 py-2 text-right">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {totals.map((row) => (
              <tr key={row.key} className={cn(row.key === "grandTotal" && "bg-gray-50 font-bold")} data-testid="total-row" data-key={row.key}>
                <th scope="row" className="px-3 py-2 font-medium text-gray-800">{row.label}</th>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{money(row.from)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-950">{money(row.to)}</td>
                <td className="px-3 py-2 text-right">
                  <DeltaPill value={row.delta} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
