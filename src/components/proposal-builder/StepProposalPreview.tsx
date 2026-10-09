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
  Package,
  Award,
  Phone,
  Mail,
  Globe,
  Building2,
  MapPin,
} from "lucide-react";
import { Quotation, QuotationRoom, QuotationItem, Company } from "@/types";
import { formatCurrency, formatDate, getRoomIcon } from "@/lib/utils";
import { getRoomFullTitle } from "@/lib/roomUtils";
import WhyteLogo from "@/components/shared/WhyteLogo";
import { calculateQuotationGst } from "@/lib/pricing";
import { apiJson, toErrorMessage } from "@/lib/apiClient";
import { isValidGstin } from "@/lib/validation/fields";
import { resolvePlaceOfSupply } from "@/lib/gstPlaceOfSupply";

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
        type: "switchboard_config_room";
        room: QuotationRoom;
        roomIndex: number;
        items: QuotationItem[];
        showSectionHeader: boolean;
        showRoomHeader: boolean;
        isContinuation: boolean;
      }
    | {
        type: "room";
        room: QuotationRoom;
        roomIndex: number;
        items: QuotationItem[];
        isContinuation: boolean;
        showSectionHeader?: boolean;
        showRoomHeader: boolean;
        showRoomFooter: boolean;
      }
    | { type: "closing_and_financials" }
  >;
}

/**
 * Formats product name for customer proposal display.
 * Strips technical/catalog descriptive suffixes such as:
 * "Only Available in Acrylic", "(Only Available in Acrylic)", "Available in...", etc.
 */
export function formatProposalProductName(rawName: string | null | undefined): string {
  if (!rawName || typeof rawName !== "string") return "Product";

  let name = rawName.trim();

  // Strip catalog suffix phrases (case-insensitive)
  name = name.replace(/\s*[\(\[-]?\s*only\s+available\s+in\s+[^)\]\n\r]*[\)\]-]?/gi, "");
  name = name.replace(/\s*[\(\[-]?\s*available\s+only\s+in\s+[^)\]\n\r]*[\)\]-]?/gi, "");
  name = name.replace(/\s*[\(\[-]?\s*available\s+in\s+[^)\]\n\r]*[\)\]-]?/gi, "");
  name = name.replace(/\s*[\(\[-]?\s*installation\s+location[^)\]\n\r]*[\)\]-]?/gi, "");

  // Clean up trailing punctuation, hyphens, or spaces
  name = name.replace(/[\s\.\,\-]+$/, "").trim();

  return name || "Product";
}

export function getItemModuleSize(item: QuotationItem): string | null {
  const val =
    item.variantConfig?.moduleSize ||
    item.variantConfig?.module ||
    item.variantConfig?.size ||
    item.product?.moduleSize;
  if (
    !val ||
    typeof val !== "string" ||
    val.toLowerCase() === "undefined" ||
    val.toLowerCase() === "null"
  ) {
    return null;
  }
  return val.trim();
}

export function getItemFinish(
  item: QuotationItem,
  quotation: Quotation
): string | null {
  const val =
    item.variantConfig?.finish ||
    item.variantConfig?.surfaceFinish ||
    item.productVariant?.surfaceFinish ||
    item.product?.surfaceFinish ||
    quotation.defaultFinish;
  if (
    !val ||
    typeof val !== "string" ||
    val.toLowerCase() === "undefined" ||
    val.toLowerCase() === "null"
  ) {
    return null;
  }
  return val.trim();
}

export function getItemColor(item: QuotationItem): string | null {
  // `item.productVariant` has never carried a `config` field (it is built by
  // `serializeVariant`, whose own output never included one) — a trailing
  // `item.productVariant?.config?.color` fallback here always evaluated to
  // `undefined`, in production, every time. Removed rather than kept as a
  // no-op so the type honestly reflects what this object has ever had.
  const val = item.variantConfig?.color || item.variantConfig?.colour;
  if (
    !val ||
    typeof val !== "string" ||
    val.toLowerCase() === "undefined" ||
    val.toLowerCase() === "null"
  ) {
    return null;
  }
  return val.trim();
}

export function getItemTier(
  item: QuotationItem,
  quotation: Quotation
): string | null {
  const val =
    item.variantConfig?.tier ||
    item.variantConfig?.automationTier ||
    item.variantConfig?.series ||
    item.productVariant?.automationTier ||
    item.product?.automationTier ||
    quotation.defaultTier;
  if (
    !val ||
    typeof val !== "string" ||
    val.toLowerCase() === "undefined" ||
    val.toLowerCase() === "null"
  ) {
    return null;
  }
  return val.trim();
}

/**
 * Robust resolution of product image URLs.
 * Handles Cloudinary full URLs, relative paths (/whyte_catalog_images/...),
 * variant-specific images, and imagePublicId fallbacks.
 */
