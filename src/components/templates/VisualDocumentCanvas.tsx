"use client";

import React, { useState, useMemo } from "react";
import {
  Type,
  AlignLeft,
  Image as ImageIcon,
  Award,
  Bookmark,
  MoveVertical,
  Minus,
  Sparkles,
  User,
  Building2,
  Home,
  Table,
  Receipt,
  Percent,
  Landmark,
  FileText,
  PenTool,
  FileCheck2,
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Settings2,
  Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DocumentLayoutDefinition,
  DocumentSectionDefinition,
  DocumentBlockDefinition,
  DocumentBlockType,
} from "@/types/template";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import TemplatePromptModal from "./TemplatePromptModal";
import DocumentBlockPropertiesPanel from "./DocumentBlockPropertiesPanel";

interface VisualDocumentCanvasProps {
  layout: DocumentLayoutDefinition;
  availableCustomFields: Array<{ key: string; label: string; type: string }>;
  onUpdateLayout: (updated: DocumentLayoutDefinition) => void;
}

const BLOCK_PALETTE: Array<{
  type: DocumentBlockType;
  label: string;
  category: "content" | "data" | "commercials";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  defaultWidth: "full" | "half" | "third" | "two_thirds";
}> = [
  // Content & Media
  { type: "heading", label: "Heading", category: "content", icon: Type, defaultWidth: "full" },
  { type: "paragraph", label: "Paragraph", category: "content", icon: AlignLeft, defaultWidth: "full" },
  { type: "banner", label: "Hero Banner", category: "content", icon: Bookmark, defaultWidth: "full" },
  { type: "image", label: "Image Block", category: "content", icon: ImageIcon, defaultWidth: "full" },
  { type: "company_logo", label: "Company Logo", category: "content", icon: Award, defaultWidth: "half" },
  { type: "spacer", label: "Spacer", category: "content", icon: MoveVertical, defaultWidth: "full" },
  { type: "divider", label: "Divider Line", category: "content", icon: Minus, defaultWidth: "full" },

  // Data Bindings
  { type: "custom_field_display", label: "Custom Field Binding", category: "data", icon: Sparkles, defaultWidth: "half" },
  { type: "customer_details", label: "Client Details", category: "data", icon: User, defaultWidth: "half" },
  { type: "project_details", label: "Project Details", category: "data", icon: Building2, defaultWidth: "half" },
  { type: "room_breakdown", label: "Room Breakdown", category: "data", icon: Home, defaultWidth: "full" },

  // Tables & Commercials
  { type: "product_table", label: "Product Table", category: "commercials", icon: Table, defaultWidth: "full" },
  { type: "pricing_summary", label: "Pricing Summary", category: "commercials", icon: Receipt, defaultWidth: "full" },
  { type: "gst_and_discounts", label: "GST & Discounts", category: "commercials", icon: Percent, defaultWidth: "full" },
  { type: "bank_details", label: "Bank Details", category: "commercials", icon: Landmark, defaultWidth: "full" },
  { type: "terms_and_conditions", label: "Terms & Conditions", category: "commercials", icon: FileText, defaultWidth: "full" },
  { type: "signature_section", label: "Sign-Off Section", category: "commercials", icon: PenTool, defaultWidth: "full" },
  { type: "custom_annexure", label: "Technical Annexure", category: "commercials", icon: FileCheck2, defaultWidth: "full" },
  { type: "page_break", label: "Force Page Break", category: "content", icon: Scissors, defaultWidth: "full" },
];

