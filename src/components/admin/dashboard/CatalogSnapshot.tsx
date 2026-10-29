import type { DashboardData } from "@/lib/adminDashboardData";

export const TYPE_LABELS: Record<string, string> = {
  switch_board: "Switch Boards",
  accessory: "Accessories",
  curtain: "Curtain Controllers",
  smart_lock: "Smart Locks",
  vdp: "Video Door Phones",
  other: "Other Devices",
};

const BAR_COLORS = [
  "var(--color-admin-primary, #D85B83)",
  "#111111",
  "#475569",
  "#059669",
  "#D97706",
  "#8A8A93",
];

/**
 * Compact catalog health widget: product stats and hardware-type distribution.
 * Rendered with architectural clean meters and high-contrast typography.
 */
export default function CatalogSnapshot({ catalog }: { catalog: DashboardData["catalog"] }) {
  if (catalog.totalProducts === 0) {
    return (
      <div className="py-8 text-center bg-[#F6F6F7]/60 rounded-xl border border-dashed border-[#E5E5E7] p-4">
        <p className="text-sm font-medium text-[#111111]">No products added yet</p>
        <p className="text-xs text-[#8A8A93] mt-0.5">Add hardware to start building the catalog.</p>
      </div>
    );
  }

  const stats = [
    { label: "Active", value: catalog.activeProducts },
    { label: "Inactive", value: catalog.inactiveProducts },
    { label: "Matrix", value: catalog.matrixProducts },
    { label: "Series", value: catalog.seriesCount },
  ];

  return (
    <div className="space-y-4">
      {/* 4 Stat Metric Pills */}
      <dl className="grid grid-cols-4 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center p-2 rounded-xl bg-[#F6F6F7]/60 border border-[#E5E5E7]">
            <dd className="text-sm sm:text-base font-semibold text-[#111111] tabular-nums">{stat.value}</dd>
            <dt className="text-[10px] text-[#8A8A93] font-medium uppercase tracking-wider mt-0.5">{stat.label}</dt>
          </div>
        ))}
      </dl>

      {/* Hardware Distribution Breakdown */}
      <ul className="space-y-2.5 pt-1">
        {catalog.typeBreakdown.map((item, index) => (
          <li key={item.type} className="text-xs space-y-1">
            <div className="flex items-center justify-between text-[#5F5F68]">
              <span className="font-medium text-[#111111] truncate">{TYPE_LABELS[item.type] ?? item.type}</span>
              <span className="text-[#8A8A93] tabular-nums shrink-0 ml-2 font-medium">
                {item.count} · {item.percent}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#F0F0F2] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${item.percent}%`,
                  backgroundColor: BAR_COLORS[index % BAR_COLORS.length],
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
