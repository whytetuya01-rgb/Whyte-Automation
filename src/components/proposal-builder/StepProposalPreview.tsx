"use client";

import { useState, useRef, useMemo } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Printer,
  Download,
  Share2,
  ArrowLeft,
  Check,
  ShieldCheck,
  Sliders,
  Award,
  Phone,
  Mail,
  Globe,
} from "lucide-react";
import { Quotation, QuotationRoom, QuotationItem, Company } from "@/types";
import { formatCurrency, formatDate, getRoomIcon } from "@/lib/utils";
import { getRoomFullTitle } from "@/lib/roomUtils";
import WhyteLogo from "@/components/shared/WhyteLogo";
import { calculateQuotationGst } from "@/lib/pricing";

interface Props {
  quotation: Quotation;
  company?: Company | null;
  onBackToEdit?: () => void;
}

export interface ProposalPageSlice {
  pageNumber: number;
  totalPages: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  sections: Array<
    | { type: "cover" }
    | { type: "about_whyte" }
    | { type: "project_overview_and_scope" }
    | {
      type: "room";
      room: QuotationRoom;
      roomIndex: number;
      items: QuotationItem[];
      isContinuation: boolean;
      showRoomHeader: boolean;
      showRoomFooter: boolean;
    }
    | { type: "closing_and_financials" }
  >;
}

export function getItemTier(
  item: QuotationItem,
  quotation: Quotation
): string | null {
  return (
    item.variantConfig?.tier ||
    item.variantConfig?.automationTier ||
    item.variantConfig?.series ||
    item.productVariant?.automationTier ||
    item.product?.automationTier ||
    quotation.defaultTier ||
    null
  );
}

export function getItemFinish(
  item: QuotationItem,
  quotation: Quotation
): string | null {
  return (
    item.variantConfig?.finish ||
    item.variantConfig?.surfaceFinish ||
    item.productVariant?.surfaceFinish ||
    item.product?.surfaceFinish ||
    quotation.defaultFinish ||
    null
  );
}

/**
 * Safe filter for rooms that have at least one allocated device with quantity > 0.
 * Completely excludes rooms with 0 allocated devices, empty arrays, or quantity 0.
 */
export function getRenderableProposalRooms(
  rooms: QuotationRoom[] | null | undefined
): QuotationRoom[] {
  if (!rooms || !Array.isArray(rooms)) return [];

  return rooms
    .filter((room): room is QuotationRoom => {
      if (!room || typeof room !== "object") return false;
      const items = room.items;
      if (!Array.isArray(items) || items.length === 0) return false;
      return items.some((item) => {
        if (!item || typeof item !== "object") return false;
        const qty = Number(item.quantity);
        return !isNaN(qty) && qty > 0;
      });
    })
    .map((room) => ({
      ...room,
      items: (room.items || []).filter((item) => {
        if (!item || typeof item !== "object") return false;
        const qty = Number(item.quantity);
        return !isNaN(qty) && qty > 0;
      }),
    }));
}

/**
 * Deterministic multi-page pagination algorithm for architectural Whyte proposals.
 * Generates an executive cover (P1), About Whyte (P2), Project & Scope (P3),
 * followed by compact room breakdowns with individual installation locations,
 * and concluding with the financial summary, terms, and Whyte contact info.
 */
