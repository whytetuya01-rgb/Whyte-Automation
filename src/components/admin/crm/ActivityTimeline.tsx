"use client";

import { useState } from "react";
import {
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Calendar,
  FileText,
  Eye,
  Clock,
  StickyNote,
  Send,
  Plus,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { CrmActivity, CrmActivityType } from "@/types/crm";
import { Button, Input, Textarea } from "@/components/ui";

const ACTIVITY_ICON_MAP: Record<CrmActivityType, React.ElementType> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  site_visit: MapPin,
  meeting: Calendar,
  quotation_sent: FileText,
  quotation_viewed: Eye,
  follow_up: Clock,
  note: StickyNote,
  status_change: Clock,
};

const ACTIVITY_COLOR_MAP: Record<CrmActivityType, { bg: string; text: string; ring: string }> = {
  call: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
  whatsapp: { bg: "bg-green-50", text: "text-green-700", ring: "ring-green-200" },
  email: { bg: "bg-sky-50", text: "text-sky-700", ring: "ring-sky-200" },
  site_visit: { bg: "bg-purple-50", text: "text-purple-700", ring: "ring-purple-200" },
  meeting: { bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
  quotation_sent: { bg: "bg-amber-50", text: "text-amber-800", ring: "ring-amber-200" },
  quotation_viewed: { bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-200" },
  follow_up: { bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-200" },
  note: { bg: "bg-neutral-100", text: "text-neutral-700", ring: "ring-neutral-200" },
  status_change: { bg: "bg-accent-light", text: "text-accent-foreground", ring: "ring-accent-border" },
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface ActivityTimelineProps {
  activities: CrmActivity[];
  leadId?: string;
  customerId?: number;
  quotationId?: string;
  onActivityAdded?: () => void;
  className?: string;
}

export default function ActivityTimeline({
  activities,
  leadId,
  customerId,
  quotationId,
  onActivityAdded,
  className = "",
}: ActivityTimelineProps) {
  const [activeType, setActiveType] = useState<CrmActivityType>("call");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      notify.error("Title required", "Please enter a short activity summary.");
      return;
    }

    setSubmitting(true);
    try {
      await apiJson.post("/api/crm/activities", {
        leadId: leadId || undefined,
        customerId: customerId || undefined,
        quotationId: quotationId || undefined,
        type: activeType,
        title: title.trim(),
        description: description.trim() || undefined,
      });

      notify.success("Activity logged", "Activity saved to timeline.");
      setTitle("");
      setDescription("");
      setShowLogForm(false);
      onActivityAdded?.();
    } catch (err) {
      notifyApiError(err, "Failed to log activity");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Quick Log Action Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 pb-3">
        <h4 className="text-sm font-bold text-neutral-900 tracking-tight flex items-center gap-2">
          <span>Activity Timeline</span>
          <span className="text-[11px] font-semibold text-neutral-400">({activities.length})</span>
        </h4>
        <button
          type="button"
          onClick={() => setShowLogForm((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent-light rounded-lg transition"
        >
          <Plus size={14} />
          <span>{showLogForm ? "Cancel" : "Log Activity"}</span>
        </button>
      </div>

      {/* Log Activity Form Drawer */}
      {showLogForm && (
        <form onSubmit={handleSubmit} className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200 space-y-3 animate-in fade-in duration-150">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { type: "call", label: "Phone Call", icon: Phone },
                { type: "whatsapp", label: "WhatsApp", icon: MessageCircle },
                { type: "meeting", label: "Meeting", icon: Calendar },
                { type: "site_visit", label: "Site Visit", icon: MapPin },
                { type: "note", label: "Note", icon: StickyNote },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const isSelected = activeType === opt.type;
              return (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => {
                    setActiveType(opt.type);
                    if (!title) setTitle(`${opt.label} logged`);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    isSelected
                      ? "bg-neutral-900 text-white shadow-2xs"
                      : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-100"
                  }`}
                >
                  <Icon size={12} />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <Input
            label="Activity Summary"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Discussed switchboard design, client requested revised quotation"
            required
            className="text-xs"
          />

          <Textarea
            label="Detailed Notes (Optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Client comments, agreed next steps, site constraints..."
            className="text-xs resize-none"
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowLogForm(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submitting}
            >
              Save Activity
            </Button>
          </div>
        </form>
      )}

      {/* Chronological Timeline Feed */}
      {activities.length === 0 ? (
        <div className="py-8 text-center text-xs text-neutral-400 bg-neutral-50/50 rounded-xl border border-dashed border-neutral-200">
          No activities recorded yet. Log calls, meetings or notes above.
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-neutral-200/70">
          {activities.map((act) => {
            const Icon = ACTIVITY_ICON_MAP[act.type] || StickyNote;
            const style = ACTIVITY_COLOR_MAP[act.type] || ACTIVITY_COLOR_MAP.note;
            return (
              <div key={act.id} className="relative group">
                {/* Node circle */}
                <div
                  className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center ring-2 bg-white ${style.text} ${style.ring}`}
                >
                  <Icon size={11} />
                </div>

                {/* Content Card */}
                <div className="bg-white p-3 rounded-xl border border-neutral-200 shadow-2xs hover:border-neutral-300 transition space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-bold text-neutral-900 tracking-tight leading-snug">
                      {act.title}
                    </span>
                    <span className="text-[10px] text-neutral-400 shrink-0 font-medium">
                      {formatRelativeTime(act.performedAt)}
                    </span>
                  </div>

                  {act.description && (
                    <p className="text-xs text-neutral-600 leading-relaxed whitespace-pre-line">
                      {act.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-neutral-400 pt-1">
                    <span>
                      by <strong className="text-neutral-700 font-semibold">{act.performedByName || "System"}</strong>
                    </span>
                    <span className="capitalize">{act.type.replace("_", " ")}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

