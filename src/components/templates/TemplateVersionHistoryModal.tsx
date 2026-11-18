"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  History,
  ShieldCheck,
  Calendar,
  Layers,
  Sparkles,
  AlertCircle,
  FileText,
  Lock,
} from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import type { QuotationTemplate } from "@/types/template";
import LoadingSpinner from "@/components/shared/LoadingSpinner";

interface TemplateVersionHistoryModalProps {
  template: QuotationTemplate;
  isOpen: boolean;
  onClose: () => void;
  onPublishNewVersion: () => Promise<void>;
  isPublishing?: boolean;
}

interface VersionRecord {
  id: string;
  templateId: string;
  version: number;
  name: string;
  description: string | null;
  workflow: {
    steps: Array<{ id: string; title: string; moduleType: string }>;
  };
  publishedBy: string | number | null;
  publishedAt: string;
}

export default function TemplateVersionHistoryModal({
  template,
  isOpen,
  onClose,
  onPublishNewVersion,
  isPublishing = false,
}: TemplateVersionHistoryModalProps) {
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<VersionRecord | null>(null);

  const fetchVersions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/templates/${template.id}/versions`);
      if (!res.ok) throw new Error("Failed to load version history");
      const json = await res.json();
      setVersions(json.data || []);
      if (json.data && json.data.length > 0) {
        setSelectedVersion(json.data[0]);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load versions");
    } finally {
      setLoading(false);
    }
  }, [template.id]);

  useEffect(() => {
    if (isOpen) {
      fetchVersions();
    }
  }, [isOpen, fetchVersions]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
              <History size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                Version History
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  {template.name}
                </span>
              </h2>
              <p className="text-xs text-gray-500">
                Immutable published snapshots protecting historical quotations & revision PDFs
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onPublishNewVersion}
              disabled={isPublishing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Sparkles size={13} />
              <span>{isPublishing ? "Publishing..." : "Publish New Version"}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* VERSION LIST (5 cols) */}
          <div className="md:col-span-5 border-r border-gray-100 overflow-y-auto p-4 space-y-2 bg-slate-50/40">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-400 px-1 mb-2">
              <span>Published Releases ({versions.length})</span>
              <span>v{template.version ?? 1} (Draft)</span>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-12 px-4 bg-white rounded-xl border border-dashed border-gray-200">
                <AlertCircle size={24} className="text-gray-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-gray-700">No published versions yet</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Click &ldquo;Publish New Version&rdquo; to create your first immutable release.
                </p>
              </div>
            ) : (
              versions.map((ver) => {
                const isSelected = selectedVersion?.id === ver.id;
                const dateStr = ver.publishedAt
                  ? new Date(ver.publishedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "N/A";

                return (
                  <button
                    key={ver.id}
                    type="button"
                    onClick={() => setSelectedVersion(ver)}
                    className={cn(
                      "w-full text-left p-3.5 rounded-xl border transition cursor-pointer flex flex-col gap-1.5",
                      isSelected
                        ? "bg-white border-primary shadow-xs ring-2 ring-primary/10"
                        : "bg-white/80 hover:bg-white border-gray-200/90 text-gray-700"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-primary/10 text-primary">
                          v{ver.version}
                        </span>
                        <span className="text-xs font-bold text-gray-900 truncate">
                          {ver.name}
                        </span>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        <Lock size={10} /> Immutable
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-gray-400 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} /> {dateStr}
                      </span>
                      <span>{ver.workflow?.steps?.length || 0} steps</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* VERSION DETAILS INSPECTOR (7 cols) */}
          <div className="md:col-span-7 overflow-y-auto p-6 bg-white space-y-5">
            {selectedVersion ? (
              <>
                <div className="border-b border-gray-100 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
                        Release Snapshot
                      </span>
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        Version {selectedVersion.version}
                        <span className="text-xs font-normal text-gray-400">
                          ({selectedVersion.id})
                        </span>
                      </h3>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                      <ShieldCheck size={13} /> Active Snapshot
                    </span>
                  </div>
                  {selectedVersion.description && (
                    <p className="text-xs text-gray-600 mt-2 italic">
                      &ldquo;{selectedVersion.description}&rdquo;
                    </p>
                  )}
                </div>

                {/* Workflow Steps in this Version */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                    <Layers size={14} /> Workflow Sequence ({selectedVersion.workflow?.steps?.length || 0} steps)
                  </h4>
                  <div className="space-y-1.5">
                    {(selectedVersion.workflow?.steps || []).map((step, idx) => (
                      <div
                        key={step.id || idx}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 bg-gray-50 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-white border border-gray-300 flex items-center justify-center font-bold text-[10px] text-gray-600">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-gray-900">{step.title}</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-400">
                          {step.moduleType === "builtin" ? "Built-in Core" : "Custom Form"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Immutability guarantee callout */}
                <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl text-xs space-y-1 text-amber-900">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-amber-600" />
                    Zero-Regression Backward Compatibility
                  </div>
                  <p className="text-amber-800 text-[11px] leading-relaxed">
                    All quotations issued under Version {selectedVersion.version} are permanently pinned
                    to this snapshot. Any subsequent changes to template draft definitions will never alter
                    their calculations, field responses, or generated PDF documents.
                  </p>
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400">
                <FileText size={32} className="text-gray-300 mb-2" />
                <p className="text-xs font-medium">Select a published version to inspect its snapshot details.</p>
              </div>
            )}
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>Active Company Context Isolated</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 font-semibold cursor-pointer transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
