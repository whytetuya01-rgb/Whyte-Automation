"use client";

import React, { useState } from "react";
import toast from "react-hot-toast";
import {
  X,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sliders,
  Sparkles,
} from "lucide-react";
import type {
  WorkflowFieldDefinition,
  ConditionOperator,
  FieldWidth,
  SystemFieldBinding,
} from "@/types/template";

interface FieldPropertiesPanelProps {
  field: WorkflowFieldDefinition;
  availableParentKeys: string[];
  onUpdate: (updated: WorkflowFieldDefinition) => void;
  onClose: () => void;
  onDelete: () => void;
  existingKeys: string[];
}

export default function FieldPropertiesPanel({
  field,
  availableParentKeys,
  onUpdate,
  onClose,
  onDelete,
  existingKeys,
}: FieldPropertiesPanelProps) {
  const [label, setLabel] = useState(field.label);
  const [key, setKey] = useState(field.key);
  const [placeholder, setPlaceholder] = useState(field.placeholder || "");
  const [helpText, setHelpText] = useState(field.helpText || "");
  const [required, setRequired] = useState(Boolean(field.required));
  const [defaultValue, setDefaultValue] = useState(field.defaultValue ?? "");
  const [systemBinding, setSystemBinding] = useState<SystemFieldBinding | undefined>(field.systemBinding);

  // Layout width
  const [width, setWidth] = useState<FieldWidth>(field.layout?.width || "half");

  // Options for select, multiselect, radio
  const hasOptions = field.type === "select" || field.type === "multiselect" || field.type === "radio";
  const [options, setOptions] = useState<Array<{ label: string; value: string }>>(
    field.options || [
      { label: "Option 1", value: "opt_1" },
      { label: "Option 2", value: "opt_2" },
    ]
  );

  // Advanced section accordion
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(field.visibilityCondition?.fieldKey || field.validationRule?.min !== undefined || field.validationRule?.pattern)
  );

  // Validation
  const [minVal, setMinVal] = useState<string>(field.validationRule?.min !== undefined ? String(field.validationRule.min) : "");
  const [maxVal, setMaxVal] = useState<string>(field.validationRule?.max !== undefined ? String(field.validationRule.max) : "");
  const [pattern, setPattern] = useState(field.validationRule?.pattern || "");
  const [validationMessage, setValidationMessage] = useState(field.validationRule?.message || "");

  // Conditional Visibility
  const [hasCondition, setHasCondition] = useState(Boolean(field.visibilityCondition?.fieldKey));
  const [condFieldKey, setCondFieldKey] = useState(field.visibilityCondition?.fieldKey || "");
  const [condOperator, setCondOperator] = useState<ConditionOperator>(field.visibilityCondition?.operator || "equals");
  const [condValue, setCondValue] = useState(field.visibilityCondition?.value !== undefined ? String(field.visibilityCondition.value) : "");

  const handleSave = () => {
    const sanitizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "") || "field_" + Date.now().toString(36);

    if (sanitizedKey !== field.key && existingKeys.includes(sanitizedKey)) {
      toast.error(`The field key "${sanitizedKey}" is already in use. Please choose a unique key.`);
      return;
    }

    const updatedField: WorkflowFieldDefinition = {
      ...field,
      label: label.trim() || "Untitled Field",
      key: sanitizedKey,
      systemBinding: systemBinding || undefined,
      placeholder: placeholder.trim() || undefined,
      helpText: helpText.trim() || undefined,
      required: systemBinding === "clientName" ? true : required,
      defaultValue: defaultValue !== "" ? defaultValue : undefined,
      options: hasOptions ? options : undefined,
      layout: {
        width,
        alignment: "left",
      },
      validationRule:
        field.type === "number" && (minVal !== "" || maxVal !== "")
          ? {
              min: minVal !== "" ? Number(minVal) : undefined,
              max: maxVal !== "" ? Number(maxVal) : undefined,
              message: validationMessage.trim() || undefined,
            }
          : pattern.trim()
          ? {
              pattern: pattern.trim(),
              message: validationMessage.trim() || undefined,
            }
          : undefined,
      visibilityCondition:
        hasCondition && condFieldKey
          ? {
              fieldKey: condFieldKey,
              operator: condOperator,
              value: condOperator === "is_not_empty" || condOperator === "is_empty" ? undefined : condValue,
            }
          : undefined,
    };

    onUpdate(updatedField);
    onClose();
  };

  const handleAddOption = () => {
    const idx = options.length + 1;
    setOptions([...options, { label: `Option ${idx}`, value: `opt_${idx}` }]);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length <= 1) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, keyProp: "label" | "value", val: string) => {
    const next = [...options];
    next[index][keyProp] = val;
    if (keyProp === "label" && (!next[index].value || next[index].value.startsWith("opt_"))) {
      next[index].value = val.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    }
    setOptions(next);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-slideLeft">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/80">
        <div className="flex items-center gap-2.5">
          <span className="px-2 py-0.5 rounded-lg bg-primary/10 text-primary font-mono text-xs font-bold uppercase">
            {field.type}
          </span>
          <div>
            <h3 className="text-sm font-bold text-gray-900 leading-tight">Edit Field</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Configure input settings and rules</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
          aria-label="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Main Settings Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* System Binding Banner */}
        {systemBinding && (
          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1">
                ⚡ Linked to Quotation {systemBinding}
              </span>
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-mono text-[10px] font-bold">
                {systemBinding}
              </span>
            </div>
            <p className="text-[11px] text-indigo-700 leading-relaxed">
              Stores value directly into the quotation database. Changing the label or layout maintains synchronization.
            </p>
          </div>
        )}

        {/* Field Label */}
        <div>
          <label className="block text-xs font-bold text-gray-800 mb-1.5">
            Field Label <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              if (!key || key.startsWith("field_")) {
                setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32));
              }
            }}
            placeholder="e.g. Customer Name, Site Address, Architect"
            autoFocus
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition"
          />
        </div>

        {/* Database System Binding Dropdown */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            Database Binding (Optional)
          </label>
          <select
            value={systemBinding || ""}
            onChange={(e) => {
              const val = e.target.value as SystemFieldBinding | "";
              setSystemBinding(val || undefined);
              if (val === "clientName") setRequired(true);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs bg-white text-gray-800 font-medium focus:outline-hidden focus:ring-2 focus:ring-primary"
          >
            <option value="">None (Saved as Custom Field)</option>
            <option value="clientName">clientName — Customer / Client Name (Required for Quotes)</option>
            <option value="clientPhone">clientPhone — Contact Phone Number</option>
            <option value="clientEmail">clientEmail — Contact Email Address</option>
            <option value="clientGstNumber">clientGstNumber — GSTIN Number</option>
            <option value="projectName">projectName — Project / Apartment Name</option>
            <option value="clientAddress">clientAddress — Site Location / Address</option>
            <option value="premisesName">premisesName — Custom Premises / Villa Type</option>
            <option value="notes">notes — Project Scope & Notes</option>
            <option value="customerId">customerId — CRM Customer Reference ID</option>
            <option value="leadId">leadId — CRM Lead Reference ID</option>
          </select>
        </div>

        {/* Width Selector */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            Field Width in Form
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setWidth("half")}
              className={`px-3 py-2 text-xs font-semibold rounded-xl border transition cursor-pointer text-center ${
                width === "half"
                  ? "bg-primary text-white border-primary shadow-2xs"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              Half Width (50%)
            </button>
            <button
              type="button"
              onClick={() => setWidth("full")}
              className={`px-3 py-2 text-xs font-semibold rounded-xl border transition cursor-pointer text-center ${
                width === "full"
                  ? "bg-primary text-white border-primary shadow-2xs"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              Full Width (100%)
            </button>
          </div>
        </div>

        {/* Required Toggle */}
        <div className="pt-1">
          <label className="flex items-center gap-3 cursor-pointer p-3 border border-gray-200 rounded-xl bg-gray-50/60 hover:bg-gray-100/60 transition">
            <input
              type="checkbox"
              checked={systemBinding === "clientName" ? true : required}
              disabled={systemBinding === "clientName"}
              onChange={(e) => setRequired(e.target.checked)}
              className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary disabled:opacity-50"
            />
            <div>
              <span className="text-xs font-bold text-gray-900 block">
                Required Field {systemBinding === "clientName" && "(Mandatory for quotation creation)"}
              </span>
              <span className="text-[11px] text-gray-500 block">
                User cannot proceed past this step without entering a value.
              </span>
            </div>
          </label>
        </div>

        {/* Placeholder & Help Text */}
        <div className="space-y-3 pt-1">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Placeholder Text</label>
            <input
              type="text"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
              placeholder="e.g. Enter full client name or company"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Help Note (Optional)</label>
            <input
              type="text"
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              placeholder="e.g. As per municipal / tax records"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Options Editor (Only if Select, Multi-select, Radio) */}
        {hasOptions && (
          <div className="space-y-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-800">Choice Options ({options.length})</label>
              <button
                type="button"
                onClick={handleAddOption}
                className="inline-flex items-center gap-1 text-xs text-primary font-bold hover:underline cursor-pointer"
              >
                <Plus size={12} /> Add Choice
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={opt.label}
                    onChange={(e) => handleOptionChange(idx, "label", e.target.value)}
                    placeholder={`Choice ${idx + 1}`}
                    className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs"
                  />
                  {options.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(idx)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded cursor-pointer"
                      title="Remove choice"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Collapsible Advanced Settings (Conditional visibility & Slug) */}
        <div className="pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="w-full flex items-center justify-between text-xs font-bold text-gray-700 hover:text-gray-900 cursor-pointer py-1"
          >
            <span className="flex items-center gap-1.5">
              <Sliders size={13} />
              <span>Advanced Settings</span>
            </span>
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvanced && (
            <div className="mt-3 p-3.5 bg-gray-50 rounded-xl space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-600 mb-1">
                  Field Slug Key (Database Property)
                </label>
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  className="w-full px-3 py-1.5 font-mono text-xs border border-gray-300 rounded-lg bg-white"
                />
              </div>

              {/* Conditional Visibility */}
              <div className="pt-2 border-t border-gray-200">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-gray-700 mb-2">
                  <input
                    type="checkbox"
                    checked={hasCondition}
                    onChange={(e) => setHasCondition(e.target.checked)}
                    className="w-3.5 h-3.5 text-primary rounded"
                  />
                  <span>Show conditionally based on another field</span>
                </label>

                {hasCondition && (
                  <div className="space-y-2 bg-white p-2.5 rounded-lg border border-gray-200">
                    <div>
                      <span className="text-[10px] text-gray-500 block mb-0.5">Depends on field key:</span>
                      <input
                        type="text"
                        value={condFieldKey}
                        onChange={(e) => setCondFieldKey(e.target.value)}
                        placeholder="e.g. projectType"
                        className="w-full px-2 py-1 font-mono text-xs border rounded"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={condOperator}
                        onChange={(e) => setCondOperator(e.target.value as ConditionOperator)}
                        className="px-2 py-1 border rounded text-xs"
                      >
                        <option value="equals">equals</option>
                        <option value="not_equals">not equals</option>
                        <option value="is_not_empty">is not empty</option>
                        <option value="is_empty">is empty</option>
                      </select>
                      {condOperator !== "is_not_empty" && condOperator !== "is_empty" && (
                        <input
                          type="text"
                          value={condValue}
                          onChange={(e) => setCondValue(e.target.value)}
                          placeholder="value"
                          className="px-2 py-1 border rounded text-xs"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/80 flex items-center justify-between">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-semibold transition cursor-pointer"
        >
          <Trash2 size={13} />
          <span>Delete Field</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 hover:bg-gray-100 rounded-xl text-xs font-semibold text-gray-700 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            <Check size={14} />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