function paginateQuotation(quotation: Quotation): ProposalPageSlice[] {
  const rooms = getRenderableProposalRooms(quotation.rooms);
  const pages: ProposalPageSlice[] = [];

  // Usable vertical point budget for standard A4 page (height 1123px)
  const PAGE_CAPACITY = 940;
  const FOOTER_RESERVE = 55;
  const RUNNING_HEADER = 55;

  const getCapacity = () => PAGE_CAPACITY - RUNNING_HEADER - FOOTER_RESERVE;

  // PAGE 1: Dedicated Executive Cover
  pages.push({
    pageNumber: 1,
    totalPages: 0,
    isFirstPage: true,
    isLastPage: false,
    sections: [{ type: "cover" }],
  });

  // PAGE 2: About Whyte & Premise Solutions
  pages.push({
    pageNumber: 2,
    totalPages: 0,
    isFirstPage: false,
    isLastPage: false,
    sections: [{ type: "about_whyte" }],
  });

  // PAGE 3: Your Project Overview & Tactus Feature Highlights
  pages.push({
    pageNumber: 3,
    totalPages: 0,
    isFirstPage: false,
    isLastPage: false,
    sections: [{ type: "project_overview_and_scope" }],
  });

  let currentPage = 4;
  let currentSections: ProposalPageSlice["sections"] = [];
  let currentHeight = 0;

  // Process room-wise breakdown starting on Page 4 (only rooms with valid allocated devices)
  for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
    const room = rooms[rIdx];
    const items = room.items || [];
    const itemsLeft = [...items];
    let isFirstSlice = true;

    // Skip empty rooms safely - no slice, no header, no placeholder
    if (itemsLeft.length === 0) {
      continue;
    }

    // Process items of this room
    while (itemsLeft.length > 0) {
      const headerH = isFirstSlice ? 44 + 30 : 30;
      const minItemH = itemsLeft[0]?.notes ? 48 : 38;

      if (currentHeight + headerH + minItemH > getCapacity()) {
        pages.push({
          pageNumber: currentPage,
          totalPages: 0,
          isFirstPage: false,
          isLastPage: false,
          sections: currentSections,
        });
        currentPage++;
        currentSections = [];
        currentHeight = 0;
      }

      const sliceItems: QuotationItem[] = [];
      let sliceH = headerH;

      while (itemsLeft.length > 0) {
        const item = itemsLeft[0];
        const itemH = item.notes ? 48 : 38;
        if (currentHeight + sliceH + itemH > getCapacity()) {
          break;
        }
        sliceItems.push(item);
        sliceH += itemH;
        itemsLeft.shift();
      }

      const isLastSlice = itemsLeft.length === 0;
      if (isLastSlice) {
        sliceH += 34; // Room subtotal banner
      }

      currentSections.push({
        type: "room",
        room,
        roomIndex: rIdx,
        items: sliceItems,
        isContinuation: !isFirstSlice,
        showRoomHeader: isFirstSlice,
        showRoomFooter: isLastSlice,
      });

      currentHeight += sliceH;
      isFirstSlice = false;
    }
  }

  // Financial Summary, Terms, Next Steps & Official Whyte Closing
  const closingEstimateH = 490;
  if (currentHeight + closingEstimateH > getCapacity()) {
    pages.push({
      pageNumber: currentPage,
      totalPages: 0,
      isFirstPage: false,
      isLastPage: false,
      sections: currentSections,
    });
    currentPage++;
    currentSections = [];
    currentHeight = 0;
  }

  currentSections.push({ type: "closing_and_financials" });
  pages.push({
    pageNumber: currentPage,
    totalPages: 0,
    isFirstPage: false,
    isLastPage: true,
    sections: currentSections,
  });

  const totalPages = pages.length;
  pages.forEach((p) => {
    p.totalPages = totalPages;
  });

  return pages;
}

