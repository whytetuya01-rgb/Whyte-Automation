"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Printer,
  Download,
  Share2,
  ArrowLeft,
  AlertTriangle,
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
  X,
} from "lucide-react";
import { Quotation, QuotationRoom, QuotationItem, Company } from "@/types";
import { formatCurrency, formatDate, getRoomIcon } from "@/lib/utils";
import { getRoomFullTitle, getRoomDisplayName, getRoomFloorLabel, isMultiFloorHouseType } from "@/lib/roomUtils";
import { getRoomImage, roomImageSrc, RoomImageEntry } from "@/lib/roomImageMap";
import WhyteLogo from "@/components/shared/WhyteLogo";
import {
  ProposalAboutCompany,
  ProposalContactCard,
  ProposalCoverTitle,
  ProposalIncludes,
  ProposalLogo,
  ProposalNextSteps,
  ProposalPageFooter,
  proposalValidityText,
} from "@/components/proposal/ProposalDocumentParts";
import { resolveProposalContent, type IntroPageMode } from "@/lib/documentSettings";
import QuotationDeliveryModal from "@/components/proposal-builder/QuotationDeliveryModal";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";
import { calculateQuotationGst } from "@/lib/pricing";
import { apiJson, toErrorMessage } from "@/lib/apiClient";
import { isValidGstin } from "@/lib/validation/fields";
import { resolvePlaceOfSupply } from "@/lib/gstPlaceOfSupply";
import { eligibleItemsOfRoom, isProtectedQuotationStatus } from "@/lib/quotationAvailability";
import { groupProposalItems, type ProposalGroupingOptions, type ProposalProductRow } from "@/lib/proposalItemGroups";
import UnavailabilityWarning from "./UnavailabilityWarning";

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
    | { type: "about_company" }
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
        /** Display rows: entries of the same product in this room are grouped (see `@/lib/proposalItemGroups`). */
        items: ProposalProductRow[];
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

