"use client";

import React, { useState } from "react";
import {
  Type,
  AlignLeft,
  Hash,
  Mail,
  Phone,
  Calendar,
  ListFilter,
  CheckSquare,
  CircleDot,
  Image as ImageIcon,
  FileText,
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Columns,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  type WorkflowStepDefinition,
  type WorkflowFormSection,
  type WorkflowFieldDefinition,
  type WorkflowFieldType,
  type SectionLayoutType,
  CANONICAL_PROJECT_SECTIONS,
} from "@/types/template";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import FieldPropertiesPanel from "./FieldPropertiesPanel";

function generateFieldId(): string {
  return "fld_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
}

interface VisualFormCanvasProps {
  step: WorkflowStepDefinition;
  onUpdateStep: (updated: WorkflowStepDefinition) => void;
}

const FIELD_PALETTE: Array<{
  type: WorkflowFieldType;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  defaultWidth: "full" | "half" | "third";
}> = [
  { type: "text", label: "Text Field", icon: Type, defaultWidth: "half" },
  { type: "textarea", label: "Text Area", icon: AlignLeft, defaultWidth: "full" },
  { type: "number", label: "Number", icon: Hash, defaultWidth: "half" },
  { type: "email", label: "Email", icon: Mail, defaultWidth: "half" },
  { type: "phone", label: "Phone", icon: Phone, defaultWidth: "half" },
  { type: "date", label: "Date Picker", icon: Calendar, defaultWidth: "half" },
  { type: "select", label: "Dropdown Select", icon: ListFilter, defaultWidth: "half" },
  { type: "multiselect", label: "Multi-Select", icon: CheckSquare, defaultWidth: "half" },
  { type: "radio", label: "Radio Choices", icon: CircleDot, defaultWidth: "half" },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare, defaultWidth: "half" },
  { type: "image", label: "Image Upload", icon: ImageIcon, defaultWidth: "full" },
  { type: "file", label: "File Upload", icon: FileText, defaultWidth: "full" },
];

