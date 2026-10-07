/** Skeleton that mirrors the dashboard grid, so nothing jumps when data arrives. */
function Block({ className }: { className: string }) {
  return <div className={`rounded-2xl border border-[#E5E5E7] bg-white ${className}`} aria-hidden="true" />;
}

export default function DashboardLoading() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading dashboard">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-32 rounded-md bg-[#ECECEF] animate-pulse" />
          <div className="h-4 w-72 max-w-full rounded-md bg-[#F0F0F2] animate-pulse" />
        </div>
        <div className="h-9 w-36 rounded-xl bg-[#ECECEF] animate-pulse hidden sm:block" />
      </div>
      <div className="grid grid-cols-12 gap-4 lg:gap-5 animate-pulse">
        <div className="col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {[0, 1, 2, 3].map((i) => (
            <Block key={i} className="h-[112px]" />
          ))}
        </div>
        <Block className="col-span-12 lg:col-span-8 h-[320px]" />
        <Block className="col-span-12 md:col-span-6 lg:col-span-4 h-[320px]" />
        <Block className="col-span-12 lg:col-span-8 h-[300px]" />
        <Block className="col-span-12 lg:col-span-4 h-[300px]" />
      </div>
      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}
