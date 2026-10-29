"use client";

import { Send, CheckCircle2, Eye, AlertOctagon, Mail } from "lucide-react";
import type { DeliveryAnalyticsSummary } from "@/lib/adminDashboardData";
import { formatDate } from "@/lib/utils";

interface DeliveryAnalyticsCardProps {
  deliveries: DeliveryAnalyticsSummary;
}

export default function DeliveryAnalyticsCard({ deliveries }: DeliveryAnalyticsCardProps) {
  const { total, byStatus, successRate, retryCount, recent } = deliveries;

  return (
    <div className="space-y-4">
      {/* 4 Clean Metric Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 bg-[#F6F6F7]/60 rounded-xl border border-[#E5E5E7]">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8A8A93] font-medium uppercase tracking-wider">
            <Send size={12} className="text-[#5F5F68]" />
            <span>Sent</span>
          </div>
          <div className="text-xl font-semibold text-[#111111] tabular-nums mt-1">
            {byStatus.sent + byStatus.delivered + byStatus.read}
          </div>
          <div className="text-[10px] text-[#8A8A93] mt-0.5">{total} total dispatches</div>
        </div>

        <div className="p-3 bg-[#F6F6F7]/60 rounded-xl border border-[#E5E5E7]">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 font-medium uppercase tracking-wider">
            <CheckCircle2 size={12} className="text-emerald-600" />
            <span>Delivered</span>
          </div>
          <div className="text-xl font-semibold text-emerald-800 tabular-nums mt-1">
            {byStatus.delivered + byStatus.read}
          </div>
          <div className="text-[10px] text-emerald-700 mt-0.5">{successRate}% confirmed</div>
        </div>

        <div className="p-3 bg-[#F6F6F7]/60 rounded-xl border border-[#E5E5E7]">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8A8A93] font-medium uppercase tracking-wider">
            <Eye size={12} className="text-[#5F5F68]" />
            <span>Opened</span>
          </div>
          <div className="text-xl font-semibold text-[#111111] tabular-nums mt-1">
            {byStatus.read}
          </div>
          <div className="text-[10px] text-[#8A8A93] mt-0.5">Webhook tracked</div>
        </div>

        <div className="p-3 bg-[#F6F6F7]/60 rounded-xl border border-[#E5E5E7]">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8A8A93] font-medium uppercase tracking-wider">
            <AlertOctagon size={12} className="text-[#8A8A93]" />
            <span>Failed</span>
          </div>
          <div className="text-xl font-semibold text-[#111111] tabular-nums mt-1">
            {byStatus.failed}
          </div>
          <div className="text-[10px] text-[#8A8A93] mt-0.5">{retryCount} retried</div>
        </div>
      </div>

      {/* Recent Dispatches List */}
      <div>
        <div className="text-[11px] font-semibold text-[#8A8A93] uppercase tracking-wider mb-2">
          Recent Delivery Logs
        </div>
        {recent.length === 0 ? (
          <div className="text-xs text-[#8A8A93] py-4 text-center bg-[#F6F6F7]/60 rounded-xl border border-dashed border-[#E5E5E7]">
            No proposal delivery activity in this date range.
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((d) => {
              const isDelivered = d.status === "delivered" || d.status === "read";
              const isFailed = d.status === "failed";
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[#F6F6F7]/60 hover:bg-[#F6F6F7] transition-colors text-xs"
                >
                  <div className="flex items-center gap-2 truncate pr-2">
                    <Mail size={13} className="text-[#8A8A93] shrink-0" />
                    <span className="font-medium text-[#111111] truncate">{d.recipient}</span>
                    <span className="text-[11px] text-[#8A8A93] shrink-0 font-mono">#{d.quotationId}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase ${
                        isDelivered
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : isFailed
                          ? "bg-red-50 text-red-800 border border-red-200"
                          : "bg-blue-50 text-blue-800 border border-blue-200"
                      }`}
                    >
                      {d.status}
                    </span>
                    <span className="text-[10px] text-[#8A8A93]">{formatDate(d.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
