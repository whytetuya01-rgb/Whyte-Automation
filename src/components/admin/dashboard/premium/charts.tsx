"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/admin/sidebar/motionTokens";
import { CountUp } from "./motion";
import { compactINR } from "./format";

const ACCENT = "var(--color-admin-primary,#D85B83)";

/** A smooth line through points (Catmull-Rom turned into cubic curves). */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** A small line that draws itself, for the bottom of a KPI card. */
export function Sparkline({ values, color = ACCENT, height = 34 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const width = 100;
  const points: Array<[number, number]> = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 8)]);
  const line = smoothPath(points);
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden="true" data-testid="sparkline">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={area} fill={`url(#spark-${id})`} initial={reduce ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.3 }} />
      <motion.path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" vectorEffect="non-scaling-stroke" initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.1, ease: EASE }} />
    </svg>
  );
}

export interface TrendPoint {
  label: string;
  /** Quotations created (the lower strip). */
  count: number;
  /** Won revenue (the area above). */
  value: number;
}

/** The width of an element in CSS pixels, kept current as it resizes (0 until first measured). */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * A curve through points that never overshoots them (monotone cubic, Fritsch-Carlson): between two points it stays
 * between their values, so revenue can never be drawn below zero or above its peak.
 */
function monotonePath(points: Array<[number, number]>): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;
  if (n === 2) return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1][0] - points[i][0] || 1);
    slope.push((points[i + 1][1] - points[i][1]) / (dx[i] || 1));
  }
  const tangent: number[] = new Array(n).fill(0);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) tangent[i] = 0;
    else tangent[i] = (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / slope[i - 1] + (dx[i] + 2 * dx[i - 1]) / slope[i]);
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const third = dx[i] / 3;
    d += ` C${points[i][0] + third},${points[i][1] + tangent[i] * third} ${points[i + 1][0] - third},${points[i + 1][1] - tangent[i + 1] * third} ${points[i + 1][0]},${points[i + 1][1]}`;
  }
  return d;
}

/** A round axis maximum at or above `value` (1, 2, 2.5 or 5 times a power of ten). */
function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / power;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return step * power;
}