export default function VisualFormCanvas({ step, onUpdateStep }: VisualFormCanvasProps) {
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const confirm = useConfirm();

  const sections = React.useMemo(() => step.sections || [], [step.sections]);

  // Find currently selected field and its section
  const selectedFieldInfo = React.useMemo(() => {
    if (!selectedFieldId) return null;
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const f = sections[sIdx].fields.find((field) => field.id === selectedFieldId);
      if (f) return { field: f, sectionIndex: sIdx };
    }
    return null;
  }, [sections, selectedFieldId]);

  // Extract all existing field keys for uniqueness validation
  const existingKeys = React.useMemo(() => {
    return sections.flatMap((sec) => sec.fields.map((f) => f.key));
  }, [sections]);

  // Section Management Handlers
  const handleAddSection = () => {
    const newSection: WorkflowFormSection = {
      id: "sec_" + Date.now().toString(36),
      title: "New Form Section",
      description: "Section description and guidelines",
      layout: "two_column",
      spacing: "normal",
      sortOrder: sections.length + 1,
      fields: [],
    };
    onUpdateStep({
      ...step,
      sections: [...sections, newSection],
    });
  };

  const handleUpdateSection = (index: number, updater: (prev: WorkflowFormSection) => WorkflowFormSection) => {
    const next = [...sections];
    next[index] = updater(next[index]);
    onUpdateStep({ ...step, sections: next });
  };

  const handleDeleteSection = async (index: number) => {
    if (sections.length <= 1) {
      toast.error("A custom form step must have at least one section.");
      return;
    }
    const sec = sections[index];
    const ok = await confirm({
      title: `Delete Section "${sec.title}"?`,
      message: `Are you sure you want to delete section "${sec.title}" and all its ${sec.fields.length} field(s)?`,
      detail: "This will remove the section and its configured fields from this form step.",
      confirmText: "Delete Section",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    const next = sections.filter((_, i) => i !== index);
    onUpdateStep({ ...step, sections: next });
    toast.success(`Section "${sec.title}" deleted.`);
  };

  const handleMoveSection = (index: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    const next = [...sections];
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    next.forEach((s, idx) => (s.sortOrder = idx + 1));
    onUpdateStep({ ...step, sections: next });
  };

  // Field Management Handlers
  const handleAddField = (sectionIndex: number, type: WorkflowFieldType) => {
    const def = FIELD_PALETTE.find((p) => p.type === type);
    const count = existingKeys.length + 1;
    const baseKey = `${type}_${count}`;

    const newField: WorkflowFieldDefinition = {
      id: generateFieldId(),
      key: baseKey,
      label: `New ${def?.label || "Field"}`,
      type,
      placeholder: `Enter ${def?.label || "value"}...`,
      required: false,
      layout: {
        width: def?.defaultWidth || "half",
        alignment: "left",
      },
      options:
        type === "select" || type === "multiselect" || type === "radio"
          ? [
              { label: "Option A", value: "opt_a" },
              { label: "Option B", value: "opt_b" },
            ]
          : undefined,
    };

    handleUpdateSection(sectionIndex, (sec) => ({
      ...sec,
      fields: [...sec.fields, newField],
    }));

    setSelectedFieldId(newField.id);
  };

  const handleUpdateField = (updated: WorkflowFieldDefinition) => {
    if (!selectedFieldInfo) return;
    const sIdx = selectedFieldInfo.sectionIndex;
    handleUpdateSection(sIdx, (sec) => ({
      ...sec,
      fields: sec.fields.map((f) => (f.id === updated.id ? updated : f)),
    }));
  };

  const handleDeleteField = (sectionIndex: number, fieldId: string) => {
    handleUpdateSection(sectionIndex, (sec) => ({
      ...sec,
      fields: sec.fields.filter((f) => f.id !== fieldId),
    }));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  };

  const handleDuplicateField = (sectionIndex: number, field: WorkflowFieldDefinition) => {
    const dup: WorkflowFieldDefinition = {
      ...JSON.parse(JSON.stringify(field)),
      id: generateFieldId(),
      key: `${field.key}_copy`,
      label: `${field.label} (Copy)`,
    };

    handleUpdateSection(sectionIndex, (sec) => ({
      ...sec,
      fields: [...sec.fields, dup],
    }));

    setSelectedFieldId(dup.id);
  };

  const handleMoveField = (sectionIndex: number, fieldIndex: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? fieldIndex - 1 : fieldIndex + 1;
    const sec = sections[sectionIndex];
    if (targetIdx < 0 || targetIdx >= sec.fields.length) return;

    handleUpdateSection(sectionIndex, (s) => {
      const nextFields = [...s.fields];
      const temp = nextFields[fieldIndex];
      nextFields[fieldIndex] = nextFields[targetIdx];
      nextFields[targetIdx] = temp;
      return { ...s, fields: nextFields };
    });
  };

  const isProjectStep = step.id === "step_project" || step.builtinModule === "project_details";

  const handleResetToStandardWhyte = async () => {
    const ok = await confirm({
      title: "Reset to Standard Whyte Project Fields?",
      message: "This will reset this step back to the canonical Whyte Project Details field layout.",
      detail: "Any custom fields added to this step will be removed and replaced with the standard fields.",
      confirmText: "Reset to Whyte Defaults",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    onUpdateStep({
      ...step,
      sections: JSON.parse(JSON.stringify(CANONICAL_PROJECT_SECTIONS)),
    });
    toast.success("Reset to standard Whyte Project Details fields.");
  };

  return (
    <div className="space-y-6">
      {/* Step Context Banner */}
      {isProjectStep && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl text-xs">
          <div className="flex items-center gap-2 text-indigo-950 font-medium">
            <Sparkles size={15} className="text-indigo-600 shrink-0" />
            <span>
              <strong>Project Details Form:</strong> System-bound fields synchronize directly with root quotation properties. You can customize labels, placeholders, widths, or reorder freely.
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetToStandardWhyte}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 border border-indigo-200 text-indigo-900 rounded-xl text-xs font-semibold transition cursor-pointer shadow-2xs"
            title="Restore canonical Whyte project fields"
          >
            <RotateCcw size={12} className="text-indigo-600" />
            <span>Reset to Whyte Defaults</span>
          </button>
        </div>
      )}

      {/* Sections List */}
      <div className="space-y-6">
        {sections.map((section, sIdx) => (
          <div
            key={section.id}
            className="border border-gray-200/90 rounded-2xl bg-white shadow-2xs overflow-hidden"
          >
            {/* Section Header Controls */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[220px] space-y-1">
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) =>
                    handleUpdateSection(sIdx, (s) => ({ ...s, title: e.target.value }))
                  }
                  className="font-bold text-sm text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-accent focus:bg-white focus:outline-hidden px-1.5 py-0.5 rounded transition w-full"
                  placeholder="Section Title"
                />
                <input
                  type="text"
                  value={section.description || ""}
                  onChange={(e) =>
                    handleUpdateSection(sIdx, (s) => ({ ...s, description: e.target.value }))
                  }
                  className="text-xs text-gray-500 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-accent focus:bg-white focus:outline-hidden px-1.5 py-0.5 rounded transition w-full"
                  placeholder="Optional section description or instructions..."
                />
              </div>

              {/* Section Settings (Layout, Move, Delete) */}
              <div className="flex items-center gap-2">
                {/* Layout Dropdown */}
                <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-2 py-1 text-xs">
                  <Columns size={12} className="text-gray-400" />
                  <select
                    value={section.layout}
                    onChange={(e) =>
                      handleUpdateSection(sIdx, (s) => ({
                        ...s,
                        layout: e.target.value as SectionLayoutType,
                      }))
                    }
                    className="bg-transparent font-medium text-gray-700 focus:outline-hidden text-xs cursor-pointer"
                  >
                    <option value="single_column">1 Column</option>
                    <option value="two_column">2 Columns</option>
                    <option value="three_column">3 Columns</option>
                  </select>
                </div>

                {/* Move Section */}
                <div className="flex items-center border border-gray-200 bg-white rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleMoveSection(sIdx, "up")}
                    disabled={sIdx === 0}
                    className="p-1.5 hover:bg-gray-100 disabled:opacity-30 transition cursor-pointer"
                    title="Move section up"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveSection(sIdx, "down")}
                    disabled={sIdx === sections.length - 1}
                    className="p-1.5 hover:bg-gray-100 disabled:opacity-30 transition cursor-pointer"
                    title="Move section down"
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>

                {/* Delete Section */}
                <button
                  type="button"
                  onClick={() => handleDeleteSection(sIdx)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
                  title="Delete section"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Fields Grid Canvas */}
            <div className="p-4 sm:p-5">
              {section.fields.length === 0 ? (
                <div className="py-8 text-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                  <p className="text-xs font-semibold text-gray-500">
                    No fields in this section yet.
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Click a field type from the palette below to add it.
                  </p>
                </div>
              ) : (
                <div
                  className={`grid gap-3 ${
                    section.layout === "single_column"
                      ? "grid-cols-1"
                      : section.layout === "three_column"
                      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                      : "grid-cols-1 sm:grid-cols-2"
                  }`}
                >
                  {section.fields.map((field, fIdx) => {
                    const isSelected = selectedFieldId === field.id;
                    const paletteItem = FIELD_PALETTE.find((p) => p.type === field.type);
                    const Icon = paletteItem?.icon || Type;

                    const widthClass =
                      field.layout?.width === "full"
                        ? section.layout === "three_column"
                          ? "sm:col-span-2 lg:col-span-3"
                          : "sm:col-span-2"
                        : "col-span-1";

                    return (
                      <div
                        key={field.id}
                        onClick={() => setSelectedFieldId(field.id)}
                        className={`group relative p-3 rounded-xl border-2 transition cursor-pointer ${
                          isSelected
                            ? "border-accent bg-accent/5 ring-2 ring-accent/20 shadow-xs"
                            : "border-gray-200 hover:border-gray-300 bg-white"
                        } ${widthClass}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="p-1 rounded-md bg-gray-100 text-gray-600 group-hover:bg-accent/10 group-hover:text-accent transition">
                              <Icon size={14} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-bold text-gray-900 truncate">
                                  {field.label}
                                </span>
                                {field.required && (
                                  <span className="text-red-500 text-xs font-bold">*</span>
                                )}
                                {field.systemBinding && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    ⚡ {field.systemBinding}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-mono text-gray-400 truncate block">
                                key: {field.key}
                              </span>
                            </div>
                          </div>

                          {/* Quick Action Buttons */}
                          <div
                            className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleMoveField(sIdx, fIdx, "up")}
                              disabled={fIdx === 0}
                              className="p-1 hover:bg-gray-100 rounded disabled:opacity-20 text-gray-500"
                              title="Move field up"
                            >
                              <ArrowUp size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveField(sIdx, fIdx, "down")}
                              disabled={fIdx === section.fields.length - 1}
                              className="p-1 hover:bg-gray-100 rounded disabled:opacity-20 text-gray-500"
                              title="Move field down"
                            >
                              <ArrowDown size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateField(sIdx, field)}
                              className="p-1 hover:bg-gray-100 rounded text-gray-500"
                              title="Duplicate field"
                            >
                              <Copy size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteField(sIdx, field.id)}
                              className="p-1 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded"
                              title="Delete field"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Badges Footer */}
                        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                          <span className="capitalize">{field.layout?.width || "half"} width</span>
                          {field.visibilityCondition?.fieldKey && (
                            <span className="text-amber-600 font-medium">Conditional</span>
                          )}
                          {field.documentMapping?.targetSection && (
                            <span className="text-accent font-medium">Mapped to PDF</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Field Palette / Quick Add Toolbar */}
              <div className="mt-4 pt-4 border-t border-gray-100">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-2">
                  + Add Field to Section
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {FIELD_PALETTE.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => handleAddField(sIdx, item.type)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-xs font-medium rounded-xl transition cursor-pointer"
                      >
                        <ItemIcon size={12} className="text-gray-500" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add New Section Button */}
      <button
        type="button"
        onClick={handleAddSection}
        className="w-full py-3.5 border-2 border-dashed border-gray-300 hover:border-gray-400 bg-gray-50/50 hover:bg-gray-100/50 rounded-2xl text-xs font-bold text-gray-700 inline-flex items-center justify-center gap-2 transition cursor-pointer shadow-2xs"
      >
        <Plus size={15} />
        <span>Add Another Section to this Step</span>
      </button>

      {/* Field Properties Slide-over */}
      {selectedFieldInfo && (
        <FieldPropertiesPanel
          field={selectedFieldInfo.field}
          availableParentKeys={existingKeys}
          onUpdate={handleUpdateField}
          onClose={() => setSelectedFieldId(null)}
          onDelete={() => {
            handleDeleteField(selectedFieldInfo.sectionIndex, selectedFieldInfo.field.id);
            setSelectedFieldId(null);
          }}
          existingKeys={existingKeys}
        />
      )}
    </div>
  );
}
