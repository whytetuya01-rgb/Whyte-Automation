import type { DashboardData } from "@/lib/adminDashboardData";

export const TYPE_LABELS: Record<string, string> = {
  switch_board: "Switch Boards",
  accessory: "Accessories",
  curtain: "Curtain Controllers",
  smart_lock: "Smart Locks",
  vdp: "Video Door Phones",
  other: "Other Devices",
};

const BAR_COLORS = ["#D85B83", "#1E1E22", "#E58AA7", "#6E6E78", "#B83E68", "#C9C9D0"];

/** Compact catalog health: product counts and the hardware-type distribution. */
export default function CatalogSnapshot({ catalog }: { catalog: DashboardData["catalog"] }) {
  if (catalog.totalProducts === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-medium text-[#111111]">No products added yet</p>
        <p className="text-xs text-[#8A8A93] mt-1">Add hardware to start building the catalog.</p>
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
      <dl className="grid grid-cols-4 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center">
            <dd className="text-base font-semibold text-[#111111] tabular-nums">{stat.value}</dd>
            <dt className="text-[10px] text-[#8A8A93]">{stat.label}</dt>
          </div>
        ))}
      </dl>

      <ul className="space-y-2.5">
        {catalog.typeBreakdown.map((item, index) => (
          <li key={item.type}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#3F3F46] truncate">{TYPE_LABELS[item.type] ?? item.type}</span>
              <span className="text-[#8A8A93] tabular-nums shrink-0 ml-2">
                {item.count} · {item.percent}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#F0F0F2] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${item.percent}%`, backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