/** A bar with rounded top corners only, standing on the baseline. */
function barPath(x: number, baseline: number, width: number, height: number, radius = 3): string {
  if (height <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  const top = baseline - height;
  return `M${x},${baseline} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${baseline} Z`;
}

/**
 * Won revenue (an area) with quotations created (a slim strip of bars) underneath, on one shared time axis. Two measures,
 * two scales, two bands: never one plot with two hidden scales. The chart keeps a fixed height and real-pixel text at any
 * width; hover, touch or the arrow keys show one period's figures.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const id = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = points.length;
  const totalValue = points.reduce((sum, p) => sum + p.value, 0);
  const totalCount = points.reduce((sum, p) => sum + p.count, 0);
  const empty = n === 0 || (totalValue === 0 && totalCount === 0);

  // Geometry in real pixels.
  const padL = 46;
  const padR = 10;
  const revenueTop = 18;
  const revenueH = 172;
  const stripGap = 18;
  const stripH = 36;
  const axisH = 22;
  const H = revenueTop + revenueH + stripGap + stripH + axisH;
  const revenueBase = revenueTop + revenueH;
  const stripBase = revenueBase + stripGap + stripH;
  const plotW = Math.max(width - padL - padR, 1);

  const maxValue = niceCeiling(Math.max(...points.map((p) => p.value), 0));
  const maxCount = Math.max(...points.map((p) => p.count), 0);
  const slot = n > 0 ? plotW / n : plotW;
  const xAt = (i: number) => padL + slot * i + slot / 2;
  const yValue = (v: number) => revenueBase - (v / maxValue) * revenueH;
  const barWidth = Math.max(4, Math.min(18, slot * 0.42));
  const barHeight = (c: number) => (maxCount ? Math.max((c / maxCount) * stripH, c > 0 ? 2 : 0) : 0);
  const peak = points.reduce((best, p, i) => (p.value > (points[best]?.value ?? 0) ? i : best), 0);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));

  const line: Array<[number, number]> = points.map((p, i) => [xAt(i), yValue(p.value)]);
  const linePath = monotonePath(line);
  const areaPath = n > 1 ? `${linePath} L${xAt(n - 1)},${revenueBase} L${xAt(0)},${revenueBase} Z` : "";

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const index = Math.floor((clientX - rect.left - padL) / slot);
    setHover(Math.max(0, Math.min(n - 1, index)));
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setHover((current) => {
      const from = current ?? (event.key === "ArrowLeft" ? n : -1);
      return Math.max(0, Math.min(n - 1, from + (event.key === "ArrowLeft" ? -1 : 1)));
    });
  };

  const active = hover !== null ? points[hover] : null;
  const tooltipLeft = hover !== null ? Math.min(Math.max(xAt(hover), 84), Math.max(width - 84, 84)) : 0;

  return (
    <div className="flex h-full flex-col" data-testid="trend-chart">
      <dl className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: ACCENT }} aria-hidden="true" />
            Won revenue
          </dt>
          <dd className="text-lg font-semibold tracking-tight text-neutral-950">{compactINR(totalValue)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
            <span className="h-2.5 w-1.5 rounded-sm bg-neutral-300" aria-hidden="true" />
            Quotations created
          </dt>
          <dd className="text-lg font-semibold tracking-tight text-neutral-950">{totalCount}</dd>
        </div>
      </dl>

      <div
        ref={wrapRef}
        className="relative mt-3 touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-admin-primary,#D85B83)]/40"
        style={{ height: H }}
        tabIndex={empty ? -1 : 0}
        role="group"
        aria-label={empty ? "No activity in this period" : `Won revenue ${compactINR(totalValue)} and ${totalCount} quotations, ${points[0].label} to ${points[n - 1].label}. Use the arrow keys for each period.`}
        onPointerMove={(event) => pick(event.clientX)}
        onPointerDown={(event) => pick(event.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
      >
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-200 text-center">
            <p className="text-sm font-semibold text-neutral-700">No activity in this period yet</p>
            <p className="max-w-xs text-xs text-neutral-500">Quotations and won revenue appear here as soon as they are created.</p>
          </div>
        ) : width > 0 ? (
          <svg width={width} height={H} className="block" aria-hidden="true">
            <defs>
              <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* revenue scale: solid hairlines, labels in muted ink */}
            {[0, 0.5, 1].map((t) => {
              const y = revenueBase - t * revenueH;
              return (
                <g key={t}>
                  <line x1={padL} x2={width - padR} y1={y} y2={y} stroke={t === 0 ? "#E4E4E7" : "#F1F1F3"} />
                  <text x={padL - 8} y={y + 3.5} textAnchor="end" fill="#A1A1AA" style={{ fontSize: 11 }}>
                    {compactINR(maxValue * t)}
                  </text>
                </g>
              );
            })}

            {n > 1 && <motion.path d={areaPath} fill={`url(#area-${id})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />}
            {n > 1 && (
              <motion.path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: EASE }} />
            )}

            {/* one direct label: the best period */}
            {points[peak].value > 0 && hover === null && (
              <g>
                <circle cx={xAt(peak)} cy={yValue(points[peak].value)} r={4} fill={ACCENT} stroke="#fff" strokeWidth={2} />
                <text x={Math.min(Math.max(xAt(peak), padL + 24), width - padR - 24)} y={yValue(points[peak].value) - 10} textAnchor="middle" fill="#3F3F46" style={{ fontSize: 11, fontWeight: 600 }}>
                  {compactINR(points[peak].value)}
                </text>
              </g>
            )}

            {/* quotation volume strip, on its own scale */}
            <line x1={padL} x2={width - padR} y1={stripBase} y2={stripBase} stroke="#E4E4E7" />
            <text x={padL - 8} y={stripBase - stripH + 8} textAnchor="end" fill="#A1A1AA" style={{ fontSize: 11 }}>
              {maxCount}
            </text>
            {points.map((p, i) => (
              <path key={`bar-${i}`} d={barPath(xAt(i) - barWidth / 2, stripBase, barWidth, barHeight(p.count))} fill={hover === i ? "#71717A" : "#D4D4D8"} />
            ))}

            {hover !== null && (
              <g>
                <line x1={xAt(hover)} x2={xAt(hover)} y1={revenueTop - 6} y2={stripBase} stroke="#A1A1AA" strokeOpacity={0.6} />
                <circle cx={xAt(hover)} cy={yValue(points[hover].value)} r={5} fill={ACCENT} stroke="#fff" strokeWidth={2} />
              </g>
            )}

            {points.map((p, i) => {
              const last = i === n - 1;
              if (!last && i % labelEvery !== 0) return null;
              if (!last && n - 1 - i < labelEvery / 2) return null; // too close to the last label
              const anchor = i === 0 && n > 1 ? "start" : last && n > 1 ? "end" : "middle";
              const x = anchor === "start" ? xAt(i) - slot / 2 + 2 : anchor === "end" ? xAt(i) + slot / 2 - 2 : xAt(i);
              return (
                <text key={`x-${i}`} x={Math.max(padL, Math.min(x, width - padR))} y={H - 6} textAnchor={anchor} fill={hover === i ? "#18181B" : "#A1A1AA"} style={{ fontSize: 11, fontWeight: hover === i ? 600 : 400 }}>
                  {p.label}
                </text>
              );
            })}
          </svg>
        ) : null}

        {active && hover !== null && (
          <div className="pointer-events-none absolute top-0 z-10 w-[9.5rem] -translate-x-1/2 rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur" style={{ left: tooltipLeft }} data-testid="trend-tooltip">
            <p className="font-semibold text-neutral-900">{active.label}</p>
            <p className="mt-1 flex items-center justify-between gap-2 text-neutral-600">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full" style={{ background: ACCENT }} aria-hidden="true" />
                Won
              </span>
              <strong className="text-neutral-950 tabular-nums">{compactINR(active.value)}</strong>
            </p>
            <p className="flex items-center justify-between gap-2 text-neutral-600">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-1.5 rounded-sm bg-neutral-400" aria-hidden="true" />
                Quotations
              </span>
              <strong className="text-neutral-950 tabular-nums">{active.count}</strong>
            </p>
          </div>
        )}
      </div>

      {!empty && (
        <table className="sr-only">
          <caption>Won revenue and quotations created by period</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Won revenue</th>
              <th scope="col">Quotations created</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={`row-${i}`}>
                <th scope="row">{p.label}</th>
                <td>{compactINR(p.value)}</td>
                <td>{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export interface DonutSegment {
  key: string;
  label: string;
  count: number;
  color: string;
  /** Optional line shown under the label (a value, for example). */
  sub?: string;
}

/** A donut that sweeps in; the legend beside it lights up the matching segment. */
export function StatusDonut({ segments, centerLabel }: { segments: DonutSegment[]; centerLabel: string }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 && segments.filter((s) => s.count > 0).length > 1 ? 3 : 0;
  let offset = 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 sm:flex-row sm:items-center" data-testid="status-donut">
      <div className="relative h-44 w-44 shrink-0">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label={`${total} ${centerLabel}`}>
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#F0F0F2" strokeWidth="18" />
          {total > 0 &&
            segments.map((segment, index) => {
              const length = (segment.count / total) * circumference;
              const dash = Math.max(length - gap, 0);
              const start = offset;
              offset += length;
              if (segment.count === 0) return null;
              return (
                <motion.circle
                  key={segment.key}
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={active === segment.key ? 22 : 18}
                  strokeLinecap="butt"
                  strokeDashoffset={-start}
                  initial={reduce ? false : { strokeDasharray: `0 ${circumference}` }}
                  whileInView={{ strokeDasharray: `${dash} ${circumference - dash}` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.9, delay: 0.15 * index, ease: EASE }}
                  style={{ opacity: active && active !== segment.key ? 0.35 : 1, transition: "opacity 160ms, stroke-width 160ms" }}
                />
              );
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tracking-tight text-neutral-950 tabular-nums">
            <CountUp value={total} />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.key}>
            <button
              type="button"
              onMouseEnter={() => setActive(segment.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(segment.key)}
              onBlur={() => setActive(null)}
              className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition", active === segment.key ? "bg-neutral-50" : "hover:bg-neutral-50")}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: segment.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-neutral-800">{segment.label}</span>
                {segment.sub && <span className="block truncate text-[11px] text-neutral-500">{segment.sub}</span>}
              </span>
              <span className="text-sm font-semibold text-neutral-950 tabular-nums">{segment.count}</span>
              <span className="w-10 text-right text-[11px] text-neutral-400 tabular-nums">{total ? Math.round((segment.count / total) * 100) : 0}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  /** What the bar measures (its width). */
  value: number;
  /** Shown at the end of the row. */
  display: string;
  sub?: string;
  color?: string;
}

/** Horizontal bars that grow in, longest first by the order given. */
export function BarList({ rows, emptyText = "Nothing to show yet" }: { rows: BarRow[]; emptyText?: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0 || max === 0) return <p className="py-8 text-center text-xs text-neutral-500">{emptyText}</p>;
  return (
    <ul className="space-y-3" data-testid="bar-list">
      {rows.map((row, index) => (
        <li key={row.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-xs font-semibold text-neutral-800">{row.label}</span>
            <span className="shrink-0 text-xs font-semibold text-neutral-950 tabular-nums">{row.display}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <motion.div
              className="h-full rounded-full"
              style={{ background: row.color ?? `linear-gradient(90deg, ${ACCENT}, color-mix(in srgb, ${ACCENT} 60%, #111114))` }}
              initial={reduce ? false : { width: 0 }}
              whileInView={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 3 : 0)}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.06 * index, ease: EASE }}
            />
          </div>
          {row.sub && <p className="mt-0.5 text-[11px] text-neutral-500">{row.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

/** A ring gauge for a percentage; the arc sweeps in and the number counts up. */
export function RingGauge({ value, label, size = 112, color = ACCENT }: { value: number; label: string; size?: number; color?: string }) {
  const reduce = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} data-testid="ring-gauge" role="img" aria-label={`${label}: ${Math.round(clamped)}%`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#F0F0F2" strokeWidth="9" />
        <motion.circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          whileInView={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: EASE }}
          style={reduce ? { strokeDashoffset: circumference * (1 - clamped / 100) } : undefined}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tracking-tight text-neutral-950 tabular-nums">
          <CountUp value={clamped} format={(n) => `${Math.round(n)}%`} />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</span>
      </div>
    </div>
  );
}
