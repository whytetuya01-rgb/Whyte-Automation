"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  UserPlus,
  CalendarClock,
} from "lucide-react";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { NotificationType } from "@/models/Notification";

interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationResponse {
  items: NotificationItem[];
  unreadCount: number;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "lead_assigned":
      return <UserPlus size={16} className="text-blue-400 shrink-0" />;
    case "follow_up_due":
      return <Clock size={16} className="text-amber-400 shrink-0" />;
    case "follow_up_overdue":
      return <AlertCircle size={16} className="text-rose-400 shrink-0" />;
    case "follow_up_assigned":
      return <CalendarClock size={16} className="text-sky-400 shrink-0" />;
    default:
      return <Bell size={16} className="text-neutral-400 shrink-0" />;
  }
}

interface NotificationBellProps {
  /** `dark` (default) suits the admin top bar; `light` suits the white workspace header. */
  tone?: "dark" | "light";
  /** Where a lead or follow-up notification opens when the person has no CRM screens (a Sales Executive's My Leads). */
  leadsHref?: string;
}

export default function NotificationBell({ tone = "dark", leadsHref }: NotificationBellProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiJson.get<NotificationResponse>("/api/notifications?limit=20");
      if (res) {
        setItems(res.items || []);
        setUnreadCount(res.unreadCount || 0);
      }
    } catch {
      // Quiet fail on periodic background poll
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await apiJson.patch(`/api/notifications/${id}/read`, {});
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      notifyApiError(err, "Failed to mark notification as read");
    }
  };

  const handleMarkAllRead = async () => {
    setLoading(true);
    try {
      await apiJson.post("/api/notifications/mark-all-read", {});
      setItems((prev) =>
        prev.map((item) => ({ ...item, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (err) {
      notifyApiError(err, "Failed to mark all as read");
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.readAt) {
      void handleMarkAsRead(item.id);
    }
    setOpen(false);
    const target = leadsHref && item.link.startsWith("/admin/crm") ? leadsHref : item.link;
    if (target) {
      router.push(target);
    }
  };

  return (
    <div className="relative inline-block" ref={panelRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="View notifications"
        aria-expanded={open}
        className={`relative p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-admin-primary-on-dark,#D85B83)]/40 cursor-pointer ${tone === "light" ? "text-gray-600 hover:text-gray-950 hover:bg-gray-100" : "text-neutral-300 hover:text-white hover:bg-white/10"}`}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none shadow-xs animate-in zoom-in-50 duration-150">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="fixed sm:absolute top-[52px] sm:top-full right-2 sm:right-0 mt-1 z-50 w-[calc(100vw-16px)] sm:w-[380px] max-w-[400px] bg-[#16161A] border border-[#2B2B32] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 text-left">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2B2B32] bg-[#111114]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  {unreadCount} unread
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={loading}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-admin-primary-on-dark,#D85B83)] hover:underline disabled:opacity-50 cursor-pointer"
              >
                <CheckCheck size={14} />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-[#222228] [scrollbar-width:thin]">
            {items.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <Bell size={28} className="mx-auto text-neutral-600 mb-2" />
                <p className="text-xs font-semibold text-neutral-300">No notifications</p>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  You are all caught up on your leads and follow-ups.
                </p>
              </div>
            ) : (
              items.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`group relative p-3 sm:p-3.5 flex items-start gap-3 hover:bg-white/[0.04] transition-colors cursor-pointer ${
                      isUnread ? "bg-white/[0.02]" : "opacity-85"
                    }`}
                  >
                    <div className="mt-0.5 p-2 rounded-xl bg-white/[0.05] border border-white/5">
                      {getNotificationIcon(item.type)}
                    </div>

                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center justify-between gap-1">
                        <p
                          className={`text-xs truncate ${
                            isUnread ? "font-bold text-white" : "font-medium text-neutral-300"
                          }`}
                        >
                          {item.title}
                        </p>
                        <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>

                      <p className="text-[12px] text-neutral-400 mt-0.5 line-clamp-2 leading-relaxed">
                        {item.body}
                      </p>
                    </div>

                    {/* Unread dot / quick mark button */}
                    {isUnread ? (
                      <button
                        type="button"
                        onClick={(e) => handleMarkAsRead(item.id, e)}
                        title="Mark as read"
                        className="self-center p-1 rounded-md text-neutral-500 hover:text-white hover:bg-white/10 transition shrink-0"
                      >
                        <span className="w-2 h-2 rounded-full bg-[var(--color-admin-primary-on-dark,#D85B83)] block" />
                      </button>
                    ) : (
                      <span className="self-center text-neutral-600 opacity-0 group-hover:opacity-100 transition shrink-0">
                        <Check size={14} />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

