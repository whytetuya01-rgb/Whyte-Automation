"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Palette,
  Layout,
  Columns,
  Hash,
  Sliders,
  Check,
  Plus,
  Trash2,
  Copy,
  Star,
  Eye,
  RotateCcw,
  Save,
  ArrowUp,
  ArrowDown,
  Layers,
  Sparkles,
  HelpCircle,
  AlertCircle,
  FileText,
  Building,
  CheckCircle2,
  Calendar,
  Grid,
} from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import type {
  QuotationTemplate,
  TemplateSectionItem,
  TemplateConfigurableColumns,
  TemplateLayoutSettings,
  TemplateNumberingFormat,
  TemplateCustomField,
  TemplateFontFamily,
} from "@/types/template";
import {
  DEFAULT_TEMPLATE_SECTIONS,
  DEFAULT_CONFIGURABLE_COLUMNS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NUMBERING_FORMAT,
} from "@/types/template";

type DesignerTab = "layout" | "sections" | "columns" | "custom_fields" | "numbering";

export default function TemplateDesignerStudio() {
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DesignerTab>("layout");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Form draft state for currently selected template
  const [draft, setDraft] = useState<QuotationTemplate | null>(null);

  // Load templates from API
  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/templates");
      if (!res.ok) throw new Error("Failed to load templates");
      const json = await res.json();
      const list: QuotationTemplate[] = json?.data || [];
      setTemplates(list);

      if (list.length > 0) {
        // Keep current selection or select default
        const current = list.find((t) => t.id === selectedTemplateId) || list.find((t) => t.isDefault) || list[0];
        setSelectedTemplateId(current.id);
        setDraft(JSON.parse(JSON.stringify(current)));
      }
    } catch (err: any) {
      toast.error(err.message || "Could not load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  // When switching selected template
  const handleSelectTemplate = (tmpl: QuotationTemplate) => {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Switch template anyway?")) return;
    }
    setSelectedTemplateId(tmpl.id);
    setDraft(JSON.parse(JSON.stringify(tmpl)));
    setIsDirty(false);
  };

  // Mutate draft helper
  const updateDraft = (updater: (prev: QuotationTemplate) => QuotationTemplate) => {
    if (!draft) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      setIsDirty(true);
      return next;
    });
  };

  // Create new template
  const handleCreateNewTemplate = async () => {
    const name = prompt("Enter a name for the new template:", "New Proposal Template");
    if (!name || !name.trim()) return;

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: "Custom quotation proposal template.",
          isDefault: false,
          numberingFormat: { ...DEFAULT_NUMBERING_FORMAT },
          layoutSettings: { ...DEFAULT_LAYOUT_SETTINGS },
          configurableColumns: { ...DEFAULT_CONFIGURABLE_COLUMNS },
          sectionOrder: [...DEFAULT_TEMPLATE_SECTIONS],
          customFields: [],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to create template");
      }

      const json = await res.json();
      const created: QuotationTemplate = json.data;
      toast.success(`Template "${created.name}" created!`);
      await fetchTemplates();
      setSelectedTemplateId(created.id);
      setDraft(JSON.parse(JSON.stringify(created)));
      setIsDirty(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to create template");
    }
  };

  // Duplicate current template
  const handleDuplicateTemplate = async () => {
    if (!draft) return;
    const name = prompt(`Duplicate "${draft.name}" as:`, `${draft.name} (Copy)`);
    if (!name || !name.trim()) return;

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          name: name.trim(),
          isDefault: false,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to duplicate template");
      }

      const json = await res.json();
      const created: QuotationTemplate = json.data;
      toast.success(`Template duplicated as "${created.name}"`);
      await fetchTemplates();
      setSelectedTemplateId(created.id);
      setDraft(JSON.parse(JSON.stringify(created)));
      setIsDirty(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to duplicate template");
    }
  };

  // Set current template as default
  const handleSetDefault = async () => {
    if (!draft) return;
    try {
      const res = await fetch(`/api/templates/${draft.id}/set-default`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to set default template");
      toast.success(`"${draft.name}" is now the default template.`);
      await fetchTemplates();
      updateDraft((d) => ({ ...d, isDefault: true }));
    } catch (err: any) {
      toast.error(err.message || "Could not set default template");
    }
  };

  // Delete current template
  const handleDeleteTemplate = async () => {
    if (!draft) return;
    if (templates.length <= 1) {
      toast.error("You cannot delete the only remaining template.");
      return;
    }
    if (!confirm(`Are you sure you want to delete template "${draft.name}"?`)) return;

    try {
      const res = await fetch(`/api/templates/${draft.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to delete template");
      }
      toast.success("Template deleted successfully");
      setIsDirty(false);
      await fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete template");
    }
  };

  // Save changes
  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    const toastId = toast.loading("Saving template changes...");

    try {
      const res = await fetch(`/api/templates/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to save template");
      }

      const json = await res.json();
      const updated: QuotationTemplate = json.data;
      toast.success("Template saved successfully!", { id: toastId });
      setIsDirty(false);
      await fetchTemplates();
      setDraft(JSON.parse(JSON.stringify(updated)));
    } catch (err: any) {
      toast.error(err.message || "Failed to save template", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  // Move section up/down in order
  const moveSection = (index: number, direction: "up" | "down") => {
    if (!draft) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= draft.sectionOrder.length) return;

    updateDraft((prev) => {
      const list = [...prev.sectionOrder];
      const temp = list[index];
      list[index] = list[newIndex];
      list[newIndex] = temp;
      return { ...prev, sectionOrder: list };
    });
  };

  // Toggle section enabled
  const toggleSection = (id: string) => {
    updateDraft((prev) => ({
      ...prev,
      sectionOrder: prev.sectionOrder.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    }));
  };

  // Add custom field
  const handleAddCustomField = () => {
    const label = prompt("Enter label for the new field (e.g. Architect Name):");
    if (!label || !label.trim()) return;

    const key = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const newField: TemplateCustomField = {
      id: "f_" + Date.now().toString(36),
      key: key || "customField",
      label: label.trim(),
      type: "text",
      defaultValue: "",
      placeholder: `Enter ${label.trim()}...`,
      required: false,
      section: "metadata",
    };

    updateDraft((prev) => ({
      ...prev,
      customFields: [...prev.customFields, newField],
    }));
  };

  // Delete custom field
  const handleDeleteCustomField = (id: string) => {
    updateDraft((prev) => ({
      ...prev,
      customFields: prev.customFields.filter((f) => f.id !== id),
    }));
  };

  // Simulated quotation numbering preview
  const sampleQuotationNumber = useMemo(() => {
    if (!draft) return "QT-2026-0001";
    const { prefix, separator, includeYear, yearFormat, digitCount, suffix } = draft.numberingFormat;
    const year = yearFormat === "YY" ? "26" : "2026";
    const padSeq = "0001".padStart(digitCount, "0").slice(-digitCount);

    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    if (includeYear) parts.push(year);
    parts.push(padSeq);
    if (suffix) parts.push(suffix);

    return parts.join(separator || "-");
  }, [draft?.numberingFormat]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-gray-500">
        <div className="w-8 h-8 border-3 border-gray-900 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-medium">Loading Quotation Templates...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar: Template Selector & Actions */}
      <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Active Template:
          </label>
          <div className="flex items-center gap-2">
            <select
              value={selectedTemplateId || ""}
              onChange={(e) => {
                const found = templates.find((t) => t.id === e.target.value);
                if (found) handleSelectTemplate(found);
              }}
              className="px-3 py-2 bg-gray-50 hover:bg-gray-100/80 border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-gray-900 transition"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.isDefault ? "★ (Default)" : ""}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleCreateNewTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-2xs"
            >
              <Plus size={14} />
              <span>New Template</span>
            </button>

            <button
              type="button"
              onClick={handleDuplicateTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition cursor-pointer"
              title="Duplicate current template"
            >
              <Copy size={13} />
              <span>Duplicate</span>
            </button>
          </div>

          {draft?.isDefault ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold rounded-lg">
              <Star size={12} className="fill-amber-500 text-amber-500" /> Default for new quotations
            </span>
          ) : (
            <button
              type="button"
              onClick={handleSetDefault}
              className="text-xs text-gray-600 hover:text-gray-900 font-medium underline underline-offset-4 cursor-pointer"
            >
              Make default
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {draft && !draft.isDefault && templates.length > 1 && (
            <button
              type="button"
              onClick={handleDeleteTemplate}
              className="inline-flex items-center gap-1 px-3 py-2 text-rose-600 hover:bg-rose-50 text-xs font-medium rounded-xl transition cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn(
              "inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer",
              isDirty
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            <Save size={14} />
            <span>{saving ? "Saving..." : isDirty ? "Save Template" : "Saved"}</span>
          </button>
        </div>
      </div>

      {draft && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: Controls Studio (5 cols) */}
          <div className="lg:col-span-5 bg-white border border-gray-200/80 rounded-2xl shadow-xs overflow-hidden flex flex-col">
            {/* Header info */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                Template Name
              </label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => updateDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-gray-900"
              />
              <input
                type="text"
                value={draft.description || ""}
                placeholder="Optional template description (e.g. for luxury villas)..."
                onChange={(e) => updateDraft((d) => ({ ...d, description: e.target.value }))}
                className="w-full mt-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-hidden focus:ring-2 focus:ring-gray-900"
              />
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50/70 p-1 gap-1 overflow-x-auto text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab("layout")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg transition whitespace-nowrap cursor-pointer",
                  activeTab === "layout"
                    ? "bg-white text-gray-950 shadow-xs border border-gray-200/60"
                    : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
                )}
              >
                <Palette size={13} />
                <span>Layout & Style</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("sections")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg transition whitespace-nowrap cursor-pointer",
                  activeTab === "sections"
                    ? "bg-white text-gray-950 shadow-xs border border-gray-200/60"
                    : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
                )}
              >
                <Layers size={13} />
                <span>Sections</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("columns")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg transition whitespace-nowrap cursor-pointer",
                  activeTab === "columns"
                    ? "bg-white text-gray-950 shadow-xs border border-gray-200/60"
                    : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
                )}
              >
                <Columns size={13} />
                <span>Table Columns</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("custom_fields")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg transition whitespace-nowrap cursor-pointer",
                  activeTab === "custom_fields"
                    ? "bg-white text-gray-950 shadow-xs border border-gray-200/60"
                    : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
                )}
              >
                <Sliders size={13} />
                <span>Custom Fields</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("numbering")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg transition whitespace-nowrap cursor-pointer",
                  activeTab === "numbering"
                    ? "bg-white text-gray-950 shadow-xs border border-gray-200/60"
                    : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
                )}
              >
                <Hash size={13} />
                <span>Numbering</span>
              </button>
            </div>

            {/* Tab Contents */}
            <div className="p-5 space-y-5 max-h-[700px] overflow-y-auto">
              {/* TAB 1: LAYOUT & STYLE */}
              {activeTab === "layout" && (
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-gray-700 mb-2">Brand Colors</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2 p-2 border border-gray-200 rounded-xl bg-gray-50/50">
                        <input
                          type="color"
                          value={draft.layoutSettings.primaryColor}
                          onChange={(e) =>
                            updateDraft((d) => ({
                              ...d,
                              layoutSettings: { ...d.layoutSettings, primaryColor: e.target.value },
                            }))
                          }
                          className="w-8 h-8 rounded-lg cursor-pointer border border-gray-300"
                        />
                        <div>
                          <span className="block text-[11px] font-medium text-gray-500">Primary Header</span>
                          <span className="font-mono text-xs font-bold">{draft.layoutSettings.primaryColor}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 p-2 border border-gray-200 rounded-xl bg-gray-50/50">
                        <input
                          type="color"
                          value={draft.layoutSettings.accentColor}
                          onChange={(e) =>
                            updateDraft((d) => ({
                              ...d,
                              layoutSettings: { ...d.layoutSettings, accentColor: e.target.value },
                            }))
                          }
                          className="w-8 h-8 rounded-lg cursor-pointer border border-gray-300"
                        />
                        <div>
                          <span className="block text-[11px] font-medium text-gray-500">Accent Color</span>
                          <span className="font-mono text-xs font-bold">{draft.layoutSettings.accentColor}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-gray-700 mb-1.5">Typography / Font Family</label>
                    <select
                      value={draft.layoutSettings.fontFamily}
                      onChange={(e) =>
                        updateDraft((d) => ({
                          ...d,
                          layoutSettings: { ...d.layoutSettings, fontFamily: e.target.value as TemplateFontFamily },
                        }))
                      }
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-xs font-semibold text-gray-900"
                    >
                      <option value="inter">Inter (Modern & Clean Default)</option>
                      <option value="roboto">Roboto (Technical & Crisp)</option>
                      <option value="outfit">Outfit (Contemporary Architectural)</option>
                      <option value="montserrat">Montserrat (Geometric & Bold)</option>
                      <option value="playfair">Playfair Display (Luxury Serif)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1.5">Page Orientation</label>
                      <select
                        value={draft.layoutSettings.pageOrientation}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            layoutSettings: { ...d.layoutSettings, pageOrientation: e.target.value as any },
                          }))
                        }
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-xs font-semibold text-gray-900"
                      >
                        <option value="portrait">Portrait (Standard A4)</option>
                        <option value="landscape">Landscape (Wide Tables)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1.5">Logo Position</label>
                      <select
                        value={draft.layoutSettings.logoPosition}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            layoutSettings: { ...d.layoutSettings, logoPosition: e.target.value as any },
                          }))
                        }
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-xs font-semibold text-gray-900"
                      >
                        <option value="left">Left Aligned</option>
                        <option value="center">Centered</option>
                        <option value="right">Right Aligned</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-800">
                      <input
                        type="checkbox"
                        checked={draft.layoutSettings.showWatermark}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            layoutSettings: { ...d.layoutSettings, showWatermark: e.target.checked },
                          }))
                        }
                        className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <span>Show Diagonal Watermark on Pages</span>
                    </label>

                    {draft.layoutSettings.showWatermark && (
                      <input
                        type="text"
                        placeholder="Watermark text (e.g. DRAFT or CONFIDENTIAL)"
                        value={draft.layoutSettings.watermarkText}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            layoutSettings: { ...d.layoutSettings, watermarkText: e.target.value },
                          }))
                        }
                        className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-xs"
                      />
                    )}

                    <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-800">
                      <input
                        type="checkbox"
                        checked={draft.layoutSettings.showPageNumbers}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            layoutSettings: { ...d.layoutSettings, showPageNumbers: e.target.checked },
                          }))
                        }
                        className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <span>Show Page Numbers (e.g. "Page 1 of 5")</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-800">
                      <input
                        type="checkbox"
                        checked={draft.layoutSettings.compactSpacing}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            layoutSettings: { ...d.layoutSettings, compactSpacing: e.target.checked },
                          }))
                        }
                        className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <span>Compact Table Spacing (fits more devices per page)</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-800">
                      <input
                        type="checkbox"
                        checked={draft.layoutSettings.showDealerContactCard}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            layoutSettings: { ...d.layoutSettings, showDealerContactCard: e.target.checked },
                          }))
                        }
                        className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <span>Display Dealer Contact Information Card</span>
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 2: SECTION ORDERING & TOGGLES */}
              {activeTab === "sections" && (
                <div className="space-y-3 text-xs">
                  <p className="text-gray-500">
                    Enable, disable, and order the sections of your proposal proposal. Use the arrows to reorder.
                  </p>

                  <div className="space-y-2">
                    {draft.sectionOrder.map((section, idx) => (
                      <div
                        key={section.id}
                        className={cn(
                          "flex items-center justify-between p-2.5 rounded-xl border transition",
                          section.enabled
                            ? "bg-white border-gray-200 shadow-2xs"
                            : "bg-gray-50/80 border-gray-200/60 opacity-60"
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={section.enabled}
                            disabled={!section.canDisable}
                            onChange={() => toggleSection(section.id)}
                            className="rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                          />
                          <span className="font-semibold text-gray-900">
                            {idx + 1}. {section.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveSection(idx, "up")}
                            disabled={idx === 0}
                            className="p-1 text-gray-500 hover:text-gray-900 disabled:opacity-30 cursor-pointer"
                            title="Move Up"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSection(idx, "down")}
                            disabled={idx === draft.sectionOrder.length - 1}
                            className="p-1 text-gray-500 hover:text-gray-900 disabled:opacity-30 cursor-pointer"
                            title="Move Down"
                          >
                            <ArrowDown size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: CONFIGURABLE COLUMNS */}
              {activeTab === "columns" && (
                <div className="space-y-4 text-xs">
                  <p className="text-gray-500">
                    Configure which columns appear in the Room-by-Room smart equipment breakdown tables.
                  </p>

                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      {
                        key: "showProductImage",
                        label: "Product Photograph / Thumbnail",
                        desc: "Visual product preview",
                      },
                      {
                        key: "showProductCode",
                        label: "Product Code / SKU",
                        desc: "Part reference (e.g. TC-4G-WHT)",
                      },
                      {
                        key: "showSurfaceFinish",
                        label: "Finish / Color Indicator",
                        desc: "Acrylic, Glass, Matte Black, etc.",
                      },
                      {
                        key: "showAutomationTier",
                        label: "Automation Tier",
                        desc: "Standard, Luxury, Edge, etc.",
                      },
                      {
                        key: "showUnitPrice",
                        label: "Unit Price (Per Device)",
                        desc: "Uncheck to present package-only total pricing",
                      },
                      {
                        key: "showTaxPercent",
                        label: "GST Rate Column",
                        desc: "Individual tax % per item",
                      },
                      {
                        key: "showLineTotal",
                        label: "Line Total Column",
                        desc: "Quantity × Unit Price total",
                      },
                      {
                        key: "showItemNotes",
                        label: "Item Notes & Installation Details",
                        desc: "Sub-area locations and technician notes",
                      },
                    ].map((col) => (
                      <label
                        key={col.key}
                        className="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50/50 cursor-pointer transition shadow-2xs"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean((draft.configurableColumns as any)[col.key])}
                          onChange={(e) =>
                            updateDraft((d) => ({
                              ...d,
                              configurableColumns: {
                                ...d.configurableColumns,
                                [col.key]: e.target.checked,
                              },
                            }))
                          }
                          className="mt-0.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                        />
                        <div>
                          <span className="block font-bold text-gray-900">{col.label}</span>
                          <span className="text-[11px] text-gray-500">{col.desc}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: CUSTOM FIELDS */}
              {activeTab === "custom_fields" && (
                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between">
                    <p className="text-gray-500">
                      Define custom fields that appear in quotation headers, summaries, or metadata.
                    </p>
                    <button
                      type="button"
                      onClick={handleAddCustomField}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-900 text-white font-semibold rounded-lg text-xs hover:bg-gray-800 transition cursor-pointer"
                    >
                      <Plus size={12} />
                      <span>Add Field</span>
                    </button>
                  </div>

                  {draft.customFields.length === 0 ? (
                    <div className="p-6 border border-dashed border-gray-200 rounded-xl text-center text-gray-400">
                      No custom fields added yet. Click "Add Field" to add fields like Architect, PO Number, or Project Site Supervisor.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {draft.customFields.map((field) => (
                        <div
                          key={field.id}
                          className="p-3 bg-white border border-gray-200 rounded-xl space-y-2 shadow-2xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) =>
                                updateDraft((d) => ({
                                  ...d,
                                  customFields: d.customFields.map((f) =>
                                    f.id === field.id ? { ...f, label: e.target.value } : f
                                  ),
                                }))
                              }
                              placeholder="Field Label"
                              className="font-bold text-xs px-2 py-1 border border-gray-200 rounded-md w-1/2"
                            />
                            <div className="flex items-center gap-2">
                              <select
                                value={field.type}
                                onChange={(e) =>
                                  updateDraft((d) => ({
                                    ...d,
                                    customFields: d.customFields.map((f) =>
                                      f.id === field.id ? { ...f, type: e.target.value as any } : f
                                    ),
                                  }))
                                }
                                className="text-xs px-2 py-1 border border-gray-200 rounded-md bg-gray-50"
                              >
                                <option value="text">Text</option>
                                <option value="date">Date</option>
                                <option value="number">Number</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomField(field.id)}
                                className="text-gray-400 hover:text-rose-600 p-1 cursor-pointer"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <input
                              type="text"
                              placeholder="Placeholder text"
                              value={field.placeholder || ""}
                              onChange={(e) =>
                                updateDraft((d) => ({
                                  ...d,
                                  customFields: d.customFields.map((f) =>
                                    f.id === field.id ? { ...f, placeholder: e.target.value } : f
                                  ),
                                }))
                              }
                              className="px-2 py-1 border border-gray-200 rounded-md"
                            />
                            <label className="flex items-center gap-1.5 text-gray-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) =>
                                  updateDraft((d) => ({
                                    ...d,
                                    customFields: d.customFields.map((f) =>
                                      f.id === field.id ? { ...f, required: e.target.checked } : f
                                    ),
                                  }))
                                }
                                className="rounded text-gray-900"
                              />
                              <span>Required field</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: NUMBERING */}
              {activeTab === "numbering" && (
                <div className="space-y-4 text-xs">
                  <div className="p-3 bg-gray-900 text-white rounded-xl space-y-1">
                    <span className="text-[10px] uppercase font-bold text-gray-400">Next Quotation Number Preview:</span>
                    <div className="text-lg font-mono font-black text-emerald-400 tracking-wider">
                      {sampleQuotationNumber}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Prefix</label>
                      <input
                        type="text"
                        value={draft.numberingFormat.prefix}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            numberingFormat: { ...d.numberingFormat, prefix: e.target.value.toUpperCase() },
                          }))
                        }
                        placeholder="e.g. QT or WHYTE"
                        className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Separator</label>
                      <input
                        type="text"
                        value={draft.numberingFormat.separator}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            numberingFormat: { ...d.numberingFormat, separator: e.target.value },
                          }))
                        }
                        placeholder="e.g. - or /"
                        className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Year Format</label>
                      <select
                        value={draft.numberingFormat.yearFormat}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            numberingFormat: { ...d.numberingFormat, yearFormat: e.target.value as any },
                          }))
                        }
                        className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-semibold"
                      >
                        <option value="YYYY">4-digit (2026)</option>
                        <option value="YY">2-digit (26)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">Sequence Digits</label>
                      <select
                        value={draft.numberingFormat.digitCount}
                        onChange={(e) =>
                          updateDraft((d) => ({
                            ...d,
                            numberingFormat: { ...d.numberingFormat, digitCount: Number(e.target.value) },
                          }))
                        }
                        className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-semibold"
                      >
                        <option value={3}>3 digits (001)</option>
                        <option value={4}>4 digits (0001)</option>
                        <option value={5}>5 digits (00001)</option>
                        <option value={6}>6 digits (000001)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Optional Suffix</label>
                    <input
                      type="text"
                      value={draft.numberingFormat.suffix || ""}
                      onChange={(e) =>
                        updateDraft((d) => ({
                          ...d,
                          numberingFormat: { ...d.numberingFormat, suffix: e.target.value.toUpperCase() },
                        }))
                      }
                      placeholder="e.g. IN or DL"
                      className="w-full px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Live Split-Screen Preview (7 cols) */}
          <div className="lg:col-span-7 bg-gray-100/70 border border-gray-200/80 rounded-2xl p-5 shadow-xs flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-gray-700" />
                <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Live Proposal Preview
                </span>
              </div>
              <span className="text-[11px] font-mono text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">
                WYSIWYG Mode • {draft.layoutSettings.pageOrientation}
              </span>
            </div>

            {/* A4 Paper Simulation Canvas */}
            <div
              className={cn(
                "relative mx-auto bg-white rounded-xl shadow-md border border-gray-200 p-6 transition-all duration-300 overflow-hidden",
                draft.layoutSettings.pageOrientation === "landscape" ? "w-full min-h-[460px]" : "w-full max-w-[620px] min-h-[720px]",
                draft.layoutSettings.fontFamily === "roboto" && "font-sans",
                draft.layoutSettings.fontFamily === "playfair" && "font-serif",
                draft.layoutSettings.fontFamily === "outfit" && "font-sans tracking-wide"
              )}
              style={{
                borderColor: draft.layoutSettings.primaryColor + "33",
              }}
            >
              {/* Optional Watermark */}
              {draft.layoutSettings.showWatermark && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 opacity-10 rotate-[-30deg]">
                  <span className="text-6xl font-black uppercase text-gray-900 tracking-widest">
                    {draft.layoutSettings.watermarkText || "CONFIDENTIAL"}
                  </span>
                </div>
              )}

              {/* Cover / Header Section */}
              <div
                className="pb-5 mb-5 border-b"
                style={{
                  borderBottomColor: draft.layoutSettings.primaryColor + "22",
                }}
              >
                <div
                  className={cn(
                    "flex items-start justify-between gap-4",
                    draft.layoutSettings.logoPosition === "center" && "flex-col items-center text-center",
                    draft.layoutSettings.logoPosition === "right" && "flex-row-reverse"
                  )}
                >
                  <div>
                    <h1
                      className="text-xl font-black tracking-tight"
                      style={{ color: draft.layoutSettings.primaryColor }}
                    >
                      Smart Automation Proposal
                    </h1>
                    <p className="text-xs text-gray-500 font-medium">Prepared for Mr. & Mrs. Sharma</p>
                  </div>
                  <div className="text-right">
                    <span
                      className="inline-block px-2.5 py-1 rounded-md text-xs font-mono font-bold text-white shadow-2xs"
                      style={{ backgroundColor: draft.layoutSettings.accentColor }}
                    >
                      {sampleQuotationNumber}
                    </span>
                    <span className="block text-[10px] text-gray-400 mt-1">Date: 17 Nov 2026</span>
                  </div>
                </div>

                {/* Custom fields in metadata if any */}
                {draft.customFields.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-[11px]">
                    {draft.customFields.map((f) => (
                      <div key={f.id} className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-600">{f.label}:</span>
                        <span className="text-gray-900">{f.defaultValue || f.placeholder || "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Simulated Sections Preview */}
              <div className="space-y-4">
                {/* Active Section Checklist Indicator */}
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-[11px] space-y-1">
                  <span className="font-bold text-gray-600 uppercase tracking-wider text-[10px] block">
                    Document Sections in Proposal:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {draft.sectionOrder
                      .filter((s) => s.enabled)
                      .map((s, idx) => (
                        <span
                          key={s.id}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold bg-white border border-gray-200 text-gray-700 shadow-2xs"
                        >
                          {idx + 1}. {s.name}
                        </span>
                      ))}
                  </div>
                </div>

                {/* Simulated Equipment Table Preview */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: draft.layoutSettings.accentColor }}
                    >
                      Living Room • 4 Devices
                    </span>
                    <span className="text-xs font-bold text-gray-900">₹ 42,500</span>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden text-[11px]">
                    <table className="w-full text-left">
                      <thead
                        className="text-white text-[10px] uppercase font-bold"
                        style={{ backgroundColor: draft.layoutSettings.primaryColor }}
                      >
                        <tr>
                          {draft.configurableColumns.showProductImage && <th className="p-2 w-10">Photo</th>}
                          <th className="p-2">Item Description</th>
                          {draft.configurableColumns.showProductCode && <th className="p-2">Code</th>}
                          {draft.configurableColumns.showSurfaceFinish && <th className="p-2">Finish</th>}
                          {draft.configurableColumns.showAutomationTier && <th className="p-2">Tier</th>}
                          <th className="p-2 text-center w-12">Qty</th>
                          {draft.configurableColumns.showUnitPrice && <th className="p-2 text-right">Unit Rate</th>}
                          {draft.configurableColumns.showTaxPercent && <th className="p-2 text-center">GST %</th>}
                          {draft.configurableColumns.showLineTotal && <th className="p-2 text-right">Total</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        <tr className="hover:bg-gray-50/50">
                          {draft.configurableColumns.showProductImage && (
                            <td className="p-2">
                              <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200 flex items-center justify-center text-[9px] text-gray-400">
                                4G
                              </div>
                            </td>
                          )}
                          <td className="p-2 font-semibold text-gray-900">
                            Tactus 4-Gang Touch Panel
                            {draft.configurableColumns.showItemNotes && (
                              <span className="block text-[10px] text-gray-500 font-normal">
                                Near Main Entrance
                              </span>
                            )}
                          </td>
                          {draft.configurableColumns.showProductCode && (
                            <td className="p-2 font-mono text-gray-500">TC-04G-ACR</td>
                          )}
                          {draft.configurableColumns.showSurfaceFinish && (
                            <td className="p-2 text-gray-600">Acrylic White</td>
                          )}
                          {draft.configurableColumns.showAutomationTier && (
                            <td className="p-2">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                Luxury
                              </span>
                            </td>
                          )}
                          <td className="p-2 text-center font-bold">2</td>
                          {draft.configurableColumns.showUnitPrice && (
                            <td className="p-2 text-right text-gray-600">₹ 8,500</td>
                          )}
                          {draft.configurableColumns.showTaxPercent && (
                            <td className="p-2 text-center text-gray-500">18%</td>
                          )}
                          {draft.configurableColumns.showLineTotal && (
                            <td className="p-2 text-right font-bold text-gray-900">₹ 17,000</td>
                          )}
                        </tr>

                        <tr className="hover:bg-gray-50/50">
                          {draft.configurableColumns.showProductImage && (
                            <td className="p-2">
                              <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200 flex items-center justify-center text-[9px] text-gray-400">
                                CUR
                              </div>
                            </td>
                          )}
                          <td className="p-2 font-semibold text-gray-900">
                            Smart Motorized Curtain Controller
                            {draft.configurableColumns.showItemNotes && (
                              <span className="block text-[10px] text-gray-500 font-normal">
                                Balcony French Windows
                              </span>
                            )}
                          </td>
                          {draft.configurableColumns.showProductCode && (
                            <td className="p-2 font-mono text-gray-500">CUR-MOT-ZIG</td>
                          )}
                          {draft.configurableColumns.showSurfaceFinish && (
                            <td className="p-2 text-gray-600">Matte Black</td>
                          )}
                          {draft.configurableColumns.showAutomationTier && (
                            <td className="p-2">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-50 text-sky-800 border border-sky-200">
                                Edge
                              </span>
                            </td>
                          )}
                          <td className="p-2 text-center font-bold">1</td>
                          {draft.configurableColumns.showUnitPrice && (
                            <td className="p-2 text-right text-gray-600">₹ 12,000</td>
                          )}
                          {draft.configurableColumns.showTaxPercent && (
                            <td className="p-2 text-center text-gray-500">18%</td>
                          )}
                          {draft.configurableColumns.showLineTotal && (
                            <td className="p-2 text-right font-bold text-gray-900">₹ 12,000</td>
                          )}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Simulated Pricing Footer */}
                <div className="pt-3 border-t border-gray-200 flex justify-between items-center text-xs">
                  <span className="font-semibold text-gray-500">Total Investment (Incl. GST):</span>
                  <span
                    className="text-base font-black tracking-tight"
                    style={{ color: draft.layoutSettings.primaryColor }}
                  >
                    ₹ 1,84,500
                  </span>
                </div>
              </div>

              {/* Page Numbering Simulation */}
              {draft.layoutSettings.showPageNumbers && (
                <div className="mt-8 pt-3 border-t border-gray-100 flex justify-between text-[10px] text-gray-400">
                  <span>Smart Home Automation Proposal</span>
                  <span>Page 1 of 4</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
