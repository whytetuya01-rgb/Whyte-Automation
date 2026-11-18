"use client";

import React from "react";
import {
  Building2,
  Mail,
  MapPin,
  Phone,
  User,
  Table,
  Receipt,
  Percent,
  Landmark,
  FileText,
  FileCheck2,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { Quotation, Company, QuotationRoom, QuotationItem } from "@/types";
import type {
  DocumentSectionDefinition,
  DocumentBlockDefinition,
  QuotationTemplate,
} from "@/types/template";
import WhyteLogo from "@/components/shared/WhyteLogo";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { getItemImageUrl, getItemFinish } from "./StepProposalPreview";

interface DynamicDocumentSectionRendererProps {
  section: DocumentSectionDefinition;
  blocks: DocumentBlockDefinition[];
  quotation: Quotation;
  company?: Company | null;
  effectiveTemplate?: QuotationTemplate | null;
}

export default function DynamicDocumentSectionRenderer({
  section,
  blocks,
  quotation,
  company,
  effectiveTemplate,
}: DynamicDocumentSectionRendererProps) {
  const customFieldValues = quotation.customFieldValues || {};
  const columns = section.columns || 1;

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Section Header (if titled and not cover) */}
      {section.title && section.id !== "sec_demo_cover" && (
        <div className="pb-2 border-b border-gray-200/80 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{
                backgroundColor:
                  effectiveTemplate?.layoutSettings?.accentColor || "#0f766e",
              }}
            />
            {section.title}
          </h2>
        </div>
      )}

      {/* Grid of Blocks */}
      <div
        className={cn(
          "grid gap-4 items-start",
          columns === 1 && "grid-cols-1",
          columns === 2 && "grid-cols-1 md:grid-cols-2",
          columns === 3 && "grid-cols-1 md:grid-cols-3"
        )}
      >
        {blocks.map((block) => (
          <DocumentBlockItem
            key={block.id}
            block={block}
            quotation={quotation}
            company={company}
            customFieldValues={customFieldValues}
            effectiveTemplate={effectiveTemplate}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// INDIVIDUAL BLOCK RENDERER
// ---------------------------------------------------------------------------

interface DocumentBlockItemProps {
  block: DocumentBlockDefinition;
  quotation: Quotation;
  company?: Company | null;
  customFieldValues: Record<string, any>;
  effectiveTemplate?: QuotationTemplate | null;
}

function DocumentBlockItem({
  block,
  quotation,
  company,
  customFieldValues,
  effectiveTemplate,
}: DocumentBlockItemProps) {
  const { layout } = block;
  const colSpanClass =
    layout?.width === "full"
      ? "col-span-full"
      : layout?.width === "half"
      ? "md:col-span-1"
      : layout?.width === "two_thirds"
      ? "md:col-span-2"
      : "col-span-1";

  const paddingClass =
    layout?.padding === "none"
      ? "p-0"
      : layout?.padding === "compact"
      ? "p-2.5"
      : layout?.padding === "relaxed"
      ? "p-6"
      : "p-4";

  const alignClass =
    layout?.alignment === "center"
      ? "text-center items-center justify-center"
      : layout?.alignment === "right"
      ? "text-right items-end justify-end"
      : "text-left items-start justify-start";

  const customStyle: React.CSSProperties = {
    backgroundColor: layout?.backgroundColor || undefined,
    color: layout?.textColor || undefined,
    borderColor: layout?.borderColor || undefined,
    marginTop: layout?.marginTop ? `${layout.marginTop}px` : undefined,
    marginBottom: layout?.marginBottom ? `${layout.marginBottom}px` : undefined,
  };

  switch (block.type) {
    // 1. HEADING BLOCK
    case "heading": {
      const level = block.level || 2;
      return (
        <div className={cn(colSpanClass, alignClass)} style={customStyle}>
          {level === 1 && (
            <h1 className="text-2xl font-black text-gray-950 tracking-tight">
              {block.title}
            </h1>
          )}
          {level === 2 && (
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
              {block.title}
            </h2>
          )}
          {level === 3 && (
            <h3 className="text-base font-bold text-gray-900">{block.title}</h3>
          )}
          {level === 4 && (
            <h4 className="text-sm font-bold text-gray-900">{block.title}</h4>
          )}
        </div>
      );
    }

    // 2. PARAGRAPH BLOCK
    case "paragraph":
      return (
        <div className={cn(colSpanClass, alignClass)} style={customStyle}>
          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">
            {block.content}
          </p>
        </div>
      );

    // 3. HERO BANNER BLOCK
    case "banner":
      return (
        <div
          className={cn(colSpanClass, "rounded-2xl p-6 shadow-sm overflow-hidden text-white")}
          style={{
            backgroundColor:
              layout?.backgroundColor ||
              effectiveTemplate?.layoutSettings?.primaryColor ||
              "#0f766e",
            color: layout?.textColor || "#ffffff",
            ...customStyle,
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono tracking-widest uppercase opacity-80 font-bold block mb-1">
                Whyte Smart Automation Systems
              </span>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">
                {block.title || "ARCHITECTURAL AUTOMATION PROPOSAL"}
              </h1>
              {block.content && (
                <p className="text-xs mt-1.5 opacity-90 leading-relaxed max-w-xl">
                  {block.content}
                </p>
              )}
            </div>
            <div className="hidden sm:block opacity-90">
              <WhyteLogo theme="dark" size="document-cover" />
            </div>
          </div>
        </div>
      );

    // 4. IMAGE BLOCK
    case "image":
      return (
        <div className={cn(colSpanClass, alignClass, "space-y-1.5")} style={customStyle}>
          {block.imageUrl ? (
            <div className="rounded-2xl overflow-hidden border border-gray-200/90 shadow-2xs bg-gray-50 flex justify-center">
              <img
                src={block.imageUrl}
                alt={block.imageAlt || "Proposal Image"}
                className="w-full max-h-[380px] object-contain rounded-xl"
                crossOrigin="anonymous"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          ) : (
            <div className="w-full h-40 rounded-2xl border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-400 text-xs">
              <ImageIcon size={28} className="text-gray-300 mb-1" />
              <span>Image placeholder</span>
            </div>
          )}
          {block.imageAlt && (
            <p className="text-[11px] text-gray-500 italic text-center block">
              {block.imageAlt}
            </p>
          )}
        </div>
      );

    // 5. COMPANY LOGO BLOCK
    case "company_logo":
      return (
        <div className={cn(colSpanClass, alignClass, "py-2")} style={customStyle}>
          {company?.logoUrl ? (
            <CompanyLogo
              src={company.logoUrl}
              name={company.name}
              variant="header"
              chipHeight={44}
            />
          ) : (
            <WhyteLogo theme="light" size="document-cover" />
          )}
        </div>
      );

    // 6. SPACER BLOCK
    case "spacer":
      return (
        <div
          className={cn(colSpanClass)}
          style={{
            height: `${Math.max(12, (layout?.marginTop || 16) + (layout?.marginBottom || 16))}px`,
          }}
        />
      );

    // 7. DIVIDER BLOCK
    case "divider":
      return (
        <div className={cn(colSpanClass, "py-2")}>
          <hr
            className="border-t border-gray-200"
            style={{ borderColor: layout?.borderColor }}
          />
        </div>
      );

    // 8. CUSTOM FIELD DATA BINDING (Phase 4 Core Requirement)
    case "custom_field_display": {
      const fieldKey = block.fieldKey || "";
      const rawVal =
        customFieldValues[fieldKey] ??
        (quotation as any)[fieldKey] ??
        (fieldKey === "leadArchitect" ? "Zaha Studio Associates" : null);

      const displayVal =
        rawVal !== null && rawVal !== undefined
          ? Array.isArray(rawVal)
            ? rawVal.join(", ")
            : typeof rawVal === "boolean"
            ? rawVal
              ? "Yes"
              : "No"
            : String(rawVal)
          : "Not Specified";

      const label = block.displayLabel || block.title || fieldKey;
      const renderMode = block.renderMode || "keyValue";

      // Render as Badge
      if (renderMode === "badge") {
        return (
          <div className={cn(colSpanClass, alignClass)} style={customStyle}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
              {label}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200 shadow-2xs">
              <Sparkles size={11} className="text-teal-600" />
              {displayVal}
            </span>
          </div>
        );
      }

      // Render as Image / Blueprint
      if (renderMode === "image" || renderMode === "full_page_annexure") {
        const imgSrc =
          typeof rawVal === "string" && (rawVal.startsWith("/") || rawVal.startsWith("http"))
            ? rawVal
            : "/whyte_catalog_images/panels/smart-panel-touch.webp";

        return (
          <div
            className={cn(
              colSpanClass,
              "rounded-2xl border border-gray-200 bg-white p-4 shadow-2xs space-y-2",
              renderMode === "full_page_annexure" && "col-span-full"
            )}
            style={customStyle}
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <div className="flex items-center gap-2">
                <FileCheck2 size={16} className="text-teal-600" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                  {label}
                </h4>
              </div>
              <span className="text-[10px] font-mono text-gray-400">
                Architectural Drawing • Rev 1
              </span>
            </div>

            <div className="rounded-xl overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center p-2">
              <img
                src={imgSrc}
                alt={label}
                className="max-h-[380px] w-full object-contain rounded-lg"
                crossOrigin="anonymous"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>

            <p className="text-[11px] text-gray-500 italic text-center">
              Conduit routing and technical floor specs verified on site.
            </p>
          </div>
        );
      }

      // Render as Key-Value Card (Default)
      return (
        <div
          className={cn(
            colSpanClass,
            paddingClass,
            "rounded-xl border border-gray-200/90 bg-gray-50/70 shadow-2xs space-y-1"
          )}
          style={customStyle}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
            {label}
          </span>
          <span className="text-xs font-bold text-gray-900 block truncate">
            {displayVal}
          </span>
        </div>
      );
    }

    // 9. CUSTOMER DETAILS BLOCK
    case "customer_details":
      return (
        <div
          className={cn(
            colSpanClass,
            paddingClass,
            "rounded-xl border border-gray-200 bg-white shadow-2xs space-y-2"
          )}
          style={customStyle}
        >
          <div className="flex items-center gap-1.5 border-b border-gray-100 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <User size={13} className="text-gray-500" />
            <span>{block.title || "Client Information"}</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="font-bold text-gray-950 text-sm">
              {quotation.clientName || "Respected Client"}
            </div>
            {(quotation.clientAddress || quotation.customer?.siteAddress) && (
              <div className="flex items-center gap-1.5 text-gray-600 text-[11px]">
                <MapPin size={11} className="shrink-0 text-gray-400" />
                <span className="truncate">
                  {quotation.clientAddress || quotation.customer?.siteAddress}
                </span>
              </div>
            )}
            {quotation.clientEmail && (
              <div className="flex items-center gap-1.5 text-gray-600 text-[11px]">
                <Mail size={11} className="shrink-0 text-gray-400" />
                <span>{quotation.clientEmail}</span>
              </div>
            )}
            {quotation.clientPhone && (
              <div className="flex items-center gap-1.5 text-gray-600 text-[11px]">
                <Phone size={11} className="shrink-0 text-gray-400" />
                <span>{quotation.clientPhone}</span>
              </div>
            )}
          </div>
        </div>
      );

    // 10. PROJECT DETAILS BLOCK
    case "project_details":
      return (
        <div
          className={cn(
            colSpanClass,
            paddingClass,
            "rounded-xl border border-gray-200 bg-white shadow-2xs space-y-2"
          )}
          style={customStyle}
        >
          <div className="flex items-center gap-1.5 border-b border-gray-100 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <Building2 size={13} className="text-gray-500" />
            <span>{block.title || "Project Parameters"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-gray-400 block">Quotation Ref:</span>
              <span className="font-mono font-bold text-gray-900 text-xs">
                {quotation.quotationNumber}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-gray-400 block">Date Issued:</span>
              <span className="font-semibold text-gray-900 text-xs">
                {formatDate(quotation.createdAt)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-gray-400 block">Property Type:</span>
              <span className="font-semibold text-gray-900 text-xs">
                {quotation.houseType?.name || quotation.premisesName || "Residential Villa"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-gray-400 block">Revision:</span>
              <span className="font-semibold text-gray-900 text-xs">
                Rev {quotation.revision ?? 1}
              </span>
            </div>
          </div>
        </div>
      );

    // 11. ROOM BREAKDOWN BLOCK
    case "room_breakdown": {
      const rooms = quotation.rooms || [];
      return (
        <div className={cn(colSpanClass, "space-y-3")} style={customStyle}>
          {block.title && (
            <h3 className="text-sm font-bold text-gray-900">{block.title}</h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {rooms.map((room: QuotationRoom, idx: number) => {
              const itemCount = (room.items || []).reduce(
                (sum, it) => sum + (Number(it.quantity) || 0),
                0
              );
              return (
                <div
                  key={room.id || idx}
                  className="p-3 bg-white rounded-xl border border-gray-200/90 shadow-2xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-900 truncate">
                      {room.customName || room.roomType?.name || `Space ${idx + 1}`}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">
                      {itemCount} devices
                    </span>
                  </div>
                  {room.subArea && (
                    <span className="text-[10px] text-gray-500 block">
                      {room.subArea}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 12. PRODUCT SPECIFICATION TABLE BLOCK
    case "product_table": {
      const rooms = quotation.rooms || [];
      const cols = effectiveTemplate?.configurableColumns;
      return (
        <div
          className={cn(colSpanClass, "space-y-4 rounded-2xl bg-white border border-gray-200 p-4 shadow-2xs overflow-hidden")}
          style={customStyle}
        >
          {block.title && (
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Table size={15} className="text-primary" />
                {block.title}
              </h3>
              <span className="text-[10px] font-mono text-gray-400 uppercase">
                Hardware BOM
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] font-bold text-gray-600">
                  {cols?.showProductImage !== false && (
                    <th className="py-2.5 px-3 w-12 text-center">Image</th>
                  )}
                  <th className="py-2.5 px-3">Item Description</th>
                  {cols?.showProductCode !== false && (
                    <th className="py-2.5 px-3">Model Code</th>
                  )}
                  {cols?.showSurfaceFinish !== false && (
                    <th className="py-2.5 px-3">Finish</th>
                  )}
                  <th className="py-2.5 px-3 text-center w-16">Qty</th>
                  {cols?.showUnitPrice !== false && (
                    <th className="py-2.5 px-3 text-right">Unit Price</th>
                  )}
                  {cols?.showLineTotal !== false && (
                    <th className="py-2.5 px-3 text-right">Line Total</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rooms.flatMap((room: QuotationRoom) =>
                  (room.items || []).map((item: QuotationItem, iIdx: number) => {
                    const imgUrl = getItemImageUrl(item);
                    const finish = getItemFinish(item, quotation);
                    const qty = Number(item.quantity) || 1;
                    const unitPrice = Number(item.unitPrice) || 0;
                    const lineTotal = Number(item.linePrice ?? (qty * unitPrice));

                    return (
                      <tr key={item.id || `${room.id}_${iIdx}`} className="hover:bg-gray-50/50">
                        {cols?.showProductImage !== false && (
                          <td className="py-2 px-3 text-center">
                            {imgUrl ? (
                              <img
                                src={imgUrl}
                                alt={item.product?.name || "Product"}
                                className="w-8 h-8 object-cover rounded mx-auto border border-gray-100"
                                crossOrigin="anonymous"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
                                <ImageIcon size={12} />
                              </div>
                            )}
                          </td>
                        )}
                        <td className="py-2 px-3">
                          <span className="font-semibold text-gray-900 block">
                            {item.product?.name || "Automation Device"}
                          </span>
                          <span className="text-[10px] text-gray-400 block">
                            Room: {room.customName || room.roomType?.name || "Space"}
                          </span>
                        </td>
                        {cols?.showProductCode !== false && (
                          <td className="py-2 px-3 font-mono text-[11px] text-gray-600">
                            {item.product?.code || "WHYTE-MOD"}
                          </td>
                        )}
                        {cols?.showSurfaceFinish !== false && (
                          <td className="py-2 px-3 text-[11px] text-gray-600">
                            {finish || "Matte Black"}
                          </td>
                        )}
                        <td className="py-2 px-3 text-center font-bold text-gray-900">
                          {qty}
                        </td>
                        {cols?.showUnitPrice !== false && (
                          <td className="py-2 px-3 text-right font-mono text-gray-700">
                            {formatCurrency(unitPrice)}
                          </td>
                        )}
                        {cols?.showLineTotal !== false && (
                          <td className="py-2 px-3 text-right font-mono font-bold text-gray-900">
                            {formatCurrency(lineTotal)}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // 13. PRICING SUMMARY BLOCK
    case "pricing_summary": {
      const grossSubtotal = Number(quotation.subtotal || 450000);
      const discountAmount = Number(quotation.discountAmount || 0);
      const netSubtotal = Number(quotation.netSubtotal || (grossSubtotal - discountAmount));
      const grandTotal = Number(quotation.grandTotal || quotation.totalAmount || (netSubtotal * 1.18));

      return (
        <div
          className={cn(
            colSpanClass,
            paddingClass,
            "rounded-2xl border border-gray-200 bg-white shadow-2xs space-y-3"
          )}
          style={customStyle}
        >
          <div className="flex items-center gap-1.5 border-b border-gray-100 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <Receipt size={14} className="text-gray-500" />
            <span>{block.title || "Commercial Investment Summary"}</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-gray-600">
              <span>Hardware & Configuration Subtotal</span>
              <span className="font-mono">{formatCurrency(grossSubtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600 font-semibold">
                <span>Special Project Discount</span>
                <span className="font-mono">- {formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Taxable Net Commercials</span>
              <span className="font-mono">{formatCurrency(netSubtotal)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-gray-200 text-sm font-black text-gray-900">
              <span>Grand Total (All-Inclusive)</span>
              <span className="text-base text-primary font-mono font-bold">
                {formatCurrency(grandTotal)}
              </span>
            </div>
          </div>
        </div>
      );
    }

    // 14. GST & DISCOUNTS BLOCK
    case "gst_and_discounts": {
      const cgst = Number(quotation.cgstAmount || 0);
      const sgst = Number(quotation.sgstAmount || 0);
      const totalGst = Number(quotation.totalGstAmount || (cgst + sgst) || 74600);

      return (
        <div
          className={cn(
            colSpanClass,
            paddingClass,
            "rounded-xl border border-gray-200/90 bg-gray-50/60 shadow-2xs space-y-2 text-xs"
          )}
          style={customStyle}
        >
          <div className="flex items-center gap-1.5 border-b border-gray-200 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            <Percent size={13} className="text-gray-600" />
            <span>{block.title || "GST Breakdown (18%)"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex justify-between text-gray-600">
              <span>CGST @ 9%:</span>
              <span className="font-mono">{formatCurrency(cgst || totalGst / 2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>SGST @ 9%:</span>
              <span className="font-mono">{formatCurrency(sgst || totalGst / 2)}</span>
            </div>
            <div className="col-span-2 flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
              <span>Total Statutory GST (18%):</span>
              <span className="font-mono">{formatCurrency(totalGst)}</span>
            </div>
          </div>
        </div>
      );
    }

    // 15. BANK DETAILS BLOCK
    case "bank_details":
      return (
        <div
          className={cn(
            colSpanClass,
            paddingClass,
            "rounded-xl border border-gray-200 bg-white shadow-2xs space-y-2 text-xs"
          )}
          style={customStyle}
        >
          <div className="flex items-center gap-1.5 border-b border-gray-100 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <Landmark size={13} className="text-gray-500" />
            <span>{block.title || "Bank & Remittance Details"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-gray-400 block">Bank Name:</span>
              <span className="font-bold text-gray-800">HDFC Bank Limited</span>
            </div>
            <div>
              <span className="text-gray-400 block">Account Name:</span>
              <span className="font-bold text-gray-800">
                {company?.name || "Whyte Living Innovations Pvt Ltd"}
              </span>
            </div>
            <div>
              <span className="text-gray-400 block">Account Number:</span>
              <span className="font-mono font-bold text-gray-900">50200088921456</span>
            </div>
            <div>
              <span className="text-gray-400 block">IFSC Code:</span>
              <span className="font-mono font-bold text-gray-900">HDFC0001824</span>
            </div>
          </div>
        </div>
      );

    // 16. TERMS & CONDITIONS BLOCK
    case "terms_and_conditions":
      return (
        <div
          className={cn(
            colSpanClass,
            paddingClass,
            "rounded-xl border border-gray-200/90 bg-gray-50/70 shadow-2xs space-y-2 text-xs"
          )}
          style={customStyle}
        >
          <div className="flex items-center gap-1.5 border-b border-gray-200 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            <FileText size={13} className="text-gray-600" />
            <span>{block.title || "Terms & Conditions"}</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-[11px] text-gray-600 leading-relaxed">
            <li>Quotation validity is 30 days from date of issuance.</li>
            <li>50% advance along with confirmed order, 40% against delivery, 10% on commissioning.</li>
            <li>All hardware products carry standard 3-year manufacturer replacement warranty.</li>
            <li>Site civil/conduit readiness must be provided by the client as per Whyte SLD schedule.</li>
          </ul>
        </div>
      );

    // 17. SIGNATURE SECTION BLOCK
    case "signature_section":
      return (
        <div
          className={cn(
            colSpanClass,
            "pt-6 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs"
          )}
          style={customStyle}
        >
          <div className="space-y-8">
            <div className="border-b border-gray-300 pb-1 text-gray-400 text-[10px] uppercase font-bold tracking-wider">
              Authorized Signature (Whyte Automation)
            </div>
            <div className="text-gray-700 font-semibold">Date: ________________________</div>
          </div>
          <div className="space-y-8">
            <div className="border-b border-gray-300 pb-1 text-gray-400 text-[10px] uppercase font-bold tracking-wider">
              Client Acceptance & Authorization
            </div>
            <div className="text-gray-700 font-semibold">Date: ________________________</div>
          </div>
        </div>
      );

    // 18. CUSTOM ANNEXURE BLOCK
    case "custom_annexure":
      return (
        <div
          className={cn(
            colSpanClass,
            "rounded-2xl border border-gray-200 bg-white p-6 shadow-2xs space-y-3"
          )}
          style={customStyle}
        >
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2">
              <FileCheck2 size={18} className="text-teal-700" />
              <h3 className="text-sm font-bold text-gray-900 tracking-tight">
                {block.title || "Technical Annexure & Architectural Notes"}
              </h3>
            </div>
            <span className="text-[10px] font-mono text-gray-400">
              IEC 60364-7 Compliant
            </span>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            {block.content ||
              "All automated switches, touch panels, dimming drivers, and motorized curtain controls are engineered to standard European architectural switchboard back-boxes. Neutral wire must be present in every control point."}
          </p>
        </div>
      );

    default:
      return null;
  }
}
