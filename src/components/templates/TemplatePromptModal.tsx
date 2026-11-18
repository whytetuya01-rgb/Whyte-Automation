"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Sparkles, AlertTriangle, Layers, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TemplatePromptModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  inputLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  icon?: "sparkles" | "layers" | "plus" | "warning";
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export default function TemplatePromptModal({
  isOpen,
  title,
  description,
  inputLabel,
  placeholder = "Enter value...",
  defaultValue = "",
  confirmText = "Continue",
  cancelText = "Cancel",
  icon = "sparkles",
  onConfirm,
  onClose,
}: TemplatePromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset and focus input on open
  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setLoading(false);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, defaultValue]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }

    try {
      setLoading(true);
      await onConfirm(trimmed);
      onClose();
    } catch {
      // Error handled by caller
    } finally {
      setLoading(false);
    }
  };

  const getIcon = () => {
    switch (icon) {
      case "warning":
        return <AlertTriangle size={18} className="text-amber-600" />;
      case "layers":
        return <Layers size={18} className="text-indigo-600" />;
      case "plus":
        return <Plus size={18} className="text-emerald-600" />;
      case "sparkles":
      default:
        return <Sparkles size={18} className="text-primary" />;
    }
  };

  const getIconBg = () => {
    switch (icon) {
      case "warning":
        return "bg-amber-50 border-amber-200/80";
      case "layers":
        return "bg-indigo-50 border-indigo-200/80";
      case "plus":
        return "bg-emerald-50 border-emerald-200/80";
      case "sparkles":
      default:
        return "bg-primary/10 border-primary/20";
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={cn("p-2.5 rounded-xl border flex items-center justify-center", getIconBg())}>
              {getIcon()}
            </div>
            <div>
              <h3 id="template-modal-title" className="text-sm font-bold text-gray-950">
                {title}
              </h3>
              {description && (
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition cursor-pointer disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-3">
            {inputLabel && (
              <label className="block text-xs font-semibold text-gray-700">
                {inputLabel}
              </label>
            )}
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={loading}
              className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 bg-gray-50/80 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
            >
              {cancelText}
            </button>
            <button
              type="submit"
              disabled={loading || !value.trim()}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {loading && (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              <span>{confirmText}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
