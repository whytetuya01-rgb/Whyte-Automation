"use client";

import { useState } from "react";
import type { MonthBucket } from "@/lib/adminDashboardData";
import { formatCurrency } from "@/lib/utils";
import { STATUS_ORDER, STATUS_STYLE } from "./statusStyle";

interface RevenueTrendChartProps {
  trend: MonthBucket[];
}

function niceMax(max: number): number {
  if (max <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / step;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * step;
}

const WIDTH = 680;
const HEIGHT = 230;
const PAD = { top: 16, right: 10, bottom: 26, left: 46 };

export default function RevenueTrendChart({ trend }: RevenueTrendChartProps) {
  const [metricMode, setMetricMode] = useState<"revenue" | "volume">("revenue");

  const totalRevenue = trend.reduce((sum, b) => sum + (b.approvedValue || 0), 0);
  const totalVolume = trend.reduce((sum, b) => sum + b.total, 0);

  const peakValue = metricMode === "revenue"
    ? Math.max(...trend.map((m) => m.approvedValue || 0), 0)
    : Math.max(...trend.map((m) => m.total), 0);

  if (peakValue === 0) {
    return (
      <div className="h-56 flex flex-col items-center justify-center text-center p-6 bg-[#F6F6F7]/60 rounded-xl border border-dashed border-[#E5E5E7]">
        <p className="text-sm font-medium text-[#111111]">No activity recorded for this period</p>
        <p className="text-xs text-[#8A8A93] mt-1 max-w-sm">
          Periodic revenue and quotation volume trends will be graphed here as proposals are issued and approved.
        </p>
      </div>
    );
  }

  const axisMax = niceMax(peakValue);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(trend.length, 1);
  const barW = Math.min(36, slot * 0.54);
  const y = (val: number) => PAD.top + plotH - (val / axisMax) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(axisMax * t)).filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="space-y-3">
      {/* Metric Mode Switcher Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div className="flex items-center gap-4 text-xs font-normal">
          <div className="flex items-center gap-1.5">
            <span className="text-[#8A8A93]">Period Won:</span>
            <span className="font-semibold text-emerald-800 tracking-tight">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[#8A8A93]">Quotations:</span>
            <span className="font-semibold text-[#111111]">{totalVolume}</span>
          </div>
        </div>

        <div className="inline-flex bg-[#F6F6F7] p-0.5 rounded-lg border border-[#E5E5E7] text-xs self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setMetricMode("revenue")}
            className={`px-2.5 py-1 rounded-md transition cursor-pointer text-xs ${
              metricMode === "revenue"
                ? "bg-white text-[#111111] font-semibold shadow-2xs"
                : "text-[#5F5F68] hover:text-[#111111] font-medium"
            }`}
          >
            Revenue (₹)
          </button>
          <button
            type="button"
            onClick={() => setMetricMode("volume")}
            className={`px-2.5 py-1 rounded-md transition cursor-pointer text-xs ${
              metricMode === "volume"
                ? "bg-white text-[#111111] font-semibold shadow-2xs"
                : "text-[#5F5F68] hover:text-[#111111] font-medium"
            }`}
          >
            Volume (Quotes)
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label="Quotation activity trend"
      >
        {/* Horizontal gridlines */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#F0F0F2" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill="#8A8A93" fontFamily="inherit">
              {metricMode === "revenue"
                ? tick >= 100000
                  ? `₹${(tick / 100000).toFixed(1)}L`
                  : tick >= 1000
                  ? `₹${(tick / 1000).toFixed(0)}k`
                  : `₹${tick}`
                : tick}
            </text>
          </g>
        ))}

        {/* Bars */}
        {trend.map((bucket, index) => {
          const x = PAD.left + slot * index + (slot - barW) / 2;

          if (metricMode === "revenue") {
            const rev = bucket.approvedValue || 0;
            const top = y(rev);
            const barH = y(0) - top;
            return (
              <g key={bucket.key} className="group cursor-pointer">
                <rect
                  x={x}
                  y={top}
                  width={barW}
                  height={Math.max(barH, 2)}
                  rx={3}
                  fill="#10B981"
                  className="transition-opacity hover:opacity-85"
                >
                  <title>{`${bucket.label}: ${formatCurrency(rev)} (${bucket.total} quotations)`}</title>
                </rect>
                {rev > 0 && (
                  <text
                    x={x + barW / 2}
                    y={Math.max(top - 4, PAD.top)}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={500}
                    fill="#059669"
                    fontFamily="inherit"
                  >
                    {rev >= 100000 ? `${(rev / 100000).toFixed(1)}L` : rev >= 1000 ? `${(rev / 1000).toFixed(0)}k` : rev}
                  </text>
                )}
                <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="#8A8A93" fontFamily="inherit">
                  {bucket.label}
                </text>
              </g>
            );
          }

          // Volume mode: Stacked by status
          let cursor = 0;
          return (
            <g key={bucket.key}>
              {STATUS_ORDER.map((status) => {
                const count = bucket.byStatus[status] || 0;
                if (count === 0) return null;
                const top = y(cursor + count);
                const barH = y(cursor) - top;
                cursor += count;
                return (
                  <rect
                    key={status}
                    x={x}
                    y={top}
                    width={barW}
                    height={Math.max(barH - 1, 1)}
                    rx={2}
                    fill={STATUS_STYLE[status].color}
                  >
                    <title>{`${bucket.label} · ${STATUS_STYLE[status].label}: ${count}`}</title>
                  </rect>
                );
              })}
              {bucket.total > 0 && (
                <text x={x + barW / 2} y={y(bucket.total) - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="#111111" fontFamily="inherit">
                  {bucket.total}
                </text>
              )}
              <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="#8A8A93" fontFamily="inherit">
                {bucket.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F0F0F2] text-[11px] text-[#5F5F68]">
        {metricMode === "volume" ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {STATUS_ORDER.map((status) => (
              <li key={status} className="inline-flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_STYLE[status].color }} />
                <span>{STATUS_STYLE[status].label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
            <span>Approved Quotation Value (Revenue Inflow)</span>
          </div>
        )}
        <span className="text-[10px] text-[#8A8A93]">Values in INR (₹)</span>
      </div>
    </div>
  );
}
