"use client";

import React, { useState } from "react";
import {
  X,
  Sparkles,
  Layers,
  Check,
  FileText,
  Loader2,
} from "lucide-react";

interface NewTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, starterType: "whyte" | "blank") => Promise<void>;
  isCreating?: boolean;
}

export default function NewTemplateModal({
  isOpen,
  onClose,
  onCreate,
  isCreating = false,
}: NewTemplateModalProps) {
  const [name, setName] = useState("Custom Quotation Workflow");
  const [starterType, setStarterType] = useState<"whyte" | "blank">("whyte");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a template name.");
      return;
    }
    setError(null);
    await onCreate(name.trim(), starterType);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-gray-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 leading-tight">
                Create Quotation Workflow Template
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Design your company&apos;s custom quotation creation journey.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Template Name */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
              Template Display Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Standard Commercial Workflow, Luxury Villa Journey"
              autoFocus
              className="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition"
            />
            {error && <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>}
          </div>

          {/* Starter Selection */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-2 uppercase tracking-wider">
              Choose Workflow Starter
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: Existing Whyte Workflow */}
              <div
                onClick={() => setStarterType("whyte")}
                className={`relative p-4 rounded-xl border-2 transition cursor-pointer flex flex-col justify-between ${
                  starterType === "whyte"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Layers size={18} />
                    </span>
                    {starterType === "whyte" && (
                      <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-gray-900 mb-1">
                    Existing Whyte Workflow
                  </h4>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    5 pre-configured steps (Project Details, Spaces, Devices, Review, Proposal). All fields are editable.
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1 text-[10px] font-semibold text-primary">
                  <span>Smart Automation Ready</span>
                </div>
              </div>

              {/* Option 2: Blank Custom Workflow */}
              <div
                onClick={() => setStarterType("blank")}
                className={`relative p-4 rounded-xl border-2 transition cursor-pointer flex flex-col justify-between ${
                  starterType === "blank"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-xs"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                      <FileText size={18} />
                    </span>
                    {starterType === "blank" && (
                      <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-gray-900 mb-1">
                    Blank Custom Workflow
                  </h4>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Starts fresh with a minimal intake step. Zero Whyte modules. Build custom steps or insert modules as needed.
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                  <span>Custom Service & Retail</span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="px-4 py-2 border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-xs rounded-xl transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white font-semibold text-xs rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              {isCreating && <Loader2 size={14} className="animate-spin" />}
              <span>{isCreating ? "Creating..." : "Create Workflow Template"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
