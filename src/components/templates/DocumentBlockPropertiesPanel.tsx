"use client";

import React, { useState } from "react";
import {
  X,
  Check,
  Trash2,
  Upload,
  Loader2,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Palette,
  Layers,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import type {
  DocumentBlockDefinition,
  DocumentBlockType,
} from "@/types/template";

interface DocumentBlockPropertiesPanelProps {
  block: DocumentBlockDefinition;
  availableCustomFields: Array<{ key: string; label: string; type: string }>;
  onUpdate: (updated: DocumentBlockDefinition) => void;
  onClose: () => void;
  onDelete: () => void;
}

export default function DocumentBlockPropertiesPanel({
  block,
  availableCustomFields,
  onUpdate,
  onClose,
  onDelete,
}: DocumentBlockPropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<"content" | "layout" | "style">("content");

  // Content state
  const [title, setTitle] = useState(block.title || "");
  const [content, setContent] = useState(block.content || "");
  const [level, setLevel] = useState<1 | 2 | 3 | 4>(block.level || 2);
  const [imageUrl, setImageUrl] = useState(block.imageUrl || "");
  const [imageAlt, setImageAlt] = useState(block.imageAlt || "");
  const [fieldKey, setFieldKey] = useState(block.fieldKey || "");
  const [displayLabel, setDisplayLabel] = useState(block.displayLabel || "");
  const [renderMode, setRenderMode] = useState<
    "text" | "badge" | "keyValue" | "image" | "full_page_annexure"
  >(block.renderMode || "keyValue");

  // Layout state
  const [width, setWidth] = useState<"full" | "half" | "third" | "two_thirds">(
    block.layout?.width || "full"
  );
  const [alignment, setAlignment] = useState<"left" | "center" | "right">(
    block.layout?.alignment || "left"
  );
  const [padding, setPadding] = useState<"none" | "compact" | "normal" | "relaxed">(
    block.layout?.padding || "normal"
  );
  const [marginTop, setMarginTop] = useState(block.layout?.marginTop ?? 0);
  const [marginBottom, setMarginBottom] = useState(block.layout?.marginBottom ?? 0);

  // Style state
  const [backgroundColor, setBackgroundColor] = useState(block.layout?.backgroundColor || "");
  const [textColor, setTextColor] = useState(block.layout?.textColor || "");
  const [borderColor, setBorderColor] = useState(block.layout?.borderColor || "");

  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    const toastId = toast.loading("Uploading image...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/templates/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to upload image");
      }

      const json = await res.json();
      const url = json.data?.url;
      if (url) {
        setImageUrl(url);
        toast.success("Image uploaded successfully!", { id: toastId });
      }
    } catch (err: any) {
      toast.error(err.message || "Upload failed", { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const handleApply = () => {
    const updated: DocumentBlockDefinition = {
      ...block,
      title: title.trim() || undefined,
      content: content.trim() || undefined,
      level: block.type === "heading" ? level : undefined,
      imageUrl: imageUrl.trim() || undefined,
      imageAlt: imageAlt.trim() || undefined,
      fieldKey: block.type === "custom_field_display" ? fieldKey : undefined,
      displayLabel: displayLabel.trim() || undefined,
      renderMode: block.type === "custom_field_display" ? renderMode : undefined,
      layout: {
        width,
        alignment,
        padding,
        backgroundColor: backgroundColor.trim() || undefined,
        textColor: textColor.trim() || undefined,
        borderColor: borderColor.trim() || undefined,
        marginTop: Number(marginTop) || 0,
        marginBottom: Number(marginBottom) || 0,
      },
    };

    onUpdate(updated);
    onClose();
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl border-l border-gray-200 flex flex-col animate-in slide-in-from-right duration-200">
      {/* HEADER */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Document Block Inspector
          </span>
          <h3 className="text-sm font-bold text-gray-900 capitalize">
            {block.type.replace(/_/g, " ")} Block
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {/* TABS */}
      <div className="flex border-b border-gray-200 bg-gray-50/50 p-1 gap-1 text-xs font-semibold px-4">
        <button
          type="button"
          onClick={() => setActiveTab("content")}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-center transition cursor-pointer",
            activeTab === "content"
              ? "bg-white text-gray-900 shadow-xs border border-gray-200"
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          Content & Data
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("layout")}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-center transition cursor-pointer",
            activeTab === "layout"
              ? "bg-white text-gray-900 shadow-xs border border-gray-200"
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          Layout & Grid
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("style")}
          className={cn(
            "flex-1 py-1.5 rounded-lg text-center transition cursor-pointer",
            activeTab === "style"
              ? "bg-white text-gray-900 shadow-xs border border-gray-200"
              : "text-gray-500 hover:text-gray-900"
          )}
        >
          Colors & Spacing
        </button>
      </div>

      {/* BODY */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
        {/* TAB 1: CONTENT & DATA BINDING */}
        {activeTab === "content" && (
          <div className="space-y-4">
            {/* Title / Heading input */}
            {(block.type === "heading" ||
              block.type === "banner" ||
              block.type === "customer_details" ||
              block.type === "project_details" ||
              block.type === "room_breakdown" ||
              block.type === "product_table" ||
              block.type === "pricing_summary" ||
              block.type === "gst_and_discounts" ||
              block.type === "terms_and_conditions" ||
              block.type === "bank_details" ||
              block.type === "signature_section" ||
              block.type === "custom_annexure") && (
              <div>
                <label className="block font-semibold text-gray-800 mb-1">
                  Block Title / Header
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Architectural Conduit Schedule..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 font-semibold"
                />
              </div>
            )}

            {/* Heading Level */}
            {block.type === "heading" && (
              <div>
                <label className="block font-semibold text-gray-800 mb-1">Heading Size</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setLevel(lvl as 1 | 2 | 3 | 4)}
                      className={cn(
                        "py-1.5 text-center font-bold rounded-lg border cursor-pointer transition",
                        level === lvl
                          ? "bg-primary text-white border-primary"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      H{lvl}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Text / Paragraph Content */}
            {(block.type === "paragraph" ||
              block.type === "banner" ||
              block.type === "custom_annexure") && (
              <div>
                <label className="block font-semibold text-gray-800 mb-1">
                  Body Text / Description
                </label>
                <textarea
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter descriptive copy or contract specification..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-gray-900"
                />
              </div>
            )}

            {/* CUSTOM FIELD DATA BINDING (Phase 4 Core Requirement) */}
            {block.type === "custom_field_display" && (
              <div className="space-y-4 p-4 rounded-xl border border-teal-200 bg-teal-50/50">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-teal-700" />
                  <span className="font-bold text-teal-900 uppercase tracking-wider text-[11px]">
                    Workflow Field Data Binding
                  </span>
                </div>

                <div>
                  <label className="block font-semibold text-gray-800 mb-1">
                    Select Workflow Field
                  </label>
                  <select
                    value={fieldKey}
                    onChange={(e) => {
                      const selected = e.target.value;
                      setFieldKey(selected);
                      const match = availableCustomFields.find((f) => f.key === selected);
                      if (match && !displayLabel) {
                        setDisplayLabel(match.label);
                      }
                      if (match?.type === "image") {
                        setRenderMode("image");
                      }
                    }}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-semibold text-gray-900"
                  >
                    <option value="">-- Choose Custom Field --</option>
                    {availableCustomFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} ({f.key}) [{f.type}]
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Pulls actual value submitted in the quotation workflow (e.g. Site Survey).
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-gray-800 mb-1">
                    Custom Display Label
                  </label>
                  <input
                    type="text"
                    value={displayLabel}
                    onChange={(e) => setDisplayLabel(e.target.value)}
                    placeholder="Override label shown in document..."
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-gray-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-800 mb-1">Render As</label>
                  <select
                    value={renderMode}
                    onChange={(e) => setRenderMode(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl font-semibold text-gray-900"
                  >
                    <option value="keyValue">Key-Value Card (Label: Value)</option>
                    <option value="badge">Badge Chip (Pill Tag)</option>
                    <option value="text">Formatted Text</option>
                    <option value="image">Image Preview Block</option>
                    <option value="full_page_annexure">Full-Page Architectural Annexure</option>
                  </select>
                </div>
              </div>
            )}

            {/* Media Upload / URL */}
            {(block.type === "image" ||
              block.type === "company_logo" ||
              block.type === "banner") && (
              <div className="space-y-3">
                <label className="block font-semibold text-gray-800">
                  Image Asset ({block.type === "company_logo" ? "Company Logo" : "Photo / Banner"})
                </label>

                {imageUrl && (
                  <div className="p-2 border border-gray-200 rounded-xl bg-gray-50 flex items-center gap-3">
                    <img
                      src={imageUrl}
                      alt={imageAlt || "Preview"}
                      className="w-14 h-14 object-cover rounded-lg border border-gray-200"
                    />
                    <div className="flex-1 truncate">
                      <span className="text-[11px] font-mono text-gray-600 block truncate">
                        {imageUrl}
                      </span>
                      <button
                        type="button"
                        onClick={() => setImageUrl("")}
                        className="text-[11px] text-rose-600 font-semibold hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-semibold cursor-pointer transition shadow-2xs">
                    {uploading ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload size={13} />
                        <span>Upload File</span>
                      </>
                    )}
                    <input
                      type="file"
                      disabled={uploading}
                      className="hidden"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="or paste image URL directly"
                    className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-800 mb-1">
                    Image Alt / Caption
                  </label>
                  <input
                    type="text"
                    value={imageAlt}
                    onChange={(e) => setImageAlt(e.target.value)}
                    placeholder="e.g. Floor 2 Conduit Layout Plan"
                    className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: LAYOUT & GRID */}
        {activeTab === "layout" && (
          <div className="space-y-4">
            <div>
              <label className="block font-semibold text-gray-800 mb-1.5">Block Width</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "full", label: "Full Width (100%)" },
                  { id: "half", label: "Half Width (50%)" },
                  { id: "third", label: "One Third (33%)" },
                  { id: "two_thirds", label: "Two Thirds (66%)" },
                ].map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWidth(w.id as any)}
                    className={cn(
                      "p-2 rounded-xl border text-left font-semibold transition cursor-pointer text-xs",
                      width === w.id
                        ? "bg-primary text-white border-primary shadow-xs"
                        : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-800 mb-1.5">Content Alignment</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "left", label: "Left", icon: AlignLeft },
                  { id: "center", label: "Center", icon: AlignCenter },
                  { id: "right", label: "Right", icon: AlignRight },
                ].map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAlignment(a.id as any)}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2 rounded-xl border font-semibold transition cursor-pointer text-xs",
                        alignment === a.id
                          ? "bg-primary text-white border-primary shadow-xs"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      <Icon size={14} />
                      <span>{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-800 mb-1.5">Block Padding</label>
              <select
                value={padding}
                onChange={(e) => setPadding(e.target.value as any)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl font-semibold"
              >
                <option value="none">None (0px)</option>
                <option value="compact">Compact (8px)</option>
                <option value="normal">Normal (16px)</option>
                <option value="relaxed">Relaxed (24px)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
              <div>
                <label className="block font-semibold text-gray-800 mb-1">
                  Margin Top (px)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={marginTop}
                  onChange={(e) => setMarginTop(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-gray-800 mb-1">
                  Margin Bottom (px)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={marginBottom}
                  onChange={(e) => setMarginBottom(Number(e.target.value))}
                  className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: COLORS & STYLES */}
        {activeTab === "style" && (
          <div className="space-y-4">
            <div>
              <label className="block font-semibold text-gray-800 mb-1.5">Background Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={backgroundColor || "#ffffff"}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-gray-300"
                />
                <input
                  type="text"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  placeholder="e.g. #f8fafc or transparent"
                  className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono text-xs"
                />
                {backgroundColor && (
                  <button
                    type="button"
                    onClick={() => setBackgroundColor("")}
                    className="text-[11px] text-gray-500 hover:text-gray-900 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-800 mb-1.5">Text Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={textColor || "#0f172a"}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-gray-300"
                />
                <input
                  type="text"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  placeholder="e.g. #09090b"
                  className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono text-xs"
                />
                {textColor && (
                  <button
                    type="button"
                    onClick={() => setTextColor("")}
                    className="text-[11px] text-gray-500 hover:text-gray-900 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-gray-800 mb-1.5">Border Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={borderColor || "#e2e8f0"}
                  onChange={(e) => setBorderColor(e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-gray-300"
                />
                <input
                  type="text"
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                  placeholder="e.g. #cbd5e1"
                  className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono text-xs"
                />
                {borderColor && (
                  <button
                    type="button"
                    onClick={() => setBorderColor("")}
                    className="text-[11px] text-gray-500 hover:text-gray-900 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl font-semibold transition cursor-pointer text-xs"
        >
          <Trash2 size={13} />
          <span>Delete Block</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-xl text-gray-700 font-semibold cursor-pointer transition text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold cursor-pointer transition shadow-xs text-xs"
          >
            <Check size={14} />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
