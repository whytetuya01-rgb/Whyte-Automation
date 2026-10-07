import type { MonthBucket } from "@/lib/adminDashboardData";
import { STATUS_ORDER, STATUS_STYLE } from "./statusStyle";

/** Round the axis maximum up to a tidy value so gridlines land on whole numbers. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / step;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * step;
}

const WIDTH = 640;
const HEIGHT = 230;
const PAD = { top: 12, right: 8, bottom: 26, left: 30 };

/**
 * Quotations created per month for the last six months, stacked by lifecycle
 * status. Pure SVG rendered on the server from real aggregated counts; it has no
 * client JavaScript and no random or placeholder values.
 */
export default function QuotationTrendChart({ months }: { months: MonthBucket[] }) {
  const peak = Math.max(...months.map((m) => m.total), 0);
  if (peak === 0) {
    return (
      <div className="h-56 flex flex-col items-center justify-center text-center">
        <p className="text-sm font-medium text-[#111111]">No quotations in the last 6 months</p>
        <p className="text-xs text-[#8A8A93] mt-1">Monthly activity will appear here once quotations are created.</p>
      </div>
    );
  }

  const axisMax = niceMax(peak);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / months.length;
  const barW = Math.min(44, slot * 0.56);
  const y = (value: number) => PAD.top + plotH - (value / axisMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(axisMax * t)).filter((v, i, all) => all.indexOf(v) === i);

  const summary = months.map((m) => `${m.label}: ${m.total}`).join(", ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Quotations created per month. ${summary}.`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#EEEEF0" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill="#8A8A93">
              {tick}
            </text>
          </g>
        ))}

        {months.map((month, index) => {
          const x = PAD.left + slot * index + (slot - barW) / 2;
          let cursor = 0;
          return (
            <g key={month.key}>
              {STATUS_ORDER.map((status) => {
                const count = month.byStatus[status];
                if (count === 0) return null;
                const top = y(cursor + count);
                const height = y(cursor) - top;
                cursor += count;
                return (
                  <rect key={status} x={x} y={top} width={barW} height={Math.max(height - 1, 1)} rx={2} fill={STATUS_STYLE[status].color}>
                    <title>{`${month.label} · ${STATUS_STYLE[status].label}: ${count}`}</title>
                  </rect>
                );
              })}
              {month.total > 0 && (
                <text x={x + barW / 2} y={y(month.total) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="#111111">
                  {month.total}
                </text>
              )}
              <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="#8A8A93">
                {month.label}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2" aria-label="Status legend">
        {STATUS_ORDER.map((status) => (
          <li key={status} className="inline-flex items-center gap-1.5 text-[11px] text-[#5F5F68]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_STYLE[status].color }} aria-hidden="true" />
            {STATUS_STYLE[status].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
