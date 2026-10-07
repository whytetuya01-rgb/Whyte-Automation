import type { QuotationStatus } from "@/types";

/**
 * One place for quotation-status presentation on the dashboard (chart, summary
 * and badges), so the same status is always the same colour.
 *
 * Colours stay inside the Whyte palette plus one conventional red for
 * "rejected", and each status is also distinguished by its text label, never by
 * colour alone.
 */
export const STATUS_ORDER: QuotationStatus[] = ["draft", "sent", "approved", "delivered", "rejected"];

export const STATUS_STYLE: Record<QuotationStatus, { label: string; color: string; badge: string }> = {
  draft: { label: "Draft", color: "#C9C9D0", badge: "bg-[#F6F6F7] text-[#5F5F68] border-[#E5E5E7]" },
  sent: { label: "Sent", color: "#6E6E78", badge: "bg-[#F1F1F3] text-[#3F3F46] border-[#E0E0E4]" },
  approved: { label: "Approved", color: "#D85B83", badge: "bg-[#FCEAF0] text-[#B83E68] border-[#F1B8C8]" },
  delivered: { label: "Delivered", color: "#1E1E22", badge: "bg-[#111111] text-white border-[#111111]" },
  rejected: { label: "Rejected", color: "#D64545", badge: "bg-red-50 text-red-700 border-red-200" },
};