function generateBlockId(): string {
  return "blk_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

function generateSectionId(): string {
  return "sec_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

export default function VisualDocumentCanvas({
  layout,
  availableCustomFields,
  onUpdateLayout,
}: VisualDocumentCanvasProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<"all" | "content" | "data" | "commercials">("all");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const confirm = useConfirm();

  const sections = useMemo(() => layout.sections || [], [layout.sections]);

  // Find currently selected block and its section
  const selectedBlockInfo = useMemo(() => {
    if (!selectedBlockId) return null;
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const b = sections[sIdx].blocks.find((block) => block.id === selectedBlockId);
      if (b) return { block: b, sectionIndex: sIdx };
    }
    return null;
  }, [sections, selectedBlockId]);

  // Section Handlers
  const handleAddSection = () => {
    setPromptModalOpen(true);
  };

  const executeAddSection = (title: string) => {
    const newSec: DocumentSectionDefinition = {
      id: generateSectionId(),
      title: title.trim(),
      enabled: true,
      columns: 1,
      pageBreakBefore: true,
      blocks: [
        {
          id: generateBlockId(),
          type: "heading",
          title: title.trim(),
          level: 2,
          layout: { width: "full", alignment: "left" },
        },
      ],
    };

    onUpdateLayout({
      ...layout,
      sections: [...sections, newSec],
    });
    toast.success(`Section "${title.trim()}" added!`);
  };

  const handleUpdateSection = (
    sectionIndex: number,
    updater: (prev: DocumentSectionDefinition) => DocumentSectionDefinition
  ) => {
    const nextSections = [...sections];
    nextSections[sectionIndex] = updater(nextSections[sectionIndex]);
    onUpdateLayout({ ...layout, sections: nextSections });
  };

  const handleDeleteSection = async (sectionIndex: number) => {
    if (sections.length <= 1) {
      toast.error("A quotation proposal must contain at least one document section.");
      return;
    }
    const sec = sections[sectionIndex];
    const ok = await confirm({
      title: `Delete Section "${sec.title}"?`,
      message: `Delete section "${sec.title}" and its ${sec.blocks.length} block(s)?`,
      detail: "This will remove the section and all its contents from this document layout.",
      confirmText: "Delete Section",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    const nextSections = sections.filter((_, idx) => idx !== sectionIndex);
    onUpdateLayout({ ...layout, sections: nextSections });
    if (selectedBlockInfo?.sectionIndex === sectionIndex) {
      setSelectedBlockId(null);
    }
    toast.success(`Section "${sec.title}" deleted.`);
  };

  const handleMoveSection = (sectionIndex: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? sectionIndex - 1 : sectionIndex + 1;
    if (targetIdx < 0 || targetIdx >= sections.length) return;

    const nextSections = [...sections];
    const temp = nextSections[sectionIndex];
    nextSections[sectionIndex] = nextSections[targetIdx];
    nextSections[targetIdx] = temp;
    onUpdateLayout({ ...layout, sections: nextSections });
  };

  // Block Handlers
  const handleAddBlock = (sectionIndex: number, type: DocumentBlockType) => {
    const def = BLOCK_PALETTE.find((b) => b.type === type);
    const newBlock: DocumentBlockDefinition = {
      id: generateBlockId(),
      type,
      title:
        type === "heading"
          ? "New Section Heading"
          : type === "banner"
          ? "ENGINEERED AUTOMATION SPECIFICATION"
          : type === "customer_details"
          ? "Client Information"
          : type === "project_details"
          ? "Project Parameters"
          : type === "room_breakdown"
          ? "Configured Spaces"
          : type === "product_table"
          ? "Product Bill of Materials"
          : type === "pricing_summary"
          ? "Commercial Summary"
          : type === "gst_and_discounts"
          ? "GST & Discount Breakdown"
          : type === "bank_details"
          ? "Payment Details"
          : type === "terms_and_conditions"
          ? "Terms & Conditions"
          : type === "signature_section"
          ? "Authorized Acceptance Sign-off"
          : type === "custom_annexure"
          ? "Technical Annexure"
          : undefined,
      content:
        type === "paragraph"
          ? "Enter descriptive specification copy here..."
          : undefined,
      fieldKey:
        type === "custom_field_display"
          ? availableCustomFields[0]?.key || "leadArchitect"
          : undefined,
      displayLabel:
        type === "custom_field_display"
          ? availableCustomFields[0]?.label || "Custom Field"
          : undefined,
      renderMode: type === "custom_field_display" ? "keyValue" : undefined,
      layout: {
        width: def?.defaultWidth || "full",
        alignment: "left",
        padding: "normal",
      },
    };

    handleUpdateSection(sectionIndex, (sec) => ({
      ...sec,
      blocks: [...sec.blocks, newBlock],
    }));

    setSelectedBlockId(newBlock.id);
  };

  const handleUpdateBlock = (updated: DocumentBlockDefinition) => {
    if (!selectedBlockInfo) return;
    const sIdx = selectedBlockInfo.sectionIndex;
    handleUpdateSection(sIdx, (sec) => ({
      ...sec,
      blocks: sec.blocks.map((b) => (b.id === updated.id ? updated : b)),
    }));
  };

  const handleDeleteBlock = (sectionIndex: number, blockId: string) => {
    handleUpdateSection(sectionIndex, (sec) => ({
      ...sec,
      blocks: sec.blocks.filter((b) => b.id !== blockId),
    }));
    if (selectedBlockId === blockId) setSelectedBlockId(null);
  };

  const handleDuplicateBlock = (sectionIndex: number, block: DocumentBlockDefinition) => {
    const dup: DocumentBlockDefinition = {
      ...JSON.parse(JSON.stringify(block)),
      id: generateBlockId(),
      title: block.title ? `${block.title} (Copy)` : undefined,
    };

    handleUpdateSection(sectionIndex, (sec) => ({
      ...sec,
      blocks: [...sec.blocks, dup],
    }));

    setSelectedBlockId(dup.id);
  };

  const handleMoveBlock = (
    sectionIndex: number,
    blockIndex: number,
    direction: "up" | "down"
  ) => {
    const targetIdx = direction === "up" ? blockIndex - 1 : blockIndex + 1;
    const sec = sections[sectionIndex];
    if (targetIdx < 0 || targetIdx >= sec.blocks.length) return;

    handleUpdateSection(sectionIndex, (currentSec) => {
      const nextBlocks = [...currentSec.blocks];
      const temp = nextBlocks[blockIndex];
      nextBlocks[blockIndex] = nextBlocks[targetIdx];
      nextBlocks[targetIdx] = temp;
      return { ...currentSec, blocks: nextBlocks };
    });
  };

  const filteredPalette = useMemo(() => {
    if (activeCategory === "all") return BLOCK_PALETTE;
    return BLOCK_PALETTE.filter((b) => b.category === activeCategory);
  }, [activeCategory]);

  return (
    <div className="space-y-6">
      {/* 1. PALETTE CATEGORY BAR */}
      <div className="bg-white border border-gray-200/90 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-primary" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">
              Document Block Palette
            </h3>
            <span className="text-[11px] text-gray-400 hidden sm:inline">
              • Click any block below to append it to the active document section
            </span>
          </div>

          <button
            type="button"
            onClick={handleAddSection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 transition cursor-pointer shadow-xs"
          >
            <Plus size={13} />
            <span>Add Document Section</span>
          </button>
        </div>

        {/* Filter categories */}
        <div className="flex items-center gap-1.5 border-b border-gray-100 pb-2 text-[11px] font-semibold text-gray-500">
          {[
            { id: "all", label: "All Blocks (18)" },
            { id: "content", label: "Content & Media" },
            { id: "data", label: "Quotation Data Bindings" },
            { id: "commercials", label: "Tables & Commercials" },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id as any)}
              className={cn(
                "px-2.5 py-1 rounded-lg transition cursor-pointer",
                activeCategory === cat.id
                  ? "bg-slate-900 text-white font-bold shadow-2xs"
                  : "hover:bg-gray-100 text-gray-600"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Quick-add buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-1">
          {filteredPalette.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.type}
                type="button"
                onClick={() => handleAddBlock(0, item.type)}
                className="flex items-center gap-2 p-2 rounded-xl border border-gray-200/90 bg-gray-50/60 hover:bg-white hover:border-primary hover:shadow-xs transition text-left cursor-pointer group"
                title={`Add ${item.label} to section 1`}
              >
                <div className="w-7 h-7 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600 group-hover:text-primary group-hover:border-primary/40 shrink-0">
                  <Icon size={14} />
                </div>
                <div className="truncate">
                  <span className="block text-[11px] font-semibold text-gray-900 group-hover:text-primary truncate">
                    {item.label}
                  </span>
                  <span className="block text-[9px] text-gray-400 capitalize">
                    {item.defaultWidth}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. DOCUMENT SECTIONS & BLOCKS CANVAS */}
      <div className="space-y-6">
        {sections.map((section, sIdx) => (
          <div
            key={section.id}
            className="bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden"
          >
            {/* Section Header */}
            <div className="p-4 bg-gray-50/80 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-lg bg-gray-900 text-white font-bold text-xs flex items-center justify-center">
                  {sIdx + 1}
                </span>
                <div>
                  <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    {section.title}
                    {section.pageBreakBefore && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        Page Break Before
                      </span>
                    )}
                  </h4>
                  <span className="text-[11px] text-gray-400">
                    {section.blocks.length} block(s) • {section.columns || 1}-column layout
                  </span>
                </div>
              </div>

              {/* Section Controls */}
              <div className="flex items-center gap-2">
                {/* Column layout switcher */}
                <div className="flex items-center bg-white border border-gray-200 rounded-lg p-0.5 text-xs">
                  {[1, 2, 3].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() =>
                        handleUpdateSection(sIdx, (sec) => ({
                          ...sec,
                          columns: col as 1 | 2 | 3,
                        }))
                      }
                      className={cn(
                        "px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition",
                        (section.columns || 1) === col
                          ? "bg-gray-900 text-white shadow-2xs"
                          : "text-gray-500 hover:text-gray-900"
                      )}
                      title={`${col} column layout`}
                    >
                      {col}C
                    </button>
                  ))}
                </div>

                {/* Page break toggle */}
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSection(sIdx, (sec) => ({
                      ...sec,
                      pageBreakBefore: !sec.pageBreakBefore,
                    }))
                  }
                  className={cn(
                    "px-2 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition",
                    section.pageBreakBefore
                      ? "bg-blue-50 text-blue-800 border-blue-200"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  )}
                  title="Toggle forced page break before this section"
                >
                  <Scissors size={12} className="inline mr-1" />
                  <span>Break</span>
                </button>

                {/* Reorder */}
                <button
                  type="button"
                  disabled={sIdx === 0}
                  onClick={() => handleMoveSection(sIdx, "up")}
                  className="p-1.5 text-gray-500 hover:text-gray-900 disabled:opacity-30 rounded-lg hover:bg-gray-200/60 transition cursor-pointer"
                  title="Move section up"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  disabled={sIdx === sections.length - 1}
                  onClick={() => handleMoveSection(sIdx, "down")}
                  className="p-1.5 text-gray-500 hover:text-gray-900 disabled:opacity-30 rounded-lg hover:bg-gray-200/60 transition cursor-pointer"
                  title="Move section down"
                >
                  <ArrowDown size={13} />
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => handleDeleteSection(sIdx)}
                  className="p-1.5 text-rose-500 hover:text-rose-700 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                  title="Delete section"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Blocks Container */}
            <div className="p-5 space-y-3 bg-gray-50/30">
              {section.blocks.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-xs">
                  <p>No blocks in this section.</p>
                  <p className="text-[11px] mt-1 text-gray-400">
                    Use the block palette above to add content, tables, or data bindings.
                  </p>
                </div>
              ) : (
                <div
                  className={cn(
                    "grid gap-3 items-start",
                    (section.columns || 1) === 1 && "grid-cols-1",
                    (section.columns || 1) === 2 && "grid-cols-1 md:grid-cols-2",
                    (section.columns || 1) === 3 && "grid-cols-1 md:grid-cols-3"
                  )}
                >
                  {section.blocks.map((block, bIdx) => {
                    const isSelected = selectedBlockId === block.id;
                    const def = BLOCK_PALETTE.find((b) => b.type === block.type);
                    const Icon = def?.icon || FileText;

                    return (
                      <div
                        key={block.id}
                        className={cn(
                          "bg-white rounded-xl border p-3.5 transition flex flex-col justify-between gap-3 shadow-2xs group hover:border-primary/60",
                          isSelected
                            ? "border-primary ring-2 ring-primary/10 shadow-sm"
                            : "border-gray-200/90",
                          block.layout?.width === "full" && "col-span-full",
                          block.layout?.width === "half" && "md:col-span-1",
                          block.layout?.width === "two_thirds" && "md:col-span-2"
                        )}
                      >
                        {/* Block Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                              <Icon size={12} />
                            </div>
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                                {block.type.replace(/_/g, " ")}
                              </span>
                              <span className="text-xs font-bold text-gray-900 truncate block max-w-[200px]">
                                {block.title || block.displayLabel || block.content || "Configured Block"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              {block.layout?.width || "full"}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedBlockId(block.id)}
                              className="p-1 rounded-md text-gray-400 hover:text-gray-900 hover:bg-gray-100 cursor-pointer"
                              title="Edit Block Properties"
                            >
                              <Settings2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Block Summary snippet */}
                        <div className="text-[11px] text-gray-500 bg-gray-50/70 p-2 rounded-lg border border-gray-100 truncate">
                          {block.type === "custom_field_display" && (
                            <span className="font-mono text-teal-800 font-semibold">
                              Bound to: {block.fieldKey} ({block.renderMode || "keyValue"})
                            </span>
                          )}
                          {block.type === "heading" && (
                            <span>
                              H{block.level || 2} • {block.title || "Heading Title"}
                            </span>
                          )}
                          {block.type === "paragraph" && (
                            <span className="italic truncate block">
                              &ldquo;{block.content || "Empty paragraph text"}&rdquo;
                            </span>
                          )}
                          {block.type === "banner" && (
                            <span className="font-bold text-teal-900 truncate block">
                              Banner: {block.title}
                            </span>
                          )}
                          {block.type === "image" && (
                            <span className="truncate block font-mono">
                              {block.imageUrl || "No image uploaded"}
                            </span>
                          )}
                          {block.type === "product_table" && (
                            <span>Embedded Line Items Table with Configured Columns</span>
                          )}
                          {block.type === "pricing_summary" && (
                            <span>Commercial Totals, Discounts, and Net Payable</span>
                          )}
                          {block.type === "gst_and_discounts" && (
                            <span>CGST, SGST, Dealer Discount breakdown</span>
                          )}
                          {block.type === "page_break" && (
                            <span className="font-bold text-blue-700">Page Break Divider</span>
                          )}
                          {![
                            "custom_field_display",
                            "heading",
                            "paragraph",
                            "banner",
                            "image",
                            "product_table",
                            "pricing_summary",
                            "gst_and_discounts",
                            "page_break",
                          ].includes(block.type) && (
                            <span className="capitalize">{block.type.replace(/_/g, " ")} Content</span>
                          )}
                        </div>

                        {/* Block Bottom Action bar */}
                        <div className="flex items-center justify-between pt-1 border-t border-gray-100 text-[11px]">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={bIdx === 0}
                              onClick={() => handleMoveBlock(sIdx, bIdx, "up")}
                              className="p-1 text-gray-400 hover:text-gray-900 disabled:opacity-20 cursor-pointer"
                              title="Move Block Up"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              disabled={bIdx === section.blocks.length - 1}
                              onClick={() => handleMoveBlock(sIdx, bIdx, "down")}
                              className="p-1 text-gray-400 hover:text-gray-900 disabled:opacity-20 cursor-pointer"
                              title="Move Block Down"
                            >
                              <ArrowDown size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateBlock(sIdx, block)}
                              className="p-1 text-gray-400 hover:text-gray-900 cursor-pointer"
                              title="Duplicate Block"
                            >
                              <Copy size={12} />
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedBlockId(block.id)}
                              className="text-primary font-semibold hover:underline cursor-pointer"
                            >
                              Edit Settings
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBlock(sIdx, block.id)}
                              className="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                              title="Delete Block"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 3. BLOCK PROPERTIES INSPECTOR SLIDE-OVER */}
      {selectedBlockInfo && (
        <DocumentBlockPropertiesPanel
          block={selectedBlockInfo.block}
          availableCustomFields={availableCustomFields}
          onUpdate={handleUpdateBlock}
          onClose={() => setSelectedBlockId(null)}
          onDelete={() => {
            handleDeleteBlock(
              selectedBlockInfo.sectionIndex,
              selectedBlockInfo.block.id
            );
          }}
        />
      )}

      {/* ADD SECTION PROMPT MODAL */}
      <TemplatePromptModal
        isOpen={promptModalOpen}
        title="Add Proposal Document Section"
        description="Add a new section to arrange blocks, tables, and annexures on your proposal."
        inputLabel="Section Title"
        placeholder="e.g. Technical Specifications, Executive Summary, Scope of Work"
        defaultValue="Technical Specifications"
        confirmText="Add Section"
        icon="layers"
        onConfirm={executeAddSection}
        onClose={() => setPromptModalOpen(false)}
      />
    </div>
  );
}