export function getItemImageUrl(item: QuotationItem): string | null {
  // Same as in `getItemColor` above: `item.productVariant` has never carried
  // `imageUrl`/`imagePublicId` (`serializeVariant`'s output never included
  // them), so these two fallbacks always evaluated to `undefined` in
  // production. Removed rather than kept as a no-op.
  let url = item.product?.imageUrl || null;

  if (!url) {
    const publicId = item.product?.imagePublicId;
    if (publicId && typeof publicId === "string" && publicId.trim()) {
      const trimmedId = publicId.trim();
      if (trimmedId.startsWith("http://") || trimmedId.startsWith("https://")) {
        url = trimmedId;
      } else {
        const cloudName =
          process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
          process.env.CLOUDINARY_CLOUD_NAME ||
          "whyte-automation";
        url = `https://res.cloudinary.com/${cloudName}/image/upload/${trimmedId}`;
      }
    }
  }

  if (!url && item.product?.notes && typeof item.product.notes === "string") {
    const trimmedNotes = item.product.notes.trim();
    if (trimmedNotes.startsWith("/") || trimmedNotes.includes("whyte_catalog_images")) {
      url = trimmedNotes;
    }
  }

  if (!url || typeof url !== "string") {
    return null;
  }

  const cleanUrl = url.trim();
  if (!cleanUrl) return null;

  return cleanUrl;
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

export interface AuthorizedDealerInfo {
  name: string;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  gstNumber: string | null;
  address: string | null;
}

/**
 * The "Authorized Dealer" shown on the client-facing proposal is always
 * `quotation.dealer` — the existing `dealerId` relation (populated server-side
 * via the Quotation model's `dealer` virtual), with no second dealer concept.
 * This one field already covers both ways a quotation can have a dealer:
 *   - a dealer created it for themselves (dealerId === their own id), and
 *   - an Admin/Super Admin created it and assigned a dealer (dealerId set by
 *     the separate `/assign` endpoint; `createdBy` stays the admin's id).
 * `createdBy` is never read here — only `assignedTo` (`dealerId`) determines
 * who is shown as the Authorized Dealer. No dealer assigned -> null, and the
 * section is omitted entirely (never an empty box, "N/A", or "Unassigned").
 * Only business-safe, already-populated fields are used; nothing is invented
 * and no internal id/role/auth/financial field is ever read here.
 */
export function getAuthorizedDealer(quotation: Quotation): AuthorizedDealerInfo | null {
  const dealer = quotation.dealer;
  if (!dealer) return null;

  const name =
    dealer.name?.trim() ||
    [dealer.firstName, dealer.lastName].filter(Boolean).join(" ").trim();
  if (!name) return null;

  // The dealer's account login email (`dealer.email`) is an internal
  // credential, not a business contact — it is never shown on a
  // client-facing document. Only an explicitly-set `businessEmail` is
  // shown, and only if one was actually set (never a placeholder).
  const businessEmail = dealer.businessEmail?.trim() || null;

  // A placeholder/invalid GSTIN must never reach the document: hide the
  // chip entirely rather than show dummy or malformed data.
  const gstNumber = dealer.gstNumber?.trim() || null;

  return {
    name,
    phone: dealer.contactNumber?.trim() || null,
    email: businessEmail,
    companyName: dealer.companyName?.trim() || null,
    gstNumber: gstNumber && isValidGstin(gstNumber) ? gstNumber : null,
    address: dealer.address?.trim() || null,
  };
}

/**
 * Deterministic multi-page pagination algorithm for architectural Whyte proposals.
 */
function paginateQuotation(quotation: Quotation): ProposalPageSlice[] {
  const rooms = getRenderableProposalRooms(quotation.rooms);
  const pages: ProposalPageSlice[] = [];

  // Height-budget constants are calibrated against the REAL rendered pixel
  // height of each element (measured from actual captured PDF pages), not a
  // rough guess — a product row with its name, SB-number badge, and
  // module/finish/tier chips routinely wraps to ~85px, not the ~52px a bare
  // single-line estimate would suggest. Err generously: a page finishing
  // short is invisible, a page silently growing past 1123px is not (it gets
  // squashed to fit the fixed A4 image slot in the final PDF).
  // Recalibrated for the larger proposal type scale (see font-size pass):
  // every row's rendered height grew roughly 10-18% with it, so the header/
  // footer/item budgets below are bumped ~15% to keep pages from overflowing
  // and getting squashed into the fixed A4 image slot.
  const PAGE_CAPACITY = 940;
  const FOOTER_RESERVE = 63;
  const RUNNING_HEADER = 63;

  const getCapacity = () => PAGE_CAPACITY - RUNNING_HEADER - FOOTER_RESERVE;

  // PAGE 1: Executive Cover
  pages.push({
    pageNumber: 1,
    totalPages: 0,
    isFirstPage: true,
    isLastPage: false,
    sections: [{ type: "cover" }],
  });

  // PAGE 2: About Whyte
  pages.push({
    pageNumber: 2,
    totalPages: 0,
    isFirstPage: false,
    isLastPage: false,
    sections: [{ type: "about_whyte" }],
  });

  // PAGE 3: Project Overview & Scope
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

  // UNIFIED SECTION: PROPOSED PRODUCTS & SPECIFICATIONS
  let isFirstProductRoomSection = true;

  for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
    const room = rooms[rIdx];
    const items = room.items || [];
    const itemsLeft = [...items];
    let isFirstSlice = true;

    if (itemsLeft.length === 0) continue;

    while (itemsLeft.length > 0) {
      const showSectionHeader = isFirstProductRoomSection && isFirstSlice;
      const headerH = (showSectionHeader ? 104 : 0) + (isFirstSlice ? 75 + 52 : 52);
      const minItemH = 98;

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
        const itemH = 98;
        if (currentHeight + sliceH + itemH > getCapacity()) {
          break;
        }
        sliceItems.push(item);
        sliceH += itemH;
        itemsLeft.shift();
      }

      const isLastSlice = itemsLeft.length === 0;
      if (isLastSlice) {
        sliceH += 58;
      }

      const hasSectionHeader = isFirstProductRoomSection && isFirstSlice;

      currentSections.push({
        type: "room",
        room,
        roomIndex: rIdx,
        items: sliceItems,
        isContinuation: !isFirstSlice,
        showSectionHeader: hasSectionHeader,
        showRoomHeader: isFirstSlice,
        showRoomFooter: isLastSlice,
      });

      currentHeight += sliceH;
      isFirstSlice = false;
      if (hasSectionHeader) {
        isFirstProductRoomSection = false;
      }
    }
  }

  // SECTION C: Closing, Financials, Terms & Contact. This block (financial
  // breakdown, investment callout, includes/terms, next steps, closing
  // contact card) measures ~930px tall when actually rendered — close to a
  // full page's own content budget on its own. Estimated at capacity itself
  // so it reliably lands on its own fresh page rather than being crammed
  // onto whatever space is left after the last room's items.
  const closingEstimateH = getCapacity();
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

  // Display-only: whether the tax breakdown shows as CGST+SGST (same state
  // as the supplier) or a single IGST line (different state). The total GST
  // amount is identical either way — only how it's split/labelled changes.
  const placeOfSupply = useMemo(() => {
    return resolvePlaceOfSupply({
      supplierGstin: company?.gstNumber,
      clientGstin: quotation.clientGstNumber,
      clientAddress: quotation.clientAddress,
    });
  }, [company?.gstNumber, quotation.clientGstNumber, quotation.clientAddress]);
  const isInterState = placeOfSupply.type === "inter";
  const igstAmount = cgstAmount + sgstAmount;

  const authorizedDealer = useMemo(() => getAuthorizedDealer(quotation), [quotation]);

  // A placeholder/invalid GSTIN (dealer or client) must never reach a
  // generated document. Hiding it from the on-screen chip isn't enough for
  // an exported PDF/print — generation itself is blocked with a clear error.
  const invalidGstinReason = useMemo(() => {
    const dealerGst = quotation.dealer?.gstNumber?.trim();
    if (dealerGst && !isValidGstin(dealerGst)) return "The dealer's GSTIN is invalid.";
    const clientGst = quotation.clientGstNumber?.trim();
    if (clientGst && !isValidGstin(clientGst)) return "The client's GSTIN is invalid.";
    return null;
  }, [quotation.dealer?.gstNumber, quotation.clientGstNumber]);

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

  const proposalPages = useMemo(() => {
    return paginateQuotation(quotation);
  }, [quotation]);

  const A4_WIDTH_MM = 210;
  const A4_HEIGHT_MM = 297;

  const handleDownloadPDF = async () => {
    if (!quotation || pageRefs.current.length === 0) return;

    if (invalidGstinReason) {
      toast.error(`Cannot generate PDF: ${invalidGstinReason}`);
      return;
    }

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

        // Ensure all images inside pageEl are completely loaded before capturing canvas
        const images = Array.from(pageEl.querySelectorAll("img"));
        await Promise.all(
          images.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          })
        );

        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }

        // JPEG at a moderate pixelRatio keeps the file small (a few hundred
        // KB/page instead of ~23MB/page as an uncompressed PNG at 3x), while
        // staying crisp enough for text and product thumbnails.
        const dataUrl = await htmlToImage.toJpeg(pageEl, {
          pixelRatio: 2,
          quality: 0.85,
          backgroundColor: "#ffffff",
          cacheBust: true,
        });

        // Never stretch the captured page to a fixed A4 box: if a page's
        // actual content overflowed its 1123px budget (rare, but possible
        // for a dense room), its real aspect ratio differs from A4's
        // 210:297. Compute placement that preserves that ratio — fitting
        // to the page (shrinking uniformly on both axes, never distorting)
        // instead of forcing a fixed height that would squash it.
        const rect = pageEl.getBoundingClientRect();
        const aspect = rect.height / rect.width;
        const a4Aspect = A4_HEIGHT_MM / A4_WIDTH_MM;
        let drawWidth = A4_WIDTH_MM;
        let drawHeight = A4_WIDTH_MM * aspect;
        if (aspect > a4Aspect) {
          drawHeight = A4_HEIGHT_MM;
          drawWidth = A4_HEIGHT_MM / aspect;
        }
        const offsetX = (A4_WIDTH_MM - drawWidth) / 2;

        pdf.addImage(dataUrl, "JPEG", offsetX, 0, drawWidth, drawHeight, undefined, "FAST");
      }

      const filename = `${quotation.quotationNumber || "Proposal"}_Whyte_Automation.pdf`;
      pdf.save(filename);
      toast.success("Proposal PDF downloaded!");
      markQuotationSent();
    } catch (err: unknown) {
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
      await apiJson.post(`/api/quotations/${quotation.id}/mark-sent`);
    } catch (err: unknown) {
      console.warn("Failed to mark quotation as sent:", err);
      toast.error(toErrorMessage(err, "Could not mark this quotation as sent."));
    }
  };

  const handlePrint = () => {
    if (invalidGstinReason) {
      toast.error(`Cannot print/export: ${invalidGstinReason}`);
      return;
    }
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
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs"
            >
              <ArrowLeft size={14} />
              <span>Back to Review</span>
            </button>
          ) : (
            <Link
              href={`/quotation/${quotation.id}?step=4`}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs"
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
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs"
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
            disabled={renderableRooms.length === 0 || !!invalidGstinReason}
            title={invalidGstinReason ?? undefined}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs disabled:opacity-50"
          >
            <Printer size={14} />
            <span className="hidden sm:inline">Print / Save as PDF</span>
            <span className="sm:hidden">Print</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPDF}
            disabled={downloading || renderableRooms.length === 0 || !!invalidGstinReason}
            title={invalidGstinReason ?? undefined}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-gray-950 rounded-xl hover:bg-gray-800 transition active:scale-[0.99] shadow-sm disabled:opacity-50"
          >
            <Download size={14} />
            <span>{downloading ? "Building PDF..." : "Download PDF"}</span>
          </button>
        </div>
      </div>

      {invalidGstinReason && (
        <div className="max-w-3xl mx-auto mb-6 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-sm font-semibold text-red-700 print:hidden">
          {invalidGstinReason} Fix it before generating or printing this proposal.
        </div>
      )}

      {/* Main Centered A4 Document Canvas */}
      {renderableRooms.length === 0 ? (
        <div className="bg-white max-w-xl mx-auto rounded-2xl border border-gray-200 p-12 text-center text-gray-400 space-y-3">
          <ShieldCheck size={36} className="mx-auto text-gray-300" />
          <h3 className="text-lg font-bold text-gray-900">
            No Spaces in Quotation
          </h3>
          <p className="text-sm text-gray-500">
            Please add spaces and smart devices before viewing or exporting the
            client proposal.
          </p>
          {onBackToEdit && (
            <button
              type="button"
              onClick={onBackToEdit}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-950 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition mt-2"
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
              {/* Brand watermark on content pages — large, extremely low-opacity "WHYTE"
                  behind all content. Never a status/DRAFT/DUPLICATE stamp: the document's
                  actual Draft/Sent/Approved/etc. status is shown elsewhere in the app UI,
                  not altered here, and never rendered as a warning-style stamp on the PDF. */}
              {!page.isFirstPage && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
                  style={{ zIndex: 0 }}
                >
                  <span
                    style={{
                      fontSize: 150,
                      fontWeight: 900,
                      letterSpacing: "-0.02em",
                      color: "rgba(212, 106, 140, 0.1)",
                      display: "inline-block",
                      transform: "rotate(-18deg)",
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    WHYTE
                  </span>
                </div>
              )}

              {/* Page Content Area */}
              <div className="relative z-10 space-y-6">
                {/* Running Header on Page 2+ */}
                {!page.isFirstPage && (
                  <div className="pb-3 border-b border-gray-200 flex items-center justify-between text-sm">
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
                      <span className="font-semibold text-gray-700 text-sm">
                        Smart Living Ecosystems
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-500 font-mono text-[13px]">
                      <span className="text-gray-950 font-bold">
                        {quotation.quotationNumber}
                      </span>
                      <span>•</span>
                      <span>{formatDate(quotation.createdAt)}</span>
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
                        {/* Header Brand Bar */}
                        <div className="flex items-start justify-between">
                          <WhyteLogo
                            theme="light"
                            alt="WHYTE Automations"
                            size="document-cover"
                            style={{ height: "22px", maxWidth: "100px", width: "auto" }}
                            unoptimized
                            loading="eager"
                          />
                          <div className="text-right">
                            <span className="text-[10px] font-mono tracking-widest text-gray-400 uppercase font-bold block">
                              Quotation Reference
                            </span>
                            <p className="text-base font-black font-mono tracking-tight text-gray-950">
                              {quotation.quotationNumber}
                            </p>
                            <p className="text-[13px] text-gray-500">
                              {formatDate(quotation.createdAt)}
                            </p>
                          </div>
                        </div>

                        {/*
                          Title + Hero zone, laid out against fixed pixel coordinates (not
                          percentages) matching the reference's A4 composition 1:1 — the page
                          itself is a fixed 794x1123 canvas (the A4-at-96dpi equivalent of
                          595.28x841.89pt), so these px values ARE the A4 coordinate system:

                            title column : 320px wide, at the content's left edge
                            title type   : 56px/line, extrabold (not black — lighter,
                                           editorial weight), 3 stacked lines
                            hero image   : 600px wide (~86% of the 698px content width),
                                           pulled up -140px so the phone sits beside the
                                           title's lower two lines and the house reaches
                                           toward the page's horizontal center — safe,
                                           because the source PNG is transparent at its own
                                           top-left (the phone only starts ~49% into the
                                           image, the house only starts ~31% down), so
                                           nothing solid ever reaches the title's text column
                        */}
                        <div>
                          <div className="w-[320px] space-y-2.5 pt-1">
                            <h1 className="text-[56px] font-extrabold leading-[1.0] tracking-tight text-gray-950">
                              Smart
                              <br />
                              Automation
                              <br />
                              <span className="text-accent">Proposal</span>
                            </h1>
                            <div className="h-[3px] w-[130px] rounded-full bg-gradient-to-r from-accent to-accent/0" />
                            <p className="text-[13px] font-bold uppercase tracking-widest text-gray-500">
                              Next-Gen <span className="text-gray-950">Smart Living</span> Ecosystems
                            </p>
                          </div>

                          <div className="-mt-[140px] flex justify-end">
                            <img
                              src="/proposal/whyte/cover-hero.webp"
                              alt="Whyte smart home and app control"
                              className="h-auto w-[600px] object-contain"
                            />
                          </div>
                        </div>

                        {/* Project Reference Information Strip: ONE bordered container,
                            four columns with visible vertical dividers between them. */}
                        <div className="grid grid-cols-4 divide-x divide-gray-200 rounded-xl border border-gray-300 bg-white text-sm">
                          <div className="px-4 py-3.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                              Client
                            </p>
                            <p className="mt-0.5 truncate font-bold text-gray-950">
                              {quotation.clientName}
                            </p>
                            {quotation.clientPhone && (
                              <p className="mt-0.5 text-[13px] text-gray-500">
                                {quotation.clientPhone}
                              </p>
                            )}
                            {quotation.clientEmail && (
                              <p className="mt-0.5 text-[13px] text-gray-500 truncate">
                                {quotation.clientEmail}
                              </p>
                            )}
                          </div>

                          <div className="px-4 py-3.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                              Project Location
                            </p>
                            <p className="mt-0.5 line-clamp-2 font-semibold text-gray-900">
                              {quotation.clientAddress || "Site Location"}
                            </p>
                          </div>

                          <div className="px-4 py-3.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                              Project Type
                            </p>
                            <p className="mt-0.5 font-semibold text-gray-900">
                              {quotation.houseType?.name ??
                                "Residential Smart Home"}
                            </p>
                            <p className="mt-0.5 text-[11px] text-gray-400">
                              Custom Automation
                            </p>
                          </div>

                          <div className="px-4 py-3.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                              Total Investment
                            </p>
                            <p className="mt-0.5 font-black font-mono text-base text-accent">
                              {formatCurrency(grandTotal, { decimals: 2 })}
                            </p>
                            <p className="mt-0.5 text-[11px] text-gray-500">
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
                          <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                            Company Profile & Ecosystem
                          </span>
                          <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">
                            About Whyte Automations
                          </h2>
                          <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                            Founded in Gandhinagar, Gujarat, Whyte Automations is
                            dedicated to bringing the next generation of smart
                            living to modern premises through the Internet of
                            Things, intuitive touch architecture, and intelligent
                            power management.
                          </p>
                        </div>

                        {/* Proven Milestone Statistics */}
                        <div className="grid grid-cols-5 gap-2 p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-center">
                          <div>
                            <p className="text-2xl sm:text-3xl font-black font-mono text-gray-950">
                              250+
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                              Installations
                            </p>
                          </div>
                          <div>
                            <p className="text-2xl sm:text-3xl font-black font-mono text-gray-950">
                              20,000+
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                              Switches
                            </p>
                          </div>
                          <div>
                            <p className="text-2xl sm:text-3xl font-black font-mono text-gray-950">
                              35+
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                              Products
                            </p>
                          </div>
                          <div>
                            <p className="text-2xl sm:text-3xl font-black font-mono text-gray-950">
                              25+
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                              Features
                            </p>
                          </div>
                          <div>
                            <p className="text-2xl sm:text-3xl font-black font-mono text-gray-950">
                              10+
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                              Cities
                            </p>
                          </div>
                        </div>

                        {/* Bespoke Premise Solutions */}
                        <div className="space-y-2.5">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-950">
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
                                <p className="font-bold text-gray-950 text-sm">
                                  Home
                                </p>
                                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
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
                                <p className="font-bold text-gray-950 text-sm">
                                  Office
                                </p>
                                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
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
                                <p className="font-bold text-gray-950 text-sm">
                                  Hotels
                                </p>
                                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
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
                                <p className="font-bold text-gray-950 text-sm">
                                  Hospitals
                                </p>
                                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
                                  Hygienic touch interfaces.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Why Whyte: Engineering & Guarantees */}
                        <div className="space-y-2.5">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-950">
                            Why Whyte
                          </h3>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-1">
                              <div className="flex items-center gap-1.5 font-bold text-gray-950">
                                <ShieldCheck size={14} className="text-gray-950" />
                                <span>5* Years Limited Warranty</span>
                              </div>
                              <p className="text-[13px] text-gray-500 leading-relaxed">
                                Backed by Whyte comprehensive hardware warranty
                                and dedicated support for long-term reliability.
                              </p>
                            </div>

                            <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-1">
                              <div className="flex items-center gap-1.5 font-bold text-gray-950">
                                <Sliders size={14} className="text-gray-950" />
                                <span>Modular & 100% Retrofit</span>
                              </div>
                              <p className="text-[13px] text-gray-500 leading-relaxed">
                                Direct drop-in replacement compatible with
                                standard concealed metal boxes with zero civil
                                rewiring.
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Government & Industry Backing */}
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            <Award size={15} className="text-gray-950" />
                            <span className="font-semibold text-gray-900">
                              Backed by Startup Gujarat (Govt. of Gujarat – 2021)
                            </span>
                          </div>
                          <span className="text-[13px] text-gray-500">
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
                          <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                            Specification & Scope
                          </span>
                          <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">
                            Your Project Overview
                          </h2>
                          <p className="text-sm text-gray-600 mt-0.5">
                            Tailored smart automation configuration designed for{" "}
                            <strong className="text-gray-950">
                              {quotation.clientName}
                            </strong>
                            .
                          </p>
                        </div>

                        {/* Authorized Dealer — only ever quotation.dealer (the existing
                            dealerId/"assignedTo" relation). Omitted entirely, with no
                            placeholder, when the quotation has no dealer. */}
                        {(() => {
                          if (!authorizedDealer) return null;
                          const hasContactRow =
                            authorizedDealer.address || authorizedDealer.phone || authorizedDealer.email;
                          return (
                            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3.5">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex items-start gap-2.5">
                                  <div className="w-9 h-9 rounded-lg bg-gray-950 text-white flex items-center justify-center shrink-0">
                                    <Building2 size={16} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                                      Authorized Dealer
                                    </p>
                                    <p className="text-base font-black text-gray-950 tracking-tight mt-0.5">
                                      {authorizedDealer.companyName || authorizedDealer.name}
                                    </p>
                                    {authorizedDealer.companyName && (
                                      <p className="text-[13px] text-gray-500 font-medium">
                                        {authorizedDealer.name}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {authorizedDealer.gstNumber && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-bold text-gray-600 tracking-wide shrink-0">
                                    GSTIN {authorizedDealer.gstNumber}
                                  </span>
                                )}
                              </div>
                              {hasContactRow && (
                                <div className="mt-2.5 pt-2.5 border-t border-gray-200/70 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-gray-500 font-medium">
                                  {authorizedDealer.address && (
                                    <span className="flex items-center gap-1.5">
                                      <MapPin size={11} className="text-gray-400 shrink-0" />
                                      {authorizedDealer.address}
                                    </span>
                                  )}
                                  {authorizedDealer.phone && (
                                    <span className="flex items-center gap-1.5">
                                      <Phone size={11} className="text-gray-400 shrink-0" />
                                      {authorizedDealer.phone}
                                    </span>
                                  )}
                                  {authorizedDealer.email && (
                                    <span className="flex items-center gap-1.5">
                                      <Mail size={11} className="text-gray-400 shrink-0" />
                                      {authorizedDealer.email}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Selected Automated Spaces */}
                        <div className="space-y-2.5">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-950">
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
                                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm"
                                  >
                                    <Icon size={13} className="text-accent" />
                                    <span className="font-semibold text-gray-900">
                                      {getRoomFullTitle(r, renderableRooms)}
                                    </span>
                                    <span className="font-mono text-[11px] bg-accent-light text-accent-foreground border border-accent-border/60 px-1.5 py-0.5 rounded font-bold">
                                      {count} {count === 1 ? "device" : "devices"}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-400 italic">
                              No spaces configured with active products
                            </div>
                          )}
                        </div>

                        {/* Automation Scope */}
                        <div className="space-y-2 pt-1">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-950">
                            Automation Scope
                          </h3>
                          <div className="p-4 rounded-xl bg-gray-50/70 border border-gray-200 text-sm space-y-1.5 text-gray-700">
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
                                  <strong className="text-accent-foreground bg-accent-light px-1.5 py-0.5 rounded border border-accent-border/60 capitalize text-[13px]">
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
                                  <strong className="text-accent-foreground bg-accent-light px-1.5 py-0.5 rounded border border-accent-border/60 capitalize text-[13px]">
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

                        {/* Official Whyte Tactus Features */}
                        <div className="space-y-2.5 pt-1">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-950">
                            Whyte Tactus Touch Series Technology
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-sm">
                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-sm">
                                Dual Intensity Light
                              </p>
                              <p className="text-[11px] text-gray-500 leading-snug">
                                Visual feedback indication showing active ON/OFF
                                state.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-sm">
                                Night Recognizable
                              </p>
                              <p className="text-[11px] text-gray-500 leading-snug">
                                Soft dim ambient glow makes switches easy to
                                locate in the dark.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-sm">
                                Voice Automation Ready
                              </p>
                              <p className="text-[11px] text-gray-500 leading-snug">
                                Full compatibility with Amazon Alexa and Google
                                Assistant.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-sm">
                                Sleep & Child Lock
                              </p>
                              <p className="text-[11px] text-gray-500 leading-snug">
                                Built-in safety and uninterrupted sleep mode
                                settings.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-sm">
                                Shock & Splash Proof
                              </p>
                              <p className="text-[11px] text-gray-500 leading-snug">
                                Toughened glass design provides optimal safety in
                                all spaces.
                              </p>
                            </div>

                            <div className="p-3 bg-white rounded-xl border border-gray-200 space-y-1">
                              <p className="font-bold text-gray-950 text-sm">
                                Two-Way Switching
                              </p>
                              <p className="text-[11px] text-gray-500 leading-snug">
                                Convenient provision for multi-point staircase and
                                bedside control.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  /* 4. ROOM-WISE PRODUCT SUMMARY & SPECIFICATIONS (UNIFIED SINGLE CONTAINER FORMAT) */
                  if (section.type === "room") {
                    const {
                      room,
                      items,
                      isContinuation,
                      showSectionHeader,
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
                      <div key={sIdx} className="space-y-2.5">
                        {/* Section Header Banner — same eyebrow + h2 pattern used by every
                            other section title in this document (About Whyte, Your Project
                            Overview, Financial Summary). */}
                        {showSectionHeader && (
                          <div className="pb-2.5 border-b border-gray-200 flex items-end justify-between mb-3">
                            <div>
                              <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                                Proposed Smart Equipment & Specifications
                              </span>
                              <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">
                                Product Summary &amp; Specifications
                              </h2>
                            </div>
                            <p className="text-[13px] text-gray-500 font-medium text-right max-w-xs">
                              Room-wise equipment details, panel specifications & itemized pricing
                            </p>
                          </div>
                        )}

                        {/* Room Header Banner — device count only; the subtotal is
                            shown exactly once, in the room's footer banner below. */}
                        {showRoomHeader && (
                          <div className="bg-gray-50 px-4 py-2.5 rounded-t-xl border border-gray-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon size={14} className="text-accent" />
                              <h3 className="font-extrabold text-gray-950 text-sm sm:text-base uppercase tracking-wider">
                                {getRoomFullTitle(room, renderableRooms)}
                              </h3>
                            </div>
                            <span className="text-[11px] font-mono text-accent-foreground bg-accent-light px-2 py-0.5 rounded border border-accent-border/60">
                              {(room.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0)}{" "}
                              {(room.items || []).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0) === 1
                                ? "device"
                                : "devices"}
                            </span>
                          </div>
                        )}

                        {/* Room Continuation */}
                        {isContinuation && (
                          <div className="bg-gray-50/80 px-4 py-1.5 rounded-t-xl border border-gray-200 text-sm font-semibold text-gray-700">
                            {getRoomFullTitle(room, renderableRooms)} (Continued)
                          </div>
                        )}

                        {/* Room Notes (if any) */}
                        {showRoomHeader && room.notes && (
                          <div className="px-4 py-1.5 bg-amber-50/50 border-x border-b border-amber-100 text-[13px] text-amber-900">
                            <span className="font-semibold">Space Note: </span>
                            {room.notes}
                          </div>
                        )}

                        {/* Compact Product Table: Product Name | Qty | Unit Price */}
                        {items.length > 0 && (
                          <div
                            className={`border border-gray-200 overflow-hidden ${
                              showRoomFooter ? "rounded-b-none" : "rounded-b-xl"
                            }`}
                          >
                            <table className="w-full text-left border-collapse text-sm">
                              <thead>
                                <tr className="bg-gray-50/80 border-b border-gray-200 text-[11px] uppercase font-bold text-gray-500 tracking-wider">
                                  <th className="py-2.5 px-4">PRODUCT</th>
                                  <th className="py-2.5 px-4 w-20 text-center">
                                    QTY
                                  </th>
                                  <th className="py-2.5 px-4 w-28 text-right">
                                    UNIT PRICE
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {items.map((item, itemIdx) => {
                                  const unitPrice = Number(item.unitPrice || 0);
                                  const formattedName = formatProposalProductName(item.product?.name);
                                  const moduleSize = getItemModuleSize(item);
                                  const finish = getItemFinish(item, quotation);
                                  const color = getItemColor(item);
                                  const tier = getItemTier(item, quotation);
                                  const sbLabel = item.sbNumber?.trim();
                                  const imgUrl = getItemImageUrl(item);
                                  const rawLoc = item.notes?.trim() || "";
                                  const hasValidLocation =
                                    Boolean(rawLoc) &&
                                    !rawLoc.startsWith("/") &&
                                    !rawLoc.includes("whyte_catalog_images") &&
                                    !["unspecified", "not specified", "n/a", "unknown", "installation location not specified"].includes(rawLoc.toLowerCase());

                                  return (
                                    <tr
                                      key={item.id || itemIdx}
                                      className="hover:bg-gray-50/40 transition-colors"
                                    >
                                      {/* Product Thumbnail & Clean Name & Location */}
                                      <td className="py-2.5 px-4 align-middle">
                                        <div className="flex items-center gap-3">
                                          {/* Standardized 48px Tile container for EVERY product */}
                                          <div className="w-12 h-12 shrink-0 rounded-xl border border-gray-200/90 bg-white shadow-2xs flex items-center justify-center p-1 overflow-hidden relative">
                                            {imgUrl ? (
                                              <img
                                                src={imgUrl}
                                                alt={formattedName}
                                                className="max-h-full max-w-full object-contain"
                                                crossOrigin="anonymous"
                                                onError={(e) => {
                                                  (e.target as HTMLElement).style.display = "none";
                                                }}
                                              />
                                            ) : (
                                              <Package size={18} className="text-gray-300" />
                                            )}
                                          </div>

                                          <div className="min-w-0 flex-1 space-y-0.5">
                                            <div className="flex items-center gap-2">
                                              <p className="font-bold text-gray-950 text-sm sm:text-base leading-snug">
                                                {formattedName}
                                              </p>
                                              {sbLabel && (
                                                <span className="font-mono text-[10px] font-bold text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.2 rounded shrink-0">
                                                  {sbLabel}
                                                </span>
                                              )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-1.5">
                                              {moduleSize && (
                                                <span className="text-[10px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200/80">
                                                  {moduleSize}
                                                </span>
                                              )}
                                              {finish && (
                                                <span className="text-[10px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200/80 capitalize">
                                                  {finish}
                                                </span>
                                              )}
                                              {color && (
                                                <span className="text-[10px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200/80 capitalize">
                                                  {color}
                                                </span>
                                              )}
                                              {tier && (
                                                <span className="text-[10px] font-bold text-accent-foreground bg-accent-light px-1.5 py-0.5 rounded border border-accent-border/60 capitalize">
                                                  {tier}
                                                </span>
                                              )}
                                              {hasValidLocation && (
                                                <span className="text-[13px] text-gray-600 ml-1">
                                                  <span className="text-gray-400 font-medium">Location: </span>
                                                  <span className="font-medium text-gray-900">{item.notes}</span>
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </td>

                                      {/* Qty */}
                                      <td className="py-2.5 px-4 text-center font-mono font-bold text-gray-900 text-sm sm:text-base align-middle">
                                        {item.quantity || 1}
                                      </td>

                                      {/* Unit Price */}
                                      <td className="py-2.5 px-4 text-right font-mono text-gray-700 text-sm sm:text-base align-middle">
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
                          <div className="flex justify-between items-center px-4 py-2 bg-gray-50/70 border-x border-b border-gray-200 rounded-b-xl text-sm font-semibold text-gray-800">
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

                  /* 6. FINANCIAL SUMMARY, INVESTMENT CALLOUT, TERMS & OFFICIAL WHYTE CLOSING */
                  if (section.type === "closing_and_financials") {
                    return (
                      <div key={sIdx} className="space-y-3">
                        {/* Section Header — same eyebrow + h2 pattern as every other page. */}
                        <div>
                          <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                            Pricing & Commercial Summary
                          </span>
                          <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">
                            Investment &amp; Next Steps
                          </h2>
                        </div>

                        {/* Financial Summary */}
                        <div className="space-y-1.5">
                          <div className="pb-1 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="text-sm sm:text-base font-bold uppercase tracking-wider text-gray-950">
                              Financial Summary
                            </h3>
                            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                              Investment Overview
                            </span>
                          </div>

                          <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2 text-sm">
                            {/* Subtotal */}
                            <div className="flex justify-between items-center text-gray-600">
                              <span className="font-medium text-gray-600">Subtotal</span>
                              <span className="font-mono font-medium text-gray-900">
                                {formatCurrency(grossSubtotal, { decimals: 2 })}
                              </span>
                            </div>

                            {/* Discount — hidden entirely when there is none */}
                            {clampedDiscount > 0 && (
                              <div className="flex justify-between items-center text-gray-600">
                                <span className="flex items-center gap-1.5 font-medium text-gray-600">
                                  <span>Discount</span>
                                  {hasDiscount && quotation.discountType === "percentage" && (
                                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                      {quotation.discountValue}%
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono font-medium text-emerald-600">
                                  -{formatCurrency(clampedDiscount, { decimals: 2 })}
                                </span>
                              </div>
                            )}

                            {/* Net Subtotal */}
                            <div className="pt-2 border-t border-gray-200/80 flex justify-between items-baseline py-0.5">
                              <div>
                                <span className="font-bold text-gray-950 block text-sm sm:text-base">Net Subtotal</span>
                                <span className="text-[11px] text-gray-400 font-medium">Taxable amount after discount</span>
                              </div>
                              <span className="font-mono font-bold text-gray-950 text-base sm:text-lg">
                                {formatCurrency(netSubtotal, { decimals: 2 })}
                              </span>
                            </div>

                            {/* Tax Summary Box */}
                            <div className="p-3 rounded-lg bg-white border border-gray-200/80 space-y-1.5">
                              <div className="flex items-center justify-between pb-1 border-b border-gray-100">
                                <span className="text-[11px] uppercase font-bold tracking-wider text-gray-500">
                                  Tax Summary
                                </span>
                                <span className="text-[11px] font-mono font-bold text-accent px-1.5 py-0.5 rounded bg-accent/5 border border-accent/20">
                                  GST
                                </span>
                              </div>
                              <div className="space-y-1 text-sm">
                                {isInterState ? (
                                  <div className="flex justify-between items-center text-gray-600">
                                    <span className="text-gray-700 font-medium">IGST @ 18%</span>
                                    <span className="font-mono font-semibold text-gray-900">
                                      {formatCurrency(igstAmount, { decimals: 2 })}
                                    </span>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex justify-between items-center text-gray-600">
                                      <span className="text-gray-700 font-medium">CGST @ 9%</span>
                                      <span className="font-mono font-semibold text-gray-900">
                                        {formatCurrency(cgstAmount, { decimals: 2 })}
                                      </span>
                                    </div>
                                    <div className="flex justify-between items-center text-gray-600">
                                      <span className="text-gray-700 font-medium">SGST/UTGST @ 9%</span>
                                      <span className="font-mono font-semibold text-gray-900">
                                        {formatCurrency(sgstAmount, { decimals: 2 })}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Grand Total */}
                            <div className="pt-2.5 border-t-2 border-gray-950/20 flex justify-between items-baseline">
                              <div>
                                <span className="text-base font-black uppercase tracking-wider text-gray-950 block">
                                  Grand Total
                                </span>
                                <span className="text-[11px] text-gray-400">
                                  Total Investment (Incl. Taxes)
                                </span>
                              </div>
                              <span className="text-3xl font-black font-mono text-gray-950 tracking-tight">
                                {formatCurrency(grandTotal, { decimals: 2 })}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Final Investment Callout */}
                        <div className="p-3.5 rounded-xl border border-accent-border/80 bg-accent-light/30 text-center space-y-1">
                          <p className="text-[11px] uppercase font-bold tracking-widest text-accent">
                            ESTIMATED PROJECT INVESTMENT
                          </p>
                          <p className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-gray-950">
                            {formatCurrency(grandTotal, { decimals: 2 })}
                          </p>
                          <p className="text-[13px] text-gray-500">
                            Final pricing is based on the products and configuration selected in this proposal.
                          </p>
                        </div>

                        {/* Proposal Includes & Commercial Information */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          {/* Proposal Includes */}
                          <div className="p-3.5 rounded-xl border border-gray-200 bg-white space-y-1.5">
                            <h4 className="font-bold uppercase tracking-wider text-gray-900 text-[11px]">
                              Proposal Includes
                            </h4>
                            <ul className="space-y-1 text-[13px] text-gray-600">
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
                            <h4 className="font-bold uppercase tracking-wider text-gray-900 text-[11px]">
                              Commercial Terms & Validity
                            </h4>
                            <div className="space-y-1 text-[13px] text-gray-600">
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
                          <h4 className="font-bold uppercase tracking-wider text-gray-950 text-[11px]">
                            Next Steps
                          </h4>
                          <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px] text-gray-700">
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-sm">
                                1. Review
                              </span>
                              Review the proposed automation configuration.
                            </li>
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-sm">
                                2. Confirm
                              </span>
                              Confirm product selection and quantities.
                            </li>
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-sm">
                                3. Align
                              </span>
                              Confirm on-site installation requirements.
                            </li>
                            <li className="p-2 bg-white rounded-lg border border-gray-200">
                              <span className="font-bold text-gray-950 block text-sm">
                                4. Proceed
                              </span>
                              Proceed with final order & commissioning.
                            </li>
                          </ol>
                        </div>

                        {/* Official Whyte Closing & Contact Card */}
                        <div className="p-3.5 rounded-xl border border-gray-200 bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm">
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
                            <p className="text-[13px] text-gray-500">
                              Gandhinagar, Gujarat, India • Next-Gen Smart Living
                            </p>
                          </div>
                          <div className="space-y-1 text-right sm:text-right font-medium text-[13px] text-gray-600">
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
              <div className="pt-4 text-center text-[11px] font-medium text-gray-400">
                www.whyte.co.in
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
