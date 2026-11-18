"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { ArrowLeft, ArrowRight, X, FileText, Image as ImageIcon, AlertCircle, Upload, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import type { WorkflowStepDefinition, WorkflowFieldDefinition, WorkflowFormSection } from "@/types/template";
import { evaluateVisibilityCondition, validateCustomFieldValues } from "@/lib/templateValidation";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

interface Props {
  step: WorkflowStepDefinition;
  initialValues?: Record<string, any>;
  onSaveAndContinue: (values: Record<string, any>) => Promise<void>;
  onBack: () => void;
  onSkip?: () => void;
  isSaving?: boolean;
  isLocked?: boolean;
}

export default function DynamicFormStep({
  step,
  initialValues = {},
  onSaveAndContinue,
  onBack,
  onSkip,
  isSaving = false,
  isLocked = false,
}: Props) {
  // Initialize values with defaults from field definitions if not already in initialValues
  const [values, setValues] = useState<Record<string, any>>(() => {
    const state: Record<string, any> = { ...initialValues };
    for (const section of step.sections || []) {
      for (const field of section.fields || []) {
        if (state[field.key] === undefined && field.defaultValue !== undefined) {
          state[field.key] = field.defaultValue;
        }
      }
    }
    return state;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const handleFieldChange = useCallback((key: string, val: any) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setTouched((prev) => ({ ...prev, [key]: true }));
    // Clear error on edit
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Compute all visible fields in the current step
  const visibleFields = useMemo(() => {
    const list: WorkflowFieldDefinition[] = [];
    for (const section of step.sections || []) {
      for (const field of section.fields || []) {
        const isVisible = !field.visibilityCondition || evaluateVisibilityCondition(field.visibilityCondition, values);
        if (isVisible) {
          list.push(field);
        }
      }
    }
    return list;
  }, [step.sections, values]);

  // Determine if all visible fields in this step are optional (allowing Skip)
  const canSkip = useMemo(() => {
    return visibleFields.every((f) => !f.required);
  }, [visibleFields]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isLocked) return;

    // Run client-side validation contract
    const validation = validateCustomFieldValues(visibleFields, values);
    if (!validation.isValid) {
      setErrors(validation.errors);
      // Mark all visible fields as touched to show messages
      const allTouched: Record<string, boolean> = {};
      visibleFields.forEach((f) => {
        allTouched[f.key] = true;
      });
      setTouched(allTouched);
      return;
    }

    setErrors({});
    await onSaveAndContinue(values);
  };

  const getSectionGridClass = (layout?: string) => {
    switch (layout) {
      case "single":
        return "grid grid-cols-1 gap-4 sm:gap-6";
      case "three_column":
        return "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6";
      case "two_column":
      default:
        return "grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6";
    }
  };

  const getFieldColSpanClass = (field: WorkflowFieldDefinition, sectionLayout?: string) => {
    const width = field.layout?.width;
    if (width === "full") {
      if (sectionLayout === "three_column") return "sm:col-span-2 lg:col-span-3";
      if (sectionLayout === "two_column") return "sm:col-span-2";
      return "col-span-1";
    }
    return "col-span-1";
  };

  const renderFieldInput = (field: WorkflowFieldDefinition) => {
    const val = values[field.key] ?? "";
    const hasError = Boolean(touched[field.key] && errors[field.key]);

    const baseInputClass = `w-full h-11 px-3.5 border rounded-xl text-sm bg-white text-gray-900 transition focus:outline-none focus:ring-2 ${
      hasError
        ? "border-red-400 focus:border-red-500 focus:ring-red-100"
        : "border-gray-200 focus:border-accent focus:ring-accent/20"
    } ${isLocked ? "bg-gray-50 text-gray-500 cursor-not-allowed" : ""}`;

    switch (field.type) {
      case "textarea":
        return (
          <textarea
            rows={3}
            value={val}
            disabled={isLocked}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder || `Enter ${field.label}`}
            className={`w-full p-3 border rounded-xl text-sm bg-white text-gray-900 transition focus:outline-none focus:ring-2 resize-y ${
              hasError
                ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                : "border-gray-200 focus:border-accent focus:ring-accent/20"
            } ${isLocked ? "bg-gray-50 text-gray-500 cursor-not-allowed" : ""}`}
          />
        );

      case "number":
        return (
          <input
            type="number"
            value={val}
            disabled={isLocked}
            min={field.validation?.min}
            max={field.validation?.max}
            step="any"
            onChange={(e) => handleFieldChange(field.key, e.target.value === "" ? "" : Number(e.target.value))}
            placeholder={field.placeholder || "0"}
            className={baseInputClass}
          />
        );

      case "date":
        return (
          <input
            type="date"
            value={val}
            disabled={isLocked}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className={baseInputClass}
          />
        );

      case "email":
        return (
          <input
            type="email"
            value={val}
            disabled={isLocked}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder || "name@example.com"}
            className={baseInputClass}
          />
        );

      case "phone":
        return (
          <input
            type="tel"
            value={val}
            disabled={isLocked}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder || "+91 98765 43210"}
            className={baseInputClass}
          />
        );

      case "select":
        return (
          <select
            value={val}
            disabled={isLocked}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className={baseInputClass}
          >
            <option value="">{field.placeholder || `-- Select ${field.label} --`}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case "multiselect": {
        const selectedArr = Array.isArray(val) ? val : [];
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {field.options?.map((opt) => {
                const isChecked = selectedArr.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isLocked}
                    onClick={() => {
                      const next = isChecked
                        ? selectedArr.filter((x: string) => x !== opt.value)
                        : [...selectedArr, opt.value];
                      handleFieldChange(field.key, next);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                      isChecked
                        ? "bg-gray-950 text-white border-gray-950 shadow-xs"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }

      case "checkbox":
        return (
          <label className="flex items-center gap-3 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={Boolean(val)}
              disabled={isLocked}
              onChange={(e) => handleFieldChange(field.key, e.target.checked)}
              className="w-4 h-4 text-accent border-gray-300 rounded focus:ring-accent/30"
            />
            <span className="text-sm font-medium text-gray-800">
              {field.placeholder || `Enable ${field.label}`}
            </span>
          </label>
        );

      case "radio":
        return (
          <div className="flex flex-wrap gap-4 pt-1">
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-800">
                <input
                  type="radio"
                  name={field.key}
                  value={opt.value}
                  checked={val === opt.value}
                  disabled={isLocked}
                  onChange={() => handleFieldChange(field.key, opt.value)}
                  className="w-4 h-4 text-accent border-gray-300 focus:ring-accent/30"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        );

      case "image":
      case "file": {
        const fileUrls: string[] = Array.isArray(val) ? val : val ? [String(val)] : [];
        return (
          <div className="space-y-3">
            {fileUrls.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {fileUrls.map((url, idx) => (
                  <div
                    key={idx}
                    className="relative group flex items-center gap-2 p-2 rounded-xl border border-gray-200 bg-gray-50 text-xs"
                  >
                    {field.type === "image" ? (
                      <ImageIcon size={16} className="text-accent shrink-0" />
                    ) : (
                      <FileText size={16} className="text-gray-500 shrink-0" />
                    )}
                    <span className="truncate max-w-[180px] font-medium text-gray-800">
                      {url.split("/").pop() || `Attachment ${idx + 1}`}
                    </span>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = fileUrls.filter((_, i) => i !== idx);
                          handleFieldChange(field.key, next.length > 0 ? next : "");
                        }}
                        className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!isLocked && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-xl cursor-pointer transition shadow-2xs">
                    {uploadingKey === field.key ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload size={13} />
                        <span>Upload {field.type === "image" ? "Image" : "File"}</span>
                      </>
                    )}
                    <input
                      type="file"
                      className="hidden"
                      disabled={uploadingKey === field.key}
                      accept={field.type === "image" ? "image/jpeg,image/png,image/webp,image/svg+xml" : "*"}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingKey(field.key);
                        try {
                          const formData = new FormData();
                          formData.append("file", file);
                          const res = await fetch("/api/templates/upload", {
                            method: "POST",
                            body: formData,
                          });
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            throw new Error(err?.error?.message || "Upload failed");
                          }
                          const json = await res.json();
                          const uploadedUrl = json.data?.url;
                          if (uploadedUrl) {
                            handleFieldChange(field.key, [...fileUrls, uploadedUrl]);
                            toast.success("File uploaded successfully!");
                          }
                        } catch (err: any) {
                          toast.error(err.message || "Failed to upload file");
                        } finally {
                          setUploadingKey(null);
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                  <span className="text-[11px] text-gray-400">or enter link directly:</span>
                </div>

                <input
                  type="text"
                  placeholder={field.placeholder || "Paste image/document URL or asset link"}
                  className={baseInputClass}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const text = target.value.trim();
                      if (text) {
                        handleFieldChange(field.key, [...fileUrls, text]);
                        target.value = "";
                      }
                    }
                  }}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (text && !fileUrls.includes(text)) {
                      handleFieldChange(field.key, [...fileUrls, text]);
                      e.target.value = "";
                    }
                  }}
                />
              </div>
            )}
            <p className="text-[11px] text-gray-400">Press Enter or click away to append image URL</p>
          </div>
        );
      }

      case "text":
      default:
        return (
          <input
            type="text"
            value={val}
            disabled={isLocked}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder || `Enter ${field.label}`}
            className={baseInputClass}
          />
        );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 animate-fadeIn">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase bg-accent/10 text-accent">
              Custom Step
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-950 tracking-tight">
              {step.title}
            </h2>
          </div>
          {step.description && (
            <p className="text-sm text-gray-500 mt-1 font-normal">
              {step.description}
            </p>
          )}
        </div>
      </div>

      {errors._form && (
        <div role="alert" className="flex items-start gap-2.5 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <p>{errors._form}</p>
        </div>
      )}

      {/* Render Sections */}
      <div className="space-y-8">
        {(step.sections || []).map((section: WorkflowFormSection) => {
          // Filter visible fields in this section
          const sectionFields = (section.fields || []).filter(
            (field) => !field.visibilityCondition || evaluateVisibilityCondition(field.visibilityCondition, values)
          );

          if (sectionFields.length === 0) return null;

          return (
            <div
              key={section.id}
              className="bg-white rounded-2xl border border-gray-100 p-5 sm:p-7 shadow-2xs space-y-5"
            >
              <div>
                <h3 className="text-base font-bold text-gray-900 tracking-tight">
                  {section.title}
                </h3>
                {section.description && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {section.description}
                  </p>
                )}
              </div>

              <div className={getSectionGridClass(section.layout)}>
                {sectionFields.map((field) => {
                  const hasError = Boolean(touched[field.key] && errors[field.key]);
                  return (
                    <div
                      key={field.id}
                      className={`space-y-1.5 ${getFieldColSpanClass(field, section.layout)}`}
                    >
                      <label className="block text-xs font-semibold text-gray-800">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </label>

                      {renderFieldInput(field)}

                      {field.helpText && !hasError && (
                        <p className="text-[11px] text-gray-400 mt-1">{field.helpText}</p>
                      )}

                      {hasError && (
                        <p className="text-[11px] text-red-600 font-medium mt-1">
                          {errors[field.key]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Navigation Buttons */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-100">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>

        <div className="flex items-center gap-3">
          {canSkip && onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 hover:text-gray-800 transition"
            >
              Skip
            </button>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gray-950 text-white text-sm font-semibold hover:bg-gray-800 active:scale-[0.98] transition shadow-xs disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <LoadingSpinner size="sm" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <span>Save & Continue</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