export default function StepProposalPreview({
  quotation,
  company,
  onBackToEdit,
}: Props) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  const rawRooms = useMemo(() => quotation.rooms || [], [quotation.rooms]);
  const renderableRooms = useMemo(
    () => getRenderableProposalRooms(rawRooms),
    [rawRooms]
  );

  // Totals calculations - single source of truth from records
  const subtotal = useMemo(() => {
    return rawRooms.reduce((sum, r) => {
      return (
        sum +
        (r.items || []).reduce(
          (acc, i) => acc + Number(i.unitPrice || 0) * (i.quantity || 1),
          0
        )
      );
    }, 0);
  }, [rawRooms]);

  const totalProducts = useMemo(() => {
    return renderableRooms.reduce((sum, r) => {
      return sum + (r.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
    }, 0);
  }, [renderableRooms]);

  const hasDiscount = Boolean(
    quotation.discountType && Number(quotation.discountValue) > 0
  );

  const discountAmount = useMemo(() => {
    if (quotation.discountType === "percentage") {
      return (subtotal * Number(quotation.discountValue ?? 0)) / 100;
    }
    if (quotation.discountType === "fixed") {
      return Number(quotation.discountValue ?? 0);
    }
    return 0;
  }, [quotation.discountType, quotation.discountValue, subtotal]);

  // Authoritative GST calculation matching Review & Normalization
  const gstCalculations = useMemo(() => {
    return calculateQuotationGst(subtotal, discountAmount);
  }, [subtotal, discountAmount]);

  const {
    grossSubtotal,
    discountAmount: clampedDiscount,
    netSubtotal,
    cgstAmount,
    sgstAmount,
    grandTotal,
  } = gstCalculations;

  // Extracted tiers and finishes present in proposal (from allocated products)
  const configuredTiers = useMemo(() => {
    const set = new Set<string>();
    if (quotation.defaultTier) set.add(quotation.defaultTier);
    renderableRooms.forEach((r) => {
      (r.items || []).forEach((i) => {
        const t = getItemTier(i, quotation);
        if (t) set.add(t);
      });
    });
    return Array.from(set);
  }, [renderableRooms, quotation]);

  const configuredFinishes = useMemo(() => {
    const set = new Set<string>();
    if (quotation.defaultFinish) set.add(quotation.defaultFinish);
    renderableRooms.forEach((r) => {
      (r.items || []).forEach((i) => {
        const f = getItemFinish(i, quotation);
        if (f) set.add(f);
      });
    });
    return Array.from(set);
  }, [renderableRooms, quotation]);

  // Paginated proposal pages
  const proposalPages = useMemo(() => {
    return paginateQuotation(quotation);
  }, [quotation]);

  // High-Resolution Multi-Page PDF Generation using Cached Local Assets
  const handleDownloadPDF = async () => {
    if (!quotation || pageRefs.current.length === 0) return;
    setDownloading(true);

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const [{ default: jsPDF }, htmlToImage] = await Promise.all([
        import("jspdf"),
        import("html-to-image"),
      ]);

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      for (let i = 0; i < pageRefs.current.length; i++) {
        const pageEl = pageRefs.current[i];
        if (!pageEl) continue;

        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }

        const dataUrl = await htmlToImage.toPng(pageEl, {
          pixelRatio: 2,
          backgroundColor: "#ffffff",
          cacheBust: true,
        });

        pdf.addImage(dataUrl, "PNG", 0, 0, 210, 297, undefined, "FAST");
      }

      const filename = `${quotation.quotationNumber || "Proposal"}_Whyte_Automation.pdf`;
      pdf.save(filename);
      toast.success("Proposal PDF downloaded!");
      markQuotationSent();
    } catch (err: any) {
      console.error("PDF generation failed:", err);
      toast.error(
        "Failed to generate PDF. You can also use the Print button to Save as PDF."
      );
    } finally {
      setDownloading(false);
    }
  };

  const markQuotationSent = async () => {
    if (!quotation?.id) return;
    try {
      await fetch(`/api/quotations/${quotation.id}/mark-sent`, { method: "POST" });
    } catch (err) {
      console.warn("Failed to mark quotation as sent:", err);
    }
  };

  const handlePrint = () => {
    markQuotationSent();
    window.print();
  };

  const handleShare = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success("Proposal link copied to clipboard!");
      markQuotationSent();
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="w-full">
      {/* Top Header & Action Bar (Hidden in Print) */}
      <div className="flex items-center justify-between gap-4 pb-4 mb-8 border-b border-gray-200 print:hidden">
        <div>
          {onBackToEdit ? (
            <button
              type="button"
              onClick={onBackToEdit}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs"
            >
              <ArrowLeft size={14} />
              <span>Back to Review</span>
            </button>
          ) : (
            <Link
              href={`/quotation/${quotation.id}?step=4`}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs"
            >
              <ArrowLeft size={14} />
              <span>Back to Review</span>
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs"
          >
            {copied ? (
              <Check size={14} className="text-emerald-600" />
            ) : (
              <Share2 size={14} />
            )}
            <span className="hidden sm:inline">
              {copied ? "Copied" : "Share"}
            </span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            disabled={renderableRooms.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs disabled:opacity-50"
          >
            <Printer size={14} />
            <span className="hidden sm:inline">Print / Save as PDF</span>
            <span className="sm:hidden">Print</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPDF}
            disabled={downloading || renderableRooms.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-gray-950 rounded-xl hover:bg-gray-800 transition active:scale-[0.99] shadow-sm disabled:opacity-50"
          >
            <Download size={14} />
            <span>{downloading ? "Building PDF..." : "Download PDF"}</span>
          </button>
        </div>
      </div>

      {/* Main Centered A4 Document Canvas */}
      {renderableRooms.length === 0 ? (
        <div className="bg-white max-w-xl mx-auto rounded-2xl border border-gray-200 p-12 text-center text-gray-400 space-y-3">
          <ShieldCheck size={36} className="mx-auto text-gray-300" />
          <h3 className="text-base font-bold text-gray-900">
            No Spaces in Quotation
          </h3>
          <p className="text-xs text-gray-500">
            Please add spaces and smart devices before viewing or exporting the
            client proposal.
          </p>
          {onBackToEdit && (
            <button
              type="button"
              onClick={onBackToEdit}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-950 text-white text-xs font-semibold rounded-xl hover:bg-gray-800 transition mt-2"
            >
              <ArrowLeft size={14} />
              <span>Back to Review</span>
            </button>
          )}
        </div>
      ) : (
        <div className="w-full flex flex-col items-center">
          {proposalPages.map((page, pageIdx) => (
            <div
              key={page.pageNumber}
              ref={(el) => {
                pageRefs.current[pageIdx] = el;
              }}
              className="proposal-page bg-white w-full max-w-[794px] min-h-[1123px] rounded-xl border border-gray-200 shadow-md p-8 sm:p-12 mb-8 flex flex-col justify-between relative print:shadow-none print:border-none print:rounded-none print:m-0 print:p-8"
              style={{ boxSizing: "border-box" }}
            >
              {/* Page Content Area */}
              <div className="space-y-6">
                {/* Running Header on Page 2+ */}
                {!page.isFirstPage && (
                  <div className="pb-3 border-b border-gray-200 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5">
                      <WhyteLogo
                        theme="light"
                        alt="WHYTE"
                        size="document-header"
                        style={{ height: "18px", maxWidth: "80px", width: "auto" }}
                        unoptimized
                        loading="eager"
                      />
                      <span className="text-gray-300">|</span>
                      <span className="font-semibold text-gray-700 text-xs">
                        Smart Living Ecosystems
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-500 font-mono text-[11px]">
                      <span>{quotation.quotationNumber}</span>
                      <span>•</span>
                      <span className="text-gray-950 font-bold">
                        {quotation.clientName}
                      </span>
                    </div>
                  </div>
                )}

                {/* Render Page Sections */}
                {page.sections.map((section, sIdx) => {
                  /* 1. COVER (PAGE 1) */
                  if (section.type === "cover") {
                    return (
                      <div key={sIdx} className="space-y-6">
                        {/* Header Brand Bar - Space Efficient & Aligned */}
                        <div className="flex items-center justify-between pb-3 sm:pb-3.5 border-b border-gray-200">
                          <div>
                            <WhyteLogo
                              theme="light"
                              alt="WHYTE Automations"
                              size="document-cover"
                              style={{ height: "24px", maxWidth: "105px", width: "auto" }}
                              unoptimized
                              loading="eager"
                            />
                            <p className="text-[10px] uppercase tracking-widest text-accent font-bold mt-1">
                              Next-Gen Smart Living Ecosystems
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] font-mono tracking-widest text-gray-400 uppercase font-bold block">
                              Quotation Reference
                            </span>
                            <p className="text-base sm:text-lg font-black font-mono tracking-tight text-gray-950">
                              {quotation.quotationNumber}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatDate(quotation.createdAt)}
                            </p>
                          </div>
                        </div>

                        {/* Title Block */}
                        <div className="space-y-1.5 pt-2">
                          <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                            Bespoke Intelligent Architecture
                          </span>
                          <h1 className="text-3xl sm:text-4xl font-black text-gray-950 tracking-tight">
                            SMART AUTOMATION PROPOSAL
                          </h1>
                          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed max-w-xl">
                            Thank you for considering Whyte for your smart
                            automation requirements. This proposal outlines the
                            recommended automation products, spaces,
                            configuration, and estimated investment for your
                            project.
                          </p>
                        </div>

                        {/* Official Hero Image */}
                        <div className="w-full h-52 sm:h-64 rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 relative shadow-xs">
                          <img
                            src="/proposal/whyte/hero-touch.webp"
                            alt="Whyte Smart Living"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-5">
                            <p className="text-white text-xs sm:text-sm font-semibold tracking-wide">
                              Feather-Touch Switching • Wireless Smart
                              Control • Luxury Architectural Living
                            </p>
                          </div>
                        </div>

                        {/* Project Reference Card */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-gray-50/80 border border-gray-200 text-xs">
                          <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                              Client
                            </p>
                            <p className="font-bold text-gray-950 mt-0.5 truncate">
                              {quotation.clientName}
                            </p>
                            {quotation.clientPhone && (
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                {quotation.clientPhone}
                              </p>
                            )}
                          </div>

                          <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                              Project Location
                            </p>
                            <p className="font-semibold text-gray-900 mt-0.5 line-clamp-2">
                              {quotation.clientAddress || "Site Location"}
                            </p>
                          </div>

                          <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                              Project Type
                            </p>
                            <p className="font-semibold text-gray-900 mt-0.5">
                              {quotation.houseType?.name ??
                                "Residential Smart Home"}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              Custom Automation
                            </p>
                          </div>

                          <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                              Total Investment
                            </p>
                            <p className="font-black font-mono text-gray-950 text-sm mt-0.5">
                              {formatCurrency(grandTotal, { decimals: 2 })}
                            </p>
                            <p className="text-[10px] text-gray-500">
                              {renderableRooms.length} Spaces • {totalProducts} Devices
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  /* 2. ABOUT WHYTE (PAGE 2) */
                  if (section.type === "about_whyte") {
                    return (
                      <div key={sIdx} className="space-y-6">
                        {/* Section Header */}
                        <div>
                          <span className="text-[10px] uppercase tracking-widest text-accent font-bold block">
                            Company Profile & Ecosystem
                          </span>
                          <h2 className="text-2xl font-black text-gray-950 tracking-tight mt-0.5">
                            About Whyte Automations
                          </h2>
                          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                            Founded in Gandhinagar, Gujarat, Whyte Automations is
                            dedicated to bringing the next generation of smart
                            living to modern premises through the Internet of
                            Things, intuitive touch architecture, and intelligent
                            power management.
                          </p>
                        </div>

                        {/* Proven Milestone Statistics (Official Website Figures) */}
                        <div className="grid grid-cols-5 gap-2 p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-center">
                          <div>
                            <p className="text-xl sm:text-2xl font-black font-mono text-gray-950">
                              250+
                            </p>
                            <p className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">
                              Installations
                            </p>
                          </div>
                          <div>
                            <p className="text-xl sm:text-2xl font-black font-mono text-gray-950">
                              20,000+
                            </p>
                            <p className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">
                              Switches
                            </p>
                          </div>
                          <div>
                            <p className="text-xl sm:text-2xl font-black font-mono text-gray-950">
                              35+
                            </p>
                            <p className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">
                              Products
                            </p>
                          </div>
                          <div>
                            <p className="text-xl sm:text-2xl font-black font-mono text-gray-950">
                              25+
                            </p>
                            <p className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">
                              Features
                            </p>
                          </div>
                          <div>
                            <p className="text-xl sm:text-2xl font-black font-mono text-gray-950">
                              10+
                            </p>
                            <p className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">
                              Cities
                            </p>
                          </div>
                        </div>

                        {/* Bespoke Premise Solutions */}
                        <div className="space-y-2.5">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-950">
                            Bespoke Automation Solutions
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                              <div className="h-20 bg-gray-100 overflow-hidden">
                                <img
                                  src="/proposal/whyte/solutions/img-home.jpg"
                                  alt="Home Automation"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="p-2">
                                <p className="font-bold text-gray-950 text-xs">
                                  Home
                                </p>
                                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                                  Feather-touch & scene automation.
                                </p>
                              </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                              <div className="h-20 bg-gray-100 overflow-hidden">
                                <img
                                  src="/proposal/whyte/solutions/img-office.jpg"
                                  alt="Office Automation"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="p-2">
                                <p className="font-bold text-gray-950 text-xs">
                                  Office
                                </p>
                                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                                  Meeting & energy automation.
                                </p>
                              </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                              <div className="h-20 bg-gray-100 overflow-hidden">
                                <img
                                  src="/proposal/whyte/solutions/img-hotel.jpg"
                                  alt="Hotel Automation"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="p-2">
                                <p className="font-bold text-gray-950 text-xs">
                                  Hotels
                                </p>
                                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                                  Guest bedside touch panels.
                                </p>
                              </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                              <div className="h-20 bg-gray-100 overflow-hidden">
                                <img
                                  src="/proposal/whyte/solutions/img-hospital.jpg"
                                  alt="Hospital Automation"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="p-2">
                                <p className="font-bold text-gray-950 text-xs">
                                  Hospitals
                                </p>
                                <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                                  Hygienic touch interfaces.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Why Whyte: Engineering & Guarantees */}
                        <div className="space-y-2.5">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-950">
                            Why Whyte
                          </h3>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-1">
                              <div className="flex items-center gap-1.5 font-bold text-gray-950">
                                <ShieldCheck size={14} className="text-gray-950" />
                                <span>5* Years Limited Warranty</span>
                              </div>
                              <p className="text-[11px] text-gray-500 leading-relaxed">
                                Backed by Whyte comprehensive hardware warranty
                                and dedicated support for long-term reliability.
                              </p>
                            </div>

                            <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-1">
                              <div className="flex items-center gap-1.5 font-bold text-gray-950">
                                <Sliders size={14} className="text-gray-950" />
                                <span>Modular & 100% Retrofit</span>
                              </div>
                              <p className="text-[11px] text-gray-500 leading-relaxed">
                                Direct drop-in replacement compatible with
                                standard concealed metal boxes with zero civil
                                rewiring.
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Government & Industry Backing */}
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs text-gray-600">
                          <div className="flex items-center gap-2">
                            <Award size={15} className="text-gray-950" />
                            <span className="font-semibold text-gray-900">
                              Backed by Startup Gujarat (Govt. of Gujarat – 2021)
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-500">
                            VSTS Startup Arena Winner
                          </span>
                        </div>
                      </div>
                    );
                  }

                  /* 3. YOUR PROJECT OVERVIEW & TACTUS TECH (PAGE 3) */
                  if (section.type === "project_overview_and_scope") {
                    return (
                      <div key={sIdx} className="space-y-6">
                        {/* Section Header */}
                        <div>
                          <span className="text-[10px] uppercase tracking-widest text-accent font-bold block">
                            Specification & Scope
                          </span>
                          <h2 className="text-2xl font-black text-gray-950 tracking-tight mt-0.5">
                            Your Project Overview
                          </h2>
                          <p className="text-xs text-gray-600 mt-0.5">
                            Tailored smart automation configuration designed for{" "}
                            <strong className="text-gray-950">
                              {quotation.clientName}
                            </strong>
                            .
                          </p>
                        </div>

                        {/* Selected Automated Spaces */}
                        <div className="space-y-2.5">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-950">
                            Configured Spaces ({renderableRooms.length}{" "}
                            {renderableRooms.length === 1 ? "Space" : "Spaces"})
                          </h3>
                          {renderableRooms.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {renderableRooms.map((r: QuotationRoom) => {
                                const roomId = Number(r.id ?? (r as any)._id);
                                const Icon = getRoomIcon(
                                  r.customName ?? r.roomType?.name ?? "Room"
                                );
                                const count = (r.items || []).reduce(
                                  (acc: number, i: QuotationItem) => acc + (Number(i.quantity) || 1),
                                  0
                                );
                                return (
                                  <div
                                    key={roomId}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs"
                                  >
                                    <Icon size={13} className="text-accent" />
                                    <span className="font-semibold text-gray-900">
                                      {getRoomFullTitle(r, renderableRooms)}
                                    </span>
                                    <span className="font-mono text-[10px] bg-accent-light text-accent-foreground border border-accent-border/60 px-1.5 py-0.5 rounded font-bold">
                                      {count} {count === 1 ? "device" : "devices"}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-400 italic">
                              No spaces configured with active products
                            </div>
                          )}
                        </div>

                        {/* Automation Scope */}
                        <div className="space-y-2 pt-1">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-950">
                            Automation Scope
                          </h3>
                          <div className="p-4 rounded-xl bg-gray-50/70 border border-gray-200 text-xs space-y-1.5 text-gray-700">
                            <p className="flex items-center gap-2 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                              <span>
                                Smart switching and touch control automation
                                across all designated living spaces.
                              </span>
                            </p>
                            <p className="flex items-center gap-2 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                              <span>
                                Individual room-wise product specification and
                                quantity mapping ({renderableRooms.length} automated
                                spaces).
                              </span>
                            </p>
                            {configuredTiers.length > 0 && (
                              <p className="flex items-center gap-2 font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                                <span>
                                  Specified Automation Tier:{" "}
                                  <strong className="text-accent-foreground bg-accent-light px-1.5 py-0.5 rounded border border-accent-border/60 capitalize text-[11px]">
                                    {configuredTiers.join(", ")}
                                  </strong>
                                </span>
                              </p>
                            )}
                            {configuredFinishes.length > 0 && (
                              <p className="flex items-center gap-2 font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                                <span>
                                  Specified Surface Finish:{" "}
                                  <strong className="text-accent-foreground bg-accent-light px-1.5 py-0.5 rounded border border-accent-border/60 capitalize text-[11px]">
                                    {configuredFinishes.join(", ")}
                                  </strong>
                                </span>
                              </p>
                            )}
                            <p className="flex items-center gap-2 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                              <span>
                                Product-specific installation location references
                                recorded for on-site implementation.
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Official Whyte Tactus Features (from whyte.co.in/touch-switch) */}
                        <div className="space-y-2.5 pt-1">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-950">
                            Whyte Tactus Touch Series Technology
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-xs">
                                Dual Intensity Light
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug">
                                Visual feedback indication showing active ON/OFF
                                state.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-xs">
                                Night Recognizable
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug">
                                Soft dim ambient glow makes switches easy to
                                locate in the dark.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-xs">
                                Voice Automation Ready
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug">
                                Full compatibility with Amazon Alexa and Google
                                Assistant.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-xs">
                                Sleep & Child Lock
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug">
                                Built-in safety and uninterrupted sleep mode
                                settings.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-xs">
                                Shock & Splash Proof
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug">
                                Toughened glass design provides optimal safety in
                                all spaces.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-xs">
                                Two-Way Switching
                              </p>
                              <p className="text-[10px] text-gray-500 leading-snug">
                                Convenient provision for multi-point staircase and
                                bedside control.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  /* 4. ROOM-WISE PRODUCT BREAKDOWN (COMPACT CLEANUP) */
                  if (section.type === "room") {
                    const {
                      room,
                      items,
                      isContinuation,
                      showRoomHeader,
                      showRoomFooter,
                    } = section;
                    const Icon = getRoomIcon(
                      room.customName ?? room.roomType?.name ?? "Room"
                    );
                    const roomSubtotal = (room.items || []).reduce(
                      (acc, i) =>
                        acc + Number(i.unitPrice || 0) * (i.quantity || 1),
                      0
                    );

                    return (
                      <div key={sIdx} className="space-y-2">
                        {/* Room Header Banner */}
                        {showRoomHeader && (
                          <div className="bg-gray-50 px-4 py-2.5 rounded-t-xl border border-gray-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon size={14} className="text-accent" />
                              <h3 className="font-extrabold text-gray-950 text-xs sm:text-sm uppercase tracking-wider">
                                {getRoomFullTitle(room, renderableRooms)}
                              </h3>
                              <span className="text-[10px] font-mono text-accent-foreground bg-accent-light px-2 py-0.5 rounded border border-accent-border/60">
                                {(room.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0)}{" "}
                                {(room.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0) === 1
                                  ? "device"
                                  : "devices"}
                              </span>
                            </div>
                            <span className="font-mono font-bold text-xs sm:text-sm text-gray-950">
                              Subtotal: {formatCurrency(roomSubtotal)}
                            </span>
                          </div>
                        )}

                        {/* Room Continuation */}
                        {isContinuation && (
                          <div className="bg-gray-50/80 px-4 py-1.5 rounded-t-xl border border-gray-200 text-xs font-semibold text-gray-700 flex items-center justify-between">
                            <span>
                              {getRoomFullTitle(room, renderableRooms)}{" "}
                              (Continued)
                            </span>
                            <span className="font-mono text-[11px] text-gray-500">
                              Subtotal: {formatCurrency(roomSubtotal)}
                            </span>
                          </div>
                        )}

                        {/* Room Notes (if any) */}
                        {showRoomHeader && room.notes && (
                          <div className="px-4 py-1.5 bg-amber-50/50 border-x border-b border-amber-100 text-[11px] text-amber-900">
                            <span className="font-semibold">Space Note: </span>
                            {room.notes}
                          </div>
                        )}

                        {/* Compact Product Table: Product Name | Qty | Unit Price (No image, No Total column) */}
                        {items.length > 0 && (
                          <div
                            className={`border border-gray-200 overflow-hidden ${showRoomFooter ? "rounded-b-none" : "rounded-b-xl"
                              }`}
                          >
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-gray-50/80 border-b border-gray-200 text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                                  <th className="py-2.5 px-4">Product Name</th>
                                  <th className="py-2.5 px-4 w-20 text-center">
                                    Qty
                                  </th>
                                  <th className="py-2.5 px-4 w-28 text-right">
                                    Unit Price
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {items.map((item, itemIdx) => {
                                  const unitPrice = Number(item.unitPrice || 0);

                                  return (
                                    <tr
                                      key={item.id || itemIdx}
                                      className="hover:bg-gray-50/40 transition-colors"
                                    >
                                      {/* Product Name & Exact Installation Location */}
                                      <td className="py-2.5 px-4">
                                        <p className="font-bold text-gray-950 text-xs sm:text-sm leading-snug">
                                          {item.product?.name ?? "Product"}
                                        </p>

                                        {item.notes && item.notes.trim() ? (
                                          <div className="mt-1 text-[11px] text-gray-600 leading-normal">
                                            <span className="text-gray-400 font-medium">
                                              Installation Location:{" "}
                                            </span>
                                            <span className="text-gray-900 font-medium">
                                              {item.notes}
                                            </span>
                                          </div>
                                        ) : (
                                          <p className="text-[11px] text-gray-400 italic mt-0.5">
                                            Installation location not specified
                                          </p>
                                        )}
                                      </td>

                                      {/* Qty */}
                                      <td className="py-2.5 px-4 text-center font-mono font-bold text-gray-900 text-xs sm:text-sm align-top">
                                        {item.quantity || 1}
                                      </td>

                                      {/* Unit Price */}
                                      <td className="py-2.5 px-4 text-right font-mono text-gray-700 text-xs sm:text-sm align-top">
                                        {formatCurrency(unitPrice)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Room Subtotal Banner */}
                        {showRoomFooter && items.length > 0 && (
                          <div className="flex justify-between items-center px-4 py-2 bg-gray-50/70 border-x border-b border-gray-200 rounded-b-xl text-xs font-semibold text-gray-800">
                            <span>
                              {room.customName ?? room.roomType?.name} Subtotal
                            </span>
                            <span className="font-mono font-bold text-gray-950">
                              {formatCurrency(roomSubtotal)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  }

                  /* 5. FINANCIAL SUMMARY, INVESTMENT CALLOUT, TERMS & OFFICIAL WHYTE CLOSING */
                  if (section.type === "closing_and_financials") {
                    return (
                      <div key={sIdx} className="space-y-4 pt-2">
                        {/* Financial Summary */}
                        <div className="space-y-2">
                          <div className="pb-1 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-gray-950">
                              Financial Summary
                            </h3>
                            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                              Investment Overview
                            </span>
                          </div>

                          <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2.5 text-xs">
                            {/* Subtotal */}
                            <div className="flex justify-between items-center text-gray-600">
                              <span className="font-medium text-gray-600">Subtotal</span>
                              <span className="font-mono font-medium text-gray-900">
                                {formatCurrency(grossSubtotal, { decimals: 2 })}
                              </span>
                            </div>

                            {/* Discount */}
                            <div className="flex justify-between items-center text-gray-600">
                              <span className="flex items-center gap-1.5 font-medium text-gray-600">
                                <span>Discount</span>
                                {hasDiscount && quotation.discountType === "percentage" && (
                                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                    {quotation.discountValue}%
                                  </span>
                                )}
                              </span>
                              <span className={`font-mono font-medium ${clampedDiscount > 0 ? "text-emerald-600" : "text-gray-900"}`}>
                                {clampedDiscount > 0
                                  ? `-${formatCurrency(clampedDiscount, { decimals: 2 })}`
                                  : formatCurrency(0, { decimals: 2 })}
                              </span>
                            </div>

                            {/* Net Subtotal */}
                            <div className="pt-2 border-t border-gray-200/80 flex justify-between items-baseline py-0.5">
                              <div>
                                <span className="font-bold text-gray-950 block text-xs sm:text-sm">Net Subtotal</span>
                                <span className="text-[10px] text-gray-400 font-medium">Taxable amount after discount</span>
                              </div>
                              <span className="font-mono font-bold text-gray-950 text-sm sm:text-base">
                                {formatCurrency(netSubtotal, { decimals: 2 })}
                              </span>
                            </div>

                            {/* Tax Summary Box */}
                            <div className="p-3 rounded-lg bg-white border border-gray-200/80 space-y-1.5">
                              <div className="flex items-center justify-between pb-1 border-b border-gray-100">
                                <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                                  Tax Summary
                                </span>
                                <span className="text-[10px] font-mono font-bold text-accent px-1.5 py-0.5 rounded bg-accent/5 border border-accent/20">
                                  GST
                                </span>
                              </div>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between items-center text-gray-600">
                                  {/* <span className="text-gray-700 font-medium">CGST @ 9%</span> */}
                                  <span className="text-gray-700 font-medium">CGST</span>
                                  <span className="font-mono font-semibold text-gray-900">
                                    {formatCurrency(cgstAmount, { decimals: 2 })}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center text-gray-600">
                                  {/* <span className="text-gray-700 font-medium">SGST/UTGST @ 9%</span> */}
                                  <span className="text-gray-700 font-medium">SGST/UTGST</span>
                                  <span className="font-mono font-semibold text-gray-900">
                                    {formatCurrency(sgstAmount, { decimals: 2 })}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Grand Total */}
                            <div className="pt-2.5 border-t-2 border-gray-950/20 flex justify-between items-baseline">
                              <div>
                                <span className="text-sm font-black uppercase tracking-wider text-gray-950 block">
                                  Grand Total
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  Total Investment (Incl. Taxes)
                                </span>
                              </div>
                              <span className="text-2xl font-black font-mono text-gray-950 tracking-tight">
                                {formatCurrency(grandTotal, { decimals: 2 })}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Final Investment Callout */}
                        <div className="p-4 rounded-xl border border-accent-border/80 bg-accent-light/30 text-center space-y-1">
                          <p className="text-[10px] uppercase font-bold tracking-widest text-accent">
                            ESTIMATED PROJECT INVESTMENT
                          </p>
                          <p className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-gray-950">
                            {formatCurrency(grandTotal, { decimals: 2 })}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            Final pricing is based on the products and configuration selected in this proposal.
                          </p>
                        </div>

                        {/* Proposal Includes & Commercial Information */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          {/* Proposal Includes */}
                          <div className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-1.5">
                            <h4 className="font-bold uppercase tracking-wider text-gray-900 text-[10px]">
                              Proposal Includes
                            </h4>
                            <ul className="space-y-1 text-[11px] text-gray-600">
                              <li>• Selected smart automation products</li>
                              <li>• Room-wise space configuration & mapping</li>
                              {configuredTiers.length > 0 && (
                                <li>
                                  • Selected automation tier:{" "}
                                  {configuredTiers.join(", ")}
                                </li>
                              )}
                              {configuredFinishes.length > 0 && (
                                <li>
                                  • Selected surface finish:{" "}
                                  {configuredFinishes.join(", ")}
                                </li>
                              )}
                              <li>
                                • Product-specific installation location references
                              </li>
                              <li>
                                • Project-wise pricing and investment breakdown
                              </li>
                            </ul>
                          </div>

                          {/* Commercial Terms & Validity */}
                          <div className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-1.5">
                            <h4 className="font-bold uppercase tracking-wider text-gray-900 text-[10px]">
                              Commercial Terms & Validity
                            </h4>
                            <div className="space-y-1 text-[11px] text-gray-600">
                              <p>
                                <strong className="text-gray-900">
                                  Validity:{" "}
                                </strong>
                                {quotation.validUntil
                                  ? `Valid until ${formatDate(
                                    quotation.validUntil
                                  )}`
                                  : "Valid for 30 days from date of issue."}
                              </p>
                              {quotation.terms && (
                                <p>
                                  <strong className="text-gray-900">
                                    Terms:{" "}
                                  </strong>
                                  {quotation.terms}
                                </p>
                              )}
                              {quotation.notes && (
                                <p>
                                  <strong className="text-gray-900">
                                    Remarks:{" "}
                                  </strong>
                                  {quotation.notes}
                                </p>
                              )}
                              {quotation.clientGstNumber && (
                                <p className="font-mono">
                                  <strong className="text-gray-900">
                                    Client GST:{" "}
                                  </strong>
                                  {quotation.clientGstNumber}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Next Steps */}
                        <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 space-y-1.5">
                          <h4 className="font-bold uppercase tracking-wider text-gray-950 text-[10px]">
                            Next Steps
                          </h4>
                          <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-gray-700">
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-xs">
                                1. Review
                              </span>
                              Review the proposed automation configuration.
                            </li>
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-xs">
                                2. Confirm
                              </span>
                              Confirm product selection and quantities.
                            </li>
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-xs">
                                3. Align
                              </span>
                              Confirm on-site installation requirements.
                            </li>
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-xs">
                                4. Proceed
                              </span>
                              Proceed with final order & commissioning.
                            </li>
                          </ol>
                        </div>

                        {/* Official Whyte Closing & Contact Card */}
                        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                          <div className="space-y-1">
                            <WhyteLogo
                              theme="light"
                              alt="Whyte Automations"
                              size="document-footer"
                              unoptimized
                              loading="eager"
                            />
                            <p className="font-bold text-gray-950">
                              Whyte Automations Private Limited
                            </p>
                            <p className="text-[11px] text-gray-500">
                              Gandhinagar, Gujarat, India • Next-Gen Smart Living
                            </p>
                          </div>
                          <div className="space-y-1 text-right sm:text-right font-medium text-[11px] text-gray-600">
                            <p className="flex items-center gap-1.5 sm:justify-end">
                              <Phone size={11} className="text-gray-400" />
                              <span>+91 98982 34336 / +91 98989 26336</span>
                            </p>
                            <p className="flex items-center gap-1.5 sm:justify-end">
                              <Mail size={11} className="text-gray-400" />
                              <span>sales@whyte.co.in</span>
                            </p>
                            <p className="flex items-center gap-1.5 sm:justify-end">
                              <Globe size={11} className="text-gray-400" />
                              <span>https://whyte.co.in/</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>

              {/* Document Footer on Every Page */}
              <div className="pt-4 mt-6 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[10px] text-gray-400 font-medium">
                <div>
                  <span className="font-bold text-gray-700">
                    {company?.name || "WHYTE Automations"}
                  </span>
                  <span>
                    {" "}
                    • {company?.tagline || "Next-Gen Smart Living Ecosystems"}
                  </span>
                  <span className="hidden sm:inline"> • sales@whyte.co.in</span>
                </div>
                <div className="flex items-center gap-3 font-mono">
                  <span>{quotation.quotationNumber}</span>
                  <span>•</span>
                  <span>
                    Page {page.pageNumber} of {page.totalPages}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