export function getItemConnectivity(item: QuotationItem): string | null {
  const val =
    item.variantConfig?.connectivity ||
    item.variantConfig?.series ||
    item.variantConfig?.type ||
    item.variantConfig?.protocol;
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
 * Resolves the catalog room photograph entry for any room instance.
 * Checks custom assigned name, authoritative catalog roomType name,
 * and disambiguated display name (e.g. "Living Room 2" -> "living-room").
 */
export function resolveRoomImage(
  room: QuotationRoom,
  renderableRooms?: QuotationRoom[]
): RoomImageEntry {
  const custom = room.customName?.trim();
  const typeName = room.roomType?.name?.trim();
  const displayName = getRoomDisplayName(room, renderableRooms);

  // If custom room name is set, test if it maps to a specific room category
  if (custom) {
    const customEntry = getRoomImage(custom);
    if (
      customEntry.file !== "living-room" ||
      !typeName ||
      typeName.toLowerCase().includes("living")
    ) {
      return customEntry;
    }
  }

  // Authoritative catalog room type fallback
  if (typeName) {
    return getRoomImage(typeName);
  }

  return getRoomImage(displayName);
}

/**
 * Premium Room Image component displayed in the room header banner.
 * Displays the room photograph with rounded corners, object-cover, and focal-point alignment.
 * If the image fails to load or has no catalog photo, displays a clean neutral illustration.
 */
export function RoomHeaderImage({
  room,
  renderableRooms,
  fallbackIcon: FallbackIcon,
  large = false,
}: {
  room: QuotationRoom;
  renderableRooms: QuotationRoom[];
  fallbackIcon: React.ComponentType<{ size?: number; className?: string }>;
  /** Product Summary room card: a big photograph instead of the compact thumbnail. */
  large?: boolean;
}) {
  const frame = large
    ? "w-40 h-24 shrink-0 rounded-xl"
    : "w-24 h-[54px] shrink-0 rounded-lg";
  const [imgFailed, setImgFailed] = useState(false);

  const imageEntry = useMemo(() => {
    try {
      return resolveRoomImage(room, renderableRooms);
    } catch {
      return null;
    }
  }, [room, renderableRooms]);

  const imgSrc = imageEntry ? roomImageSrc(imageEntry) : null;
  const focalY = imageEntry?.focalY ?? 0.5;
  const label = room.customName?.trim() || room.roomType?.name || "Space";

  if (!imgSrc || imgFailed) {
    return (
      <div
        className={`${frame} border border-gray-200/90 bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 flex flex-col items-center justify-center p-1 text-gray-400 select-none shadow-2xs`}
        aria-label={label}
      >
        <div className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center text-accent shadow-2xs mb-0.5">
          <FallbackIcon size={13} />
        </div>
        <span className="text-[8px] font-bold uppercase tracking-wider text-gray-500 truncate max-w-full">
          {label}
        </span>
      </div>
    );
  }

  return (
    <div className={`relative ${frame} overflow-hidden border border-gray-200/90 bg-gray-100 shadow-2xs`}>
      <img
        src={imgSrc}
        alt={imageEntry?.alt || label}
        className="w-full h-full object-cover"
        style={{ objectPosition: `50% ${Math.round(focalY * 100)}%` }}
        crossOrigin="anonymous"
        loading="eager"
        onError={() => setImgFailed(true)}
      />
    </div>
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
 * The installation location typed for a product, or `null` when it is empty or a placeholder / image path that
 * must never reach the client document.
 */
export function getItemLocation(item: QuotationItem): string | null {
  const raw = item.notes?.trim() || "";
  if (!raw || raw.startsWith("/") || raw.includes("whyte_catalog_images")) return null;
  if (["unspecified", "not specified", "n/a", "unknown", "installation location not specified"].includes(raw.toLowerCase())) {
    return null;
  }
  return raw;
}

/** Product Summary row geometry (px). The proposal page is a fixed-width A4 canvas, so these never depend on the viewport. */
const PRODUCT_IMAGE_PX = 112;
const PRODUCT_ROW_MIN_PX = PRODUCT_IMAGE_PX + 25; // 12px padding top/bottom + 1px divider
/** Room block pieces. */
const ROOM_GAP_PX = 12; // space-y-4 (16px) minus the -4px each room section pulls back = a 12px gap
const ROOM_HEADER_PX = 130; // 2px border + 12px padding + 96px photograph + 12px padding + rule + slack
const ROOM_CONTINUED_PX = 40; // slim "continued" title bar of a split room
const ROOM_CONTINUES_PX = 30; // "Continued on next page" note closing a split room
const ROOM_SUBTOTAL_PX = 56; // distinct subtotal strip + bottom border
const ROOM_EXTRA_NOTE_PX = 30;
const SECTION_TITLE_PX = 66;

/** How the proposal tells whether two entries of a room are the same product row (see `@/lib/proposalItemGroups`). */
function proposalGroupingOptions(quotation: Quotation): ProposalGroupingOptions {
  return {
    attributesOf: (item) => [
      getItemModuleSize(item),
      getItemFinish(item, quotation),
      getItemColor(item),
      getItemTier(item, quotation),
      getItemConnectivity(item),
    ],
    locationOf: getItemLocation,
  };
}

/** The line printed for one installation location of a grouped row ("Hall", or "Hall x 2" when several are listed). */
function formatRowLocation(label: string | null, quantity: number, showQuantity: boolean): { prefix: string; text: string } {
  const quantitySuffix = showQuantity ? ` × ${quantity}` : "";
  return label === null
    ? { prefix: "", text: `Location not specified${quantitySuffix}` }
    : { prefix: "Location: ", text: `${label}${quantitySuffix}` };
}

/**
 * Rendered height of one product row, from what it will actually contain. A long name, many configuration chips
 * or a long location wrap onto extra lines; the pagination budget must grow with them or the page overflows its
 * fixed 1123px canvas. A grouped row lists every distinct location of its entries on a line of its own.
 */
function estimateProductRowHeight(row: ProposalProductRow, quotation: Quotation): number {
  const item = row.item;
  const nameLines = Math.max(1, Math.ceil(formatProposalProductName(item.product?.name).length / 34));
  const chipCount = [getItemModuleSize(item), getItemFinish(item, quotation), getItemColor(item), getItemTier(item, quotation), getItemConnectivity(item)].filter(Boolean).length;
  const chipRows = chipCount ? Math.ceil(chipCount / 4) : 0;
  let locationLines = 0;
  if (row.entries.length > 1) {
    const showQuantity = row.locations.length > 1;
    locationLines = row.locations.reduce((lines, location) => {
      const { prefix, text } = formatRowLocation(location.label, location.quantity, showQuantity);
      return lines + Math.max(1, Math.ceil((prefix.length + text.length) / 52));
    }, 0);
  } else {
    const location = getItemLocation(item);
    locationLines = location ? Math.max(1, Math.ceil(location.length / 52)) : 0;
  }
  const textHeight = nameLines * 22 + chipRows * 28 + locationLines * 22 + 24;
  return Math.max(PRODUCT_ROW_MIN_PX, textHeight + 25);
}

/**
 * Deterministic multi-page pagination algorithm for architectural Whyte proposals.
 */
function paginateQuotation(quotation: Quotation, introPages: IntroPageMode): ProposalPageSlice[] {
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
  const PAGE_CAPACITY = 960;
  const FOOTER_RESERVE = 40;
  const RUNNING_HEADER = 45;

  const getCapacity = () => PAGE_CAPACITY - RUNNING_HEADER - FOOTER_RESERVE;

  // PAGE 1: Executive Cover
  pages.push({
    pageNumber: 1,
    totalPages: 0,
    isFirstPage: true,
    isLastPage: false,
    sections: [{ type: "cover" }],
  });

  // Introduction pages depend on the company's document settings: the built-in Whyte About + Overview pages
  // (default company only), one custom About page, or none.
  if (introPages === "standard") {
    pages.push({ pageNumber: 2, totalPages: 0, isFirstPage: false, isLastPage: false, sections: [{ type: "about_whyte" }] });
    pages.push({ pageNumber: 3, totalPages: 0, isFirstPage: false, isLastPage: false, sections: [{ type: "project_overview_and_scope" }] });
  } else if (introPages === "custom") {
    pages.push({ pageNumber: 2, totalPages: 0, isFirstPage: false, isLastPage: false, sections: [{ type: "about_company" }] });
  }

  let currentPage = pages.length + 1;
  let currentSections: ProposalPageSlice["sections"] = [];
  let currentHeight = 0;

  // UNIFIED SECTION: PROPOSED PRODUCTS & SPECIFICATIONS
  let isFirstProductRoomSection = true;

  for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
    const room = rooms[rIdx];
    // Entries of the same product in this room are shown as one row; the stored items are only read.
    const itemsLeft = groupProposalItems(room.items || [], proposalGroupingOptions(quotation));
    let isFirstSlice = true;

    if (itemsLeft.length === 0) continue;

    // Rooms flow one after another: a room starts on the current page whenever its header, its first product row
    // (and, for a one-row room, the subtotal) still fit. Otherwise it starts the next page, so a heading is
    // never left alone at the bottom of a page.
    const extrasH = (room.notes ? ROOM_EXTRA_NOTE_PX : 0) + (room.isUnavailable ? ROOM_EXTRA_NOTE_PX : 0);

    while (itemsLeft.length > 0) {
      const showSectionHeader = isFirstProductRoomSection && isFirstSlice;
      const sectionH = showSectionHeader ? SECTION_TITLE_PX : 0;
      const roomH = isFirstSlice ? ROOM_HEADER_PX + extrasH : ROOM_CONTINUED_PX;
      const firstItemH = estimateProductRowHeight(itemsLeft[0], quotation);
      const minNeededH = sectionH + roomH + firstItemH + (itemsLeft.length === 1 ? ROOM_SUBTOTAL_PX : ROOM_CONTINUES_PX);

      if (currentSections.length > 0 && currentHeight + ROOM_GAP_PX + minNeededH > getCapacity()) {
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

      // Pack as many product rows as fit; the subtotal travels with the last row.
      const sliceItems: ProposalProductRow[] = [];
      let sliceH = (currentSections.length > 0 ? ROOM_GAP_PX : 0) + sectionH + roomH;

      while (itemsLeft.length > 0) {
        const itemH = estimateProductRowHeight(itemsLeft[0], quotation);
        const isLastItem = itemsLeft.length === 1;
        const requiredH = itemH + (isLastItem ? ROOM_SUBTOTAL_PX : ROOM_CONTINUES_PX);

        if (currentHeight + sliceH + requiredH > getCapacity() && sliceItems.length > 0) {
          break;
        }
        sliceItems.push(itemsLeft[0]);
        sliceH += itemH;
        itemsLeft.shift();
      }

      const isLastSlice = itemsLeft.length === 0;
      sliceH += isLastSlice ? ROOM_SUBTOTAL_PX : ROOM_CONTINUES_PX;

      currentSections.push({
        type: "room",
        room,
        roomIndex: rIdx,
        items: sliceItems,
        isContinuation: !isFirstSlice,
        showSectionHeader,
        showRoomHeader: isFirstSlice,
        showRoomFooter: isLastSlice,
      });

      currentHeight += sliceH;
      isFirstSlice = false;
      if (showSectionHeader) {
        isFirstProductRoomSection = false;
      }
    }
  }

  // SECTION C: Closing, Financials, Terms & Contact.
  // Allocate its own dedicated page for clean visibility and premium layout.
  if (currentSections.length > 0) {
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
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [unavailableBannerDismissed, setUnavailableBannerDismissed] = useState(false);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // The proposal page is laid out against fixed pixel coordinates — a true
  // 794x1123 A4-at-96dpi canvas (see the "cover" section below) — so it must
  // NEVER be allowed to reflow at a narrower CSS width: letting it shrink to
  // the viewport (the old `w-full` behavior) squeezed that fixed-coordinate
  // layout into less space than it was built for, which is what produced the
  // overlapping header/stats/price text on a phone screen. `transform: scale`
  // shrinks it uniformly for on-screen display instead — every internal px
  // value still relates to every other exactly as designed (nothing reflows
  // or overlaps).
  //
  // This was originally done with CSS `zoom` instead of `transform`, since
  // `zoom` also shrinks the element's own layout box (so the wrapper auto-
  // collapses, no manual height math needed). That broke on iOS Safari: it's
  // a known WebKit bug where raster content (`<img>`, including the hero
  // illustration and every product thumbnail) inside a `zoom`-ed subtree
  // fails to paint at all, even though the layout itself is otherwise
  // correct — exactly the "alignment is fine, images are just gone" report.
  // `transform` does not have that bug and has been reliably supported on
  // iOS since iOS 3, at the cost of the wrapper needing an explicit collapsed
  // height (transform is paint-only — it never changes element's own layout
  // box size), handled via `PAGE_HEIGHT_PX` below.
  //
  // PDF/print capture always resets this back to `none` first (see
  // `handleDownloadPDF` and the `@media print` rule in globals.css), so the
  // exported document is never downscaled just because it was generated from
  // a small screen.
  const pagesWrapperRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const PAGE_WIDTH_PX = 794;
  const PAGE_HEIGHT_PX = 1123;

  useEffect(() => {
    const el = pagesWrapperRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const updateScale = () => {
      const available = el.clientWidth;
      if (!available) return;
      setPreviewScale(Math.min(1, available / PAGE_WIDTH_PX));
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `onBackToEdit` is only ever passed when this step is rendered inside
  // `ProposalBuilder` (step 5), which already shows its own top-level
  // version of this same banner across every step — rendering a second
  // copy here would just duplicate it. The standalone route
  // (`/quotation/[id]/preview`, also the PDF/print target) renders this
  // component with no parent banner, so it needs its own.
  const isStandalonePreview = !onBackToEdit;
  const isLockedForBanner = quotation.status === "approved" || quotation.status === "delivered";
  const unavailableItemLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const room of quotation.rooms ?? []) {
      if (room.isUnavailable) {
        labels.add(room.customName || room.roomType?.name || "A space in this quotation");
        continue;
      }
      for (const item of room.items ?? []) {
        if (item.isUnavailable) labels.add(item.product?.name || item.variantLabel || "A product in this quotation");
      }
    }
    return [...labels];
  }, [quotation.rooms]);

  const rawRooms = useMemo(() => quotation.rooms || [], [quotation.rooms]);
  const renderableRooms = useMemo(
    () => getRenderableProposalRooms(rawRooms),
    [rawRooms]
  );

  // Approved/Delivered quotations keep their historical total regardless of
  // any catalog deletion since; every other status excludes a room/item
  // whose catalog reference has been soft-deleted — the same rule the
  // server applies in `normalizeQuotation`/`aggregateQuotationRoomTotals`,
  // so this preview (and the PDF rendered from it) never disagrees with the
  // editor or a fresh GET of the same quotation.
  const isLocked = isProtectedQuotationStatus(quotation.status);

  const subtotal = useMemo(() => {
    return rawRooms.reduce((sum, r) => {
      return (
        sum +
        eligibleItemsOfRoom(r, r.items, isLocked).reduce(
          (acc, i) => acc + Number(i.unitPrice || 0) * (i.quantity || 1),
          0
        )
      );
    }, 0);
  }, [rawRooms, isLocked]);

  const totalProducts = useMemo(() => {
    return renderableRooms.reduce((sum, r) => {
      return sum + eligibleItemsOfRoom(r, r.items, isLocked).reduce((acc, i) => acc + (Number(i.quantity) || 1), 0);
    }, 0);
  }, [renderableRooms, isLocked]);

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

  // All company identity in the document (logo, contact card, footer, social links, intro pages) comes from the
  // company's own settings; nothing here is hard-coded to one company.
  const content = useMemo(() => resolveProposalContent(company), [company]);
  // The faint watermark follows the company's accent; Whyte on its own rose theme keeps its original tint exactly.
  const { brandColor: customBrandColor, theme: brandTheme } = useCompanyBranding();
  const watermarkStyle =
    content.isDefaultCompany && !customBrandColor && brandTheme === "whyte-rose"
      ? { color: "rgba(212, 106, 140, 0.1)" }
      : { color: "var(--accent)", opacity: 0.1 };
  const hasIncludes = content.includes.length > 0 || configuredTiers.length > 0 || configuredFinishes.length > 0;

  const proposalPages = useMemo(() => {
    return paginateQuotation(quotation, content.introPages);
  }, [quotation, content.introPages]);

  const A4_WIDTH_MM = 210;
  const A4_HEIGHT_MM = 297;

  // Renders every proposal page into one A4 PDF. Shared by "Download PDF" and "Send by email", so the emailed
  // document is exactly the downloaded one.
  const buildPdf = async () => {
    // The page is scaled down for on-screen mobile display (see
    // `previewScale` above). The export must always be captured at full,
    // unscaled resolution — a PDF generated from a phone should look
    // identical to one generated from a desktop.
    //
    // On mobile devices, both the parent `.proposal-page-slot` and the page
    // wrapper can be constrained by the phone viewport width (e.g. 375px or
    // 390px). We explicitly unconstrain all slots and pages to exact fixed
    // A4 dimensions (794px width) before capturing, so no parent container
    // or mobile flexbox shrinks or clips the capture canvas.
    const pagesToRestore = pageRefs.current.filter((el): el is HTMLDivElement => el !== null);
    const slotsToRestore = pagesToRestore
      .map((el) => el.parentElement as HTMLElement | null)
      .filter((s): s is HTMLElement => s !== null);

    const prevPageTransforms = pagesToRestore.map((el) => el.style.transform);
    const prevPageWidths = pagesToRestore.map((el) => el.style.width);
    const prevSlotWidths = slotsToRestore.map((s) => s.style.width);
    const prevSlotHeights = slotsToRestore.map((s) => s.style.height);
    const prevSlotMaxWidths = slotsToRestore.map((s) => s.style.maxWidth);

    // Unconstrain slots and pages during capture
    for (const slot of slotsToRestore) {
      slot.style.width = `${PAGE_WIDTH_PX}px`;
      slot.style.height = "auto";
      slot.style.maxWidth = "none";
    }
    for (const el of pagesToRestore) {
      el.style.transform = "none";
      el.style.width = `${PAGE_WIDTH_PX}px`;
      el.style.minWidth = `${PAGE_WIDTH_PX}px`;
      el.style.maxWidth = `${PAGE_WIDTH_PX}px`;
    }

    try {
      if (typeof document !== "undefined" && document.fonts) {
        try {
          await document.fonts.ready;
        } catch {
          // proceed even if font ready promise rejects
        }
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

        // Ensure all images inside pageEl are fully DECODED before capturing
        const images = Array.from(pageEl.querySelectorAll("img"));
        await Promise.all(
          images.map(async (img) => {
            if (typeof img.decode === "function") {
              try {
                await img.decode();
                return;
              } catch {
                // fall through to load/error fallback below
              }
            }
            if (img.complete && img.naturalWidth > 0) return;
            return new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          })
        );

        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }

        const captureHeight = Math.max(PAGE_HEIGHT_PX, pageEl.offsetHeight || PAGE_HEIGHT_PX);

        // JPEG at pixelRatio: 2 with explicit width and canvas dimensions guarantees
        // identical cross-device output on desktop, Android, and iOS Safari without
        // relying on mobile viewport measurements.
        const dataUrl = await htmlToImage.toJpeg(pageEl, {
          pixelRatio: 2,
          quality: 0.88,
          backgroundColor: "#ffffff",
          cacheBust: true,
          width: PAGE_WIDTH_PX,
          height: captureHeight,
          canvasWidth: PAGE_WIDTH_PX * 2,
          canvasHeight: captureHeight * 2,
        });

        // Compute placement preserving aspect ratio:
        // Standard A4 aspect is 297 / 210 = 1.414285
        // PAGE_HEIGHT_PX / PAGE_WIDTH_PX = 1123 / 794 = 1.414357
        const aspect = captureHeight / PAGE_WIDTH_PX;
        const a4Aspect = A4_HEIGHT_MM / A4_WIDTH_MM;
        let drawWidth = A4_WIDTH_MM;
        let drawHeight = A4_HEIGHT_MM;
        let offsetX = 0;
        let offsetY = 0;

        if (aspect > a4Aspect + 0.02) {
          drawHeight = A4_HEIGHT_MM;
          drawWidth = A4_HEIGHT_MM / aspect;
          offsetX = (A4_WIDTH_MM - drawWidth) / 2;
        }

        pdf.addImage(dataUrl, "JPEG", offsetX, offsetY, drawWidth, drawHeight, undefined, "FAST");
      }

      return pdf;
    } finally {
      // Restore all slots and pages to their scaled layout
      for (let i = 0; i < pagesToRestore.length; i++) {
        pagesToRestore[i].style.transform = prevPageTransforms[i] || `scale(${previewScale})`;
        pagesToRestore[i].style.width = prevPageWidths[i] || "";
        pagesToRestore[i].style.minWidth = "";
        pagesToRestore[i].style.maxWidth = "";
      }
      for (let i = 0; i < slotsToRestore.length; i++) {
        slotsToRestore[i].style.width = prevSlotWidths[i] || "";
        slotsToRestore[i].style.height = prevSlotHeights[i] || "";
        slotsToRestore[i].style.maxWidth = prevSlotMaxWidths[i] || "";
      }
    }
  };

  const buildPdfBlob = async (): Promise<Blob> => (await buildPdf()).output("blob");

  const handleDownloadPDF = async () => {
    if (!quotation || pageRefs.current.length === 0) return;

    if (invalidGstinReason) {
      toast.error(`Cannot generate PDF: ${invalidGstinReason}`);
      return;
    }

    setDownloading(true);
    try {
      const pdf = await buildPdf();
      const filename = content.fileName(quotation.quotationNumber);

      const isIOS =
        typeof navigator !== "undefined" &&
        (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

      const pdfBlob = pdf.output("blob");

      // On iOS devices, attempt native Web Share API (Save to Files / AirDrop / share sheet)
      // to avoid WebKit download attribute suppression and gesture expiration issues.
      let sharedNatively = false;
      if (isIOS && typeof navigator !== "undefined" && navigator.canShare) {
        try {
          const pdfFile = new File([pdfBlob], filename, { type: "application/pdf" });
          if (navigator.canShare({ files: [pdfFile] })) {
            await navigator.share({
              files: [pdfFile],
              title: filename,
            });
            sharedNatively = true;
          }
        } catch (shareErr: unknown) {
          if ((shareErr as Error)?.name === "AbortError") {
            // User cancelled the native share sheet
            return;
          }
          console.warn("Native share failed, falling back to download link:", shareErr);
        }
      }

      if (!sharedNatively) {
        const blobUrl = URL.createObjectURL(pdfBlob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        if (isIOS) a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Prolong Blob URL validity (60s) so mobile browser download stream completes
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      }

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
      {/* Unavailable-catalog-reference warning — only rendered here when this
          component is NOT embedded in ProposalBuilder (which shows its own
          copy already). Informational, dismissible per visit, re-appears on
          the next load since nothing about it is persisted — see the
          matching comment on `unavailableItemLabels` above. Hidden from the
          actual exported PDF/print output, same as the header bar below. */}
      {isStandalonePreview && unavailableItemLabels.length > 0 && !unavailableBannerDismissed && (
        <div role="alert" className="max-w-3xl mx-auto mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">
              {isLockedForBanner
                ? "One or more products in this quotation are no longer available in the catalog."
                : "One or more products in this quotation are no longer available."}
            </p>
            <p className="text-xs text-amber-700 mt-0.5 break-words">
              {isLockedForBanner
                ? `This is informational only — the saved amounts on this ${quotation.status} quotation are unaffected. `
                : "They have been excluded from the totals below. "}
              {unavailableItemLabels.join(", ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUnavailableBannerDismissed(true)}
            className="shrink-0 p-1 rounded-lg hover:bg-amber-100 text-amber-600"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

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

          {/* Email the PDF and track its delivery (saved quotations only; local offline drafts cannot be sent). */}
          {quotation.id && !String(quotation.id).startsWith("draft_") && (
            <button
              type="button"
              onClick={() => setDeliveryOpen(true)}
              disabled={renderableRooms.length === 0 || !!invalidGstinReason}
              title={invalidGstinReason ?? "Email this quotation and track its delivery"}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition shadow-xs disabled:opacity-50"
            >
              <Mail size={14} />
              <span className="hidden sm:inline">Send by Email</span>
              <span className="sm:hidden">Send</span>
            </button>
          )}

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

      {deliveryOpen && quotation.id && (
        <QuotationDeliveryModal
          isOpen={deliveryOpen}
          onClose={() => setDeliveryOpen(false)}
          quotationId={String(quotation.id)}
          quotationNumber={quotation.quotationNumber}
          clientName={quotation.clientName}
          clientEmail={quotation.clientEmail ?? null}
          companyName={content.brandName}
          buildPdfBlob={buildPdfBlob}
        />
      )}

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
        <div ref={pagesWrapperRef} className="w-full flex flex-col items-center">
          {proposalPages.map((page, pageIdx) => (
            <div
              key={page.pageNumber}
              className="proposal-page-slot mb-8 print:mb-0"
              style={{
                width: PAGE_WIDTH_PX * previewScale,
                height: PAGE_HEIGHT_PX * previewScale,
              }}
            >
              <div
                ref={(el) => {
                  pageRefs.current[pageIdx] = el;
                }}
                className="proposal-page bg-white w-[794px] min-h-[1123px] rounded-xl border border-gray-200 shadow-md p-9 flex flex-col justify-between relative print:shadow-none print:border-none print:rounded-none print:m-0 print:p-8"
                style={{ boxSizing: "border-box", transform: `scale(${previewScale})`, transformOrigin: "top left" }}
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
                      fontSize: Math.max(60, 150 - Math.max(0, content.watermark.length - 6) * 8),
                      fontWeight: 900,
                      letterSpacing: "-0.02em",
                      ...watermarkStyle,
                      display: "inline-block",
                      transform: "rotate(-18deg)",
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {content.watermark}
                  </span>
                </div>
              )}

              {/* Page Content Area */}
              <div className="relative z-10 space-y-4">
                {/* Running Header on Page 2+ */}
                {!page.isFirstPage && (
                  <div className="pb-3 border-b border-gray-200 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2.5">
                      <ProposalLogo content={content} kind="header" />
                      <span className="text-gray-300">|</span>
                      <span className="font-semibold text-gray-700 text-sm">
                        {content.headerLabel}
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
                      <div key={sIdx} className="space-y-4">
                        {/* Header Brand Bar */}
                        <div className="flex items-start justify-between">
                          <ProposalLogo content={content} kind="cover" />
                          <div className="text-right">
                            <span className="text-[10px] font-mono tracking-widest text-gray-400 uppercase font-bold block">
                              {content.text.quotationReference}
                            </span>
                            <p className="text-base font-black font-mono tracking-tight text-gray-950">
                              {quotation.quotationNumber}
                            </p>
                            <p className="text-[13px] text-gray-500">
                              {formatDate(quotation.createdAt)}
                            </p>
                          </div>
                        </div>

                        {/* Title + Hero zone (a company's own cover picture sits beside the title) */}
                        <div className={content.coverImageUrl ? "flex items-start justify-between gap-5" : undefined}>
                          <div className="w-[320px] shrink-0 space-y-2 pt-1">
                            <ProposalCoverTitle title={content.text.coverTitle} />
                            <div className="h-[3px] w-[130px] rounded-full bg-gradient-to-r from-accent to-accent/0" />
                            <p className="text-[12px] font-bold uppercase tracking-widest text-gray-500">
                              {content.isDefaultCompany ? (
                                <>
                                  Next-Gen <span className="text-gray-950">Smart Living</span> Ecosystems
                                </>
                              ) : (
                                <span className="text-gray-950">{content.tagline ?? content.automationType}</span>
                              )}
                            </p>
                          </div>

                          {content.coverImageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element -- the PDF is rasterised from this DOM
                            <img
                              src={content.coverImageUrl}
                              alt={`${content.brandName} cover`}
                              crossOrigin="anonymous"
                              data-testid="cover-image"
                              className="h-[250px] w-[370px] rounded-2xl border border-gray-100 object-cover"
                            />
                          )}

                          {/* The cover illustration shows Whyte's own product: only the default company uses it, unless it set its own picture. */}
                          {content.isDefaultCompany && !content.coverImageUrl && (
                            <div className="-mt-[140px] flex justify-end">
                              <img
                                src="/proposal/whyte/cover-hero.webp"
                                alt="Whyte smart home and app control"
                                className="h-auto w-[600px] object-contain"
                              />
                            </div>
                          )}
                        </div>

                        {/* Project Overview: Compact & Premium 3-Row Layout */}
                        <div className="overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-xs text-sm">
                          {/* Row 1 — Client Information */}
                          <div className="px-5 py-3 bg-white">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">
                                  {content.text.preparedFor}
                                </p>
                                <h2 className="mt-0.5 text-lg font-bold tracking-tight text-gray-950 leading-snug break-words [overflow-wrap:anywhere]">
                                  {quotation.clientName}
                                </h2>
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
                                <MapPin size={12} className="text-accent shrink-0" />
                                <span className="font-medium text-gray-700 break-words">
                                  {quotation.clientAddress || content.text.siteFallback}
                                </span>
                              </div>
                            </div>
                            {(quotation.clientPhone || quotation.clientEmail) && (
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-gray-400">
                                {quotation.clientPhone && (
                                  <span>{quotation.clientPhone}</span>
                                )}
                                {quotation.clientPhone && quotation.clientEmail && (
                                  <span>•</span>
                                )}
                                {quotation.clientEmail && (
                                  <span className="break-all">{quotation.clientEmail}</span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Row 2 — Project Information (Compact 3-Column Layout) */}
                          <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100 bg-gray-50/50 py-2">
                            <div className="px-5 min-w-0">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                                {content.text.projectType}
                              </span>
                              <span className="mt-0.5 text-xs font-semibold text-gray-900 block truncate">
                                {quotation.houseType?.name ?? content.text.projectTypeFallback}
                              </span>
                            </div>

                            <div className="px-5 min-w-0">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                                {content.text.automationTypeLabel}
                              </span>
                              <span className="mt-0.5 text-xs font-semibold text-gray-900 block truncate">
                                {content.automationType}
                              </span>
                            </div>

                            <div className="px-5 min-w-0">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                                {content.text.projectScope}
                              </span>
                              <span className="mt-0.5 text-xs font-semibold text-gray-900 block">
                                {renderableRooms.length} {renderableRooms.length === 1 ? "Space" : "Spaces"} · {totalProducts} {totalProducts === 1 ? "Device" : "Devices"}
                              </span>
                            </div>
                          </div>

                          {/* Row 3 — Slim Investment Strip */}
                          <div className="px-5 py-2.5 bg-pink-50/40 border-t border-pink-100/70 flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-700">
                              {content.text.totalInvestment}
                            </span>
                            <span className="text-lg font-black font-mono tracking-tight text-accent leading-none">
                              {formatCurrency(grandTotal, { decimals: 2 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  /* 2b. ABOUT THE COMPANY (custom introduction page written in the company's settings) */
                  if (section.type === "about_company" && content.about) {
                    return <ProposalAboutCompany key={sIdx} about={content.about} />;
                  }

                  /* 2. ABOUT WHYTE (PAGE 2) */
                  if (section.type === "about_whyte") {
                    return (
                      <div key={sIdx} className="space-y-6">
                        {/* Section Header */}
                        <div
                          className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-pink-50 via-white to-slate-100"
                          style={{ minHeight: 250 }}
                        >
                          <img
                            src="/proposal/whyte/about-hero.webp"
                            alt=""
                            className="absolute right-0 top-0 h-full w-auto max-w-none object-cover object-right"
                          />
                          <div className="relative z-10 w-[58%] p-6">
                            <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                              Company Profile & Ecosystem
                            </span>
                            <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">
                              About Whyte Automations
                            </h2>
                            <p className="text-sm text-gray-700 mt-2 leading-relaxed">
                              Founded in Gandhinagar, Gujarat, Whyte Automations is
                              dedicated to bringing the next generation of smart
                              living to modern premises through the Internet of
                              Things, intuitive touch architecture, and intelligent
                              power management.
                            </p>
                          </div>
                        </div>

                        {/* Proven Milestone Statistics */}
                        <div className="grid grid-cols-4 gap-3 text-center">
                          <div className="p-4 rounded-2xl bg-white border border-pink-200/90 shadow-2xs flex flex-col items-center justify-center">
                            <p className="text-3xl font-extrabold text-[#ef4370] tracking-tight">
                              1000+
                            </p>
                            <p className="text-[11px] uppercase tracking-wider text-gray-900 font-bold mt-1">
                              INSTALLATIONS
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-white border border-gray-200/90 shadow-2xs flex flex-col items-center justify-center">
                            <p className="text-3xl font-extrabold text-[#ef4370] tracking-tight">
                              89000+
                            </p>
                            <p className="text-[11px] uppercase tracking-wider text-gray-900 font-bold mt-1">
                              SWITCHES
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-white border border-gray-200/90 shadow-2xs flex flex-col items-center justify-center">
                            <p className="text-3xl font-extrabold text-[#ef4370] tracking-tight">
                              50+
                            </p>
                            <p className="text-[11px] uppercase tracking-wider text-gray-900 font-bold mt-1">
                              PRODUCTS
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-white border border-gray-200/90 shadow-2xs flex flex-col items-center justify-center">
                            <p className="text-3xl font-extrabold text-[#ef4370] tracking-tight">
                              25+
                            </p>
                            <p className="text-[11px] uppercase tracking-wider text-gray-900 font-bold mt-1">
                              FEATURES
                            </p>
                          </div>
                        </div>

                        {/* Bespoke Premise Solutions */}
                        <div className="space-y-2.5">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-950">
                            Bespoke Automation Solutions
                          </h3>
                          <div className="grid grid-cols-4 gap-2.5">
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
                            <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 border-l-[3px] border-l-accent space-y-1">
                              <div className="flex items-center gap-1.5 font-bold text-gray-950">
                                <ShieldCheck size={14} className="text-gray-950" />
                                <span>5* Years Limited Warranty</span>
                              </div>
                              <p className="text-[13px] text-gray-500 leading-relaxed">
                                Backed by Whyte comprehensive hardware warranty
                                and dedicated support for long-term reliability.
                              </p>
                            </div>

                            <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 border-l-[3px] border-l-accent space-y-1">
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
                        <div
                          className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-pink-50 via-white to-slate-100"
                          style={{ minHeight: 200 }}
                        >
                          <img
                            src="/proposal/whyte/overview-hero.webp"
                            alt=""
                            className="absolute right-0 top-0 h-full w-auto max-w-none object-cover object-right"
                          />
                          <div className="relative z-10 w-[55%] p-6">
                            <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                              Specification & Scope
                            </span>
                            <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">
                              Your Project Overview
                            </h2>
                            <p className="text-sm text-gray-700 mt-1">
                              Tailored smart automation configuration designed for{" "}
                              <strong className="text-gray-950">
                                {quotation.clientName}
                              </strong>
                              .
                            </p>
                          </div>
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
                                const count = eligibleItemsOfRoom(r, r.items, isLocked).reduce(
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
                                      {getRoomFullTitle(r, renderableRooms, isMultiFloorHouseType(quotation.houseType))}
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
                          <div className="grid grid-cols-3 gap-2.5 text-sm">
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
                    const roomSubtotal = eligibleItemsOfRoom(room, room.items, isLocked).reduce(
                      (acc, i) =>
                        acc + Number(i.unitPrice || 0) * (i.quantity || 1),
                      0
                    );
                    const isMultiFloor = isMultiFloorHouseType(quotation.houseType);
                    // Flats have no floors: the label is hidden, the stored floor value is untouched.
                    const floorLocation = getRoomFloorLabel(room, renderableRooms, isMultiFloor);
                    const deviceCount = eligibleItemsOfRoom(room, room.items, isLocked).reduce(
                      (acc, i) => acc + (Number(i.quantity) || 1),
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
                                {content.text.productsEyebrow}
                              </span>
                              <h2 className="text-3xl font-black text-gray-950 tracking-tight mt-0.5">
                                {content.text.productsTitle}
                              </h2>
                            </div>
                            <p className="text-[13px] text-gray-500 font-medium text-right max-w-xs">
                              {content.text.productsSubtitle}
                            </p>
                          </div>
                        )}

                        {/* One bordered room container with a pink left accent: header, product rows separated by hairlines, subtotal. No nested boxes. */}
                        <div className="rounded-xl overflow-hidden border border-gray-200 border-l-4 border-l-accent bg-white -mb-1">
                          {showRoomHeader && (
                            <div className="flex items-center justify-between gap-4 p-3 border-b border-gray-200">
                              <div className="flex items-center gap-4 min-w-0 flex-1">
                                <RoomHeaderImage
                                  room={room}
                                  renderableRooms={renderableRooms}
                                  fallbackIcon={Icon}
                                  large
                                />
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Icon size={17} className="text-accent shrink-0" />
                                    <h3 className="font-extrabold text-gray-950 text-xl uppercase tracking-wider truncate">
                                      {getRoomDisplayName(room, renderableRooms)}
                                    </h3>
                                  </div>
                                  {floorLocation ? (
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{floorLocation}</p>
                                  ) : (
                                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{content.text.spaceCaption}</p>
                                  )}
                                </div>
                              </div>
                              <p className="shrink-0 text-right leading-none">
                                <span className="block font-mono text-2xl font-black text-accent">{deviceCount}</span>
                                <span className="block mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                  {deviceCount === 1 ? "device" : "devices"}
                                </span>
                              </p>
                            </div>
                          )}

                          {isContinuation && (
                            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-200 bg-gray-50/60 text-xs font-bold uppercase tracking-wider text-gray-600">
                              <span className="flex items-center gap-2 min-w-0">
                                <Icon size={13} className="text-accent shrink-0" />
                                <span className="truncate">{getRoomFullTitle(room, renderableRooms, isMultiFloor)}</span>
                              </span>
                              <span className="shrink-0 text-[10px] uppercase tracking-widest text-accent">{content.text.continuedBadge}</span>
                            </div>
                          )}

                          {showRoomHeader && !isLocked && room.isUnavailable && (
                            <div className="px-4 py-1.5 border-b border-amber-100">
                              <UnavailabilityWarning
                                reason={room.unavailableReason}
                                label={getRoomDisplayName(room, renderableRooms)}
                              />
                            </div>
                          )}

                          {showRoomHeader && room.notes && (
                            <div className="px-4 py-1.5 border-b border-amber-100 text-[13px] text-amber-900">
                              <span className="font-semibold">{content.text.spaceNote}: </span>
                              {room.notes}
                            </div>
                          )}

                          {items.length > 0 && (
                            <div className="divide-y divide-gray-100 px-4">
                              {items.map((row, itemIdx) => {
                                const item = row.item;
                                const isGrouped = row.entries.length > 1;
                                const unitPrice = Number(item.unitPrice || 0);
                                const formattedName = formatProposalProductName(item.product?.name);
                                const moduleSize = getItemModuleSize(item);
                                const finish = getItemFinish(item, quotation);
                                const color = getItemColor(item);
                                const tier = getItemTier(item, quotation);
                                const connectivity = getItemConnectivity(item);
                                const sbLabel = item.sbNumber?.trim();
                                const imgUrl = getItemImageUrl(item);
                                const location = getItemLocation(item);
                                const excluded = !isLocked && (room.isUnavailable || item.isUnavailable);
                                const chipClass =
                                  "text-[11px] font-semibold text-gray-600 bg-gray-100/80 px-2 py-0.5 rounded-full";

                                return (
                                  <div
                                    key={row.key || itemIdx}
                                    className="flex items-center gap-5 py-3"
                                    style={{ minHeight: PRODUCT_ROW_MIN_PX }}
                                  >
                                    {/* The product itself, straight on white: no frame, no grey tile, never cropped or stretched */}
                                    <div
                                      className="shrink-0 flex items-center justify-center"
                                      style={{ width: PRODUCT_IMAGE_PX, height: PRODUCT_IMAGE_PX }}
                                    >
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
                                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 text-gray-300">
                                          <Package size={28} />
                                          <span className="text-[9px] font-semibold uppercase tracking-wider">{content.text.noImage}</span>
                                        </div>
                                      )}
                                    </div>

                                    <div className="min-w-0 flex-1 space-y-1.5">
                                      <div className="flex items-start gap-2 min-w-0">
                                        {sbLabel && (
                                          <span className="font-mono text-[11px] font-bold text-accent shrink-0 mt-[3px] tracking-wide">
                                            {sbLabel}
                                          </span>
                                        )}
                                        <p className="font-bold text-gray-950 text-[15px] leading-snug break-words min-w-0">
                                          {formattedName}
                                        </p>
                                        {!isLocked && !room.isUnavailable && item.isUnavailable && (
                                          <UnavailabilityWarning reason={item.unavailableReason} compact />
                                        )}
                                      </div>

                                      {(moduleSize || finish || color || tier || connectivity) && (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          {moduleSize && <span className={chipClass}>{moduleSize}</span>}
                                          {finish && <span className={`${chipClass} capitalize`}>{finish}</span>}
                                          {color && <span className={`${chipClass} capitalize`}>{color}</span>}
                                          {tier && (
                                            <span className="text-[11px] font-semibold text-accent-foreground bg-accent-light px-2 py-0.5 rounded-full capitalize">
                                              {tier}
                                            </span>
                                          )}
                                          {connectivity && <span className={`${chipClass} uppercase`}>{connectivity}</span>}
                                        </div>
                                      )}

                                      {!isGrouped && location && (
                                        <p className="flex items-start gap-1.5 text-[13px] text-gray-600 break-words">
                                          <MapPin size={13} className="text-accent shrink-0 mt-0.5" />
                                          <span>
                                            <span className="text-gray-400">{content.text.locationLabel}: </span>
                                            <span className="font-semibold text-gray-900">{location}</span>
                                          </span>
                                        </p>
                                      )}

                                      {/* Several entries of this product in the room: every distinct location, with its units. */}
                                      {isGrouped &&
                                        row.locations.map((entryLocation, locationIdx) => {
                                          const { prefix, text } = formatRowLocation(
                                            entryLocation.label,
                                            entryLocation.quantity,
                                            row.locations.length > 1
                                          );
                                          return (
                                            <p
                                              key={`${row.key}-location-${locationIdx}`}
                                              className="flex items-start gap-1.5 text-[13px] text-gray-600 break-words"
                                            >
                                              <MapPin size={13} className="text-accent shrink-0 mt-0.5" />
                                              <span>
                                                {prefix && <span className="text-gray-400">{prefix}</span>}
                                                <span
                                                  className={entryLocation.label === null ? "text-gray-400" : "font-semibold text-gray-900"}
                                                >
                                                  {text}
                                                </span>
                                              </span>
                                            </p>
                                          );
                                        })}
                                    </div>

                                    {/* Quantity and unit price, right-aligned. Struck through when this item/room is excluded from the totals. */}
                                    <div className="shrink-0 w-32 text-right space-y-1">
                                      <p className="font-mono font-bold text-gray-500 text-sm leading-none">
                                        Qty <span className="text-gray-950 text-lg font-extrabold">{row.quantity}</span>
                                      </p>
                                      <p
                                        className={`font-mono font-extrabold text-lg leading-none ${
                                          excluded ? "text-gray-400 line-through" : "text-gray-950"
                                        }`}
                                      >
                                        {formatCurrency(unitPrice)}
                                      </p>
                                      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{content.text.perUnit}</p>
                                      {/* Grouped entries: the sum of each entry's own line total. */}
                                      {isGrouped && (
                                        <p
                                          className={`font-mono text-[13px] font-bold leading-none pt-0.5 ${
                                            excluded ? "text-gray-400 line-through" : "text-gray-700"
                                          }`}
                                        >
                                          <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{content.text.lineTotal} </span>
                                          {formatCurrency(row.lineTotal)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Room subtotal: its own distinct strip, always on the same page as the last product row */}
                          {!showRoomFooter && items.length > 0 && (
                            <div className="px-4 py-1.5 border-t border-gray-100 text-right text-[10px] font-bold uppercase tracking-widest text-gray-400">
                              {content.text.continuedNote}
                            </div>
                          )}
                          {showRoomFooter && items.length > 0 && (
                            <div className="flex justify-between items-center px-4 py-3 border-t border-gray-200 bg-accent-light/50 text-sm font-bold text-gray-900">
                              <span className="uppercase tracking-wider text-[12px]">
                                {getRoomDisplayName(room, renderableRooms)} Subtotal
                              </span>
                              <span className="font-mono font-extrabold text-gray-950 text-base">
                                {formatCurrency(roomSubtotal)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  /* 6. FINANCIAL SUMMARY, INVESTMENT CALLOUT, TERMS & OFFICIAL WHYTE CLOSING */
                  if (section.type === "closing_and_financials") {
                    return (
                      <div key={sIdx} className="space-y-2">
                        {/* Section Header — same eyebrow + h2 pattern as every other page. */}
                        <div>
                          <span className="text-[11px] uppercase tracking-widest text-accent font-bold block">
                            {content.text.closingEyebrow}
                          </span>
                          <h2 className="text-2xl font-black text-gray-950 tracking-tight mt-0.5">
                            {content.text.closingTitle}
                          </h2>
                        </div>

                        {/* Financial Summary */}
                        <div className="space-y-1.5">
                          <div className="pb-1 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="text-base font-bold uppercase tracking-wider text-gray-950">
                              {content.text.financialSummary}
                            </h3>
                            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                              {content.text.investmentOverview}
                            </span>
                          </div>

                          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50/50 space-y-1.5 text-sm">
                            {/* Subtotal */}
                            <div className="flex justify-between items-center text-gray-600">
                              <span className="font-medium text-gray-600">{content.text.subtotal}</span>
                              <span className="font-mono font-medium text-gray-900">
                                {formatCurrency(grossSubtotal, { decimals: 2 })}
                              </span>
                            </div>

                            {/* Discount — hidden entirely when there is none */}
                            {clampedDiscount > 0 && (
                              <div className="flex justify-between items-center text-gray-600">
                                <span className="flex items-center gap-1.5 font-medium text-gray-600">
                                  <span>{content.text.discount}</span>
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
                                <span className="font-bold text-gray-950 block text-base">{content.text.netSubtotal}</span>
                                <span className="text-[11px] text-gray-400 font-medium">{content.text.netSubtotalNote}</span>
                              </div>
                              <span className="font-mono font-bold text-gray-950 text-lg">
                                {formatCurrency(netSubtotal, { decimals: 2 })}
                              </span>
                            </div>

                            {/* Tax Summary Box */}
                            <div className="p-3 rounded-lg bg-white border border-gray-200/80 space-y-1.5">
                              <div className="flex items-center justify-between pb-1 border-b border-gray-100">
                                <span className="text-[11px] uppercase font-bold tracking-wider text-gray-500">
                                  {content.text.taxSummary}
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
                                  {content.text.grandTotal}
                                </span>
                                <span className="text-[11px] text-gray-400">
                                  {content.text.grandTotalNote}
                                </span>
                              </div>
                              <span className="text-2xl font-black font-mono text-gray-950 tracking-tight">
                                {formatCurrency(grandTotal, { decimals: 2 })}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Final Investment Callout */}
                        <div className="p-3 rounded-2xl border border-accent-border/80 bg-accent-light/40 text-center space-y-0.5">
                          <p className="text-[11px] uppercase font-bold tracking-widest text-accent">
                            {content.text.estimateTitle}
                          </p>
                          <p className="text-2xl font-black font-mono tracking-tight text-gray-950">
                            {formatCurrency(grandTotal, { decimals: 2 })}
                          </p>
                          <p className="text-[13px] text-gray-500">
                            {content.text.estimateNote}
                          </p>
                        </div>

                        {/* Proposal Includes & Commercial Information */}
                        <div className={`grid gap-3 text-sm ${hasIncludes ? "grid-cols-2" : "grid-cols-1"}`}>
                          {/* Proposal Includes (the company's lines + this quotation's selections) */}
                          <ProposalIncludes content={content} tiers={configuredTiers} finishes={configuredFinishes} />

                          {/* Commercial Terms & Validity */}
                          <div className="p-3 rounded-xl border border-gray-200 bg-white space-y-1">
                            <h4 className="font-bold uppercase tracking-wider text-gray-900 text-[11px]">
                              {content.text.termsTitle}
                            </h4>
                            <div className="space-y-1 text-[13px] text-gray-600">
                              <p>
                                <strong className="text-gray-900">
                                  {content.text.validityLabel}:{" "}
                                </strong>
                                {proposalValidityText(content, quotation.validUntil, formatDate)}
                              </p>
                              {(quotation.terms || content.defaultTerms) && (
                                <p>
                                  <strong className="text-gray-900">
                                    {content.text.termsLabel}:{" "}
                                  </strong>
                                  {quotation.terms || content.defaultTerms}
                                </p>
                              )}
                              {quotation.notes && (
                                <p>
                                  <strong className="text-gray-900">
                                    {content.text.remarksLabel}:{" "}
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

                        {/* Next Steps (the company's own steps; hidden when it has none) */}
                        <ProposalNextSteps content={content} />

                        {/* Closing & contact card: the company's own details */}
                        <ProposalContactCard content={content} />
                      </div>
                    );
                  }

                  return null;
                })}
              </div>

              {/* Document Footer on Every Page */}
              <ProposalPageFooter content={content} pageNumber={page.pageNumber} totalPages={page.totalPages} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
