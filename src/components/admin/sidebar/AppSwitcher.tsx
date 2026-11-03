"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  ChevronsUpDown,
  LayoutGrid,
  Check,
  ArrowRight,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useAppNavigation } from "../AppNavigationContext";
import { getActiveApps } from "@/lib/appNavigationRegistry";
import CollapsedTooltip from "./CollapsedTooltip";
import { DURATION, EASE } from "./motionTokens";

interface AppSwitcherProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export default function AppSwitcher({ collapsed = false, onNavigate }: AppSwitcherProps) {
  const { activeApp, activeAppId, switchApp } = useAppNavigation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeApps = getActiveApps();
  const ActiveIcon = activeApp.icon;

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleSelectApp = (targetAppId: string) => {
    setIsOpen(false);
    onNavigate?.();
    switchApp(targetAppId);
  };

  return (
    <div ref={containerRef} className="relative z-30 px-3 pt-3 pb-1 shrink-0">
      <CollapsedTooltip label={`App: ${activeApp.label} (Click to switch)`} enabled={collapsed}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={`Current application: ${activeApp.label}. Click to switch application.`}
          className={cn(
            "group w-full flex items-center rounded-xl transition-all duration-200 outline-none cursor-pointer",
            "border border-[#222228] bg-[#16161A]/90 hover:bg-[#1E1E24] hover:border-[var(--color-admin-primary-on-dark,#D85B83)]/40",
            "focus-visible:ring-2 focus-visible:ring-[var(--color-admin-primary-on-dark,#D85B83)]/50",
            collapsed ? "p-2 justify-center" : "p-2.5 justify-between gap-2.5"
          )}
        >
          {/* Left: App Icon & Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105",
                activeApp.id === "dashboard"
                  ? "bg-white/10 text-white border border-white/15"
                  : "bg-[var(--color-admin-primary-on-dark,#D85B83)]/20 text-[var(--color-admin-primary-on-dark,#D85B83)] border border-[var(--color-admin-primary-on-dark,#D85B83)]/30"
              )}
            >
              <ActiveIcon size={16} strokeWidth={2} />
            </span>

            {!collapsed && (
              <div className="text-left min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white tracking-tight truncate">
                    {activeApp.label}
                  </span>
                  {activeApp.id === "dashboard" ? (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-white/10 text-neutral-300 border border-white/10">
                      Full Suite
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-[var(--color-admin-primary-on-dark,#D85B83)]/15 text-[var(--color-admin-primary-on-dark,#D85B83)] border border-[var(--color-admin-primary-on-dark,#D85B83)]/25">
                      App Mode
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-neutral-400 truncate mt-0.2">
                  {activeApp.id === "dashboard"
                    ? "All modules visible"
                    : `${activeApp.label}-focused sidebar`}
                </p>
              </div>
            )}
          </div>

          {!collapsed && (
            <ChevronsUpDown
              size={14}
              className="text-neutral-400 group-hover:text-white shrink-0 transition-transform duration-200"
            />
          )}
        </button>
      </CollapsedTooltip>

      {/* Switcher Dropdown Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: DURATION.fast, ease: EASE }}
            className={cn(
              "absolute left-3 z-50 rounded-2xl border border-[#2B2B32] bg-[#16161A] shadow-2xl p-3 text-left overflow-hidden",
              collapsed
                ? "top-2 left-[82px] w-[290px]"
                : "top-full mt-1.5 w-[calc(100%-24px)] min-w-[260px] max-w-[320px]"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-[#24242A]">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  Switch Application
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-neutral-500 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                aria-label="Close app switcher"
              >
                <X size={12} />
              </button>
            </div>

            {/* Apps List */}
            <div className="space-y-1 max-h-[280px] overflow-y-auto custom-scrollbar pr-0.5">
              {activeApps.map((app) => {
                const Icon = app.icon;
                const isSelected = app.id === activeAppId;
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => handleSelectApp(app.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-2 rounded-xl text-left transition-all cursor-pointer group",
                      isSelected
                        ? "bg-[var(--color-admin-primary-on-dark,#D85B83)]/15 border border-[var(--color-admin-primary-on-dark,#D85B83)]/30 text-white"
                        : "hover:bg-white/[0.06] text-neutral-300 hover:text-white border border-transparent"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
                          isSelected
                            ? "bg-[var(--color-admin-primary-on-dark,#D85B83)] text-white shadow-xs"
                            : "bg-white/5 text-neutral-400 group-hover:text-white group-hover:bg-white/10"
                        )}
                      >
                        <Icon size={14} strokeWidth={2} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate leading-tight">
                          {app.label}
                        </p>
                        <p className="text-[10px] text-neutral-400 truncate leading-tight mt-0.5">
                          {app.id === "dashboard"
                            ? "Full authorized sidebar"
                            : app.description}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <Check
                        size={14}
                        className="text-[var(--color-admin-primary-on-dark,#D85B83)] shrink-0 ml-1.5"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* All Apps / Launcher Link */}
            <div className="mt-2.5 pt-2.5 border-t border-[#24242A]">
              <Link
                href="/apps"
                onClick={() => {
                  setIsOpen(false);
                  onNavigate?.();
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] text-neutral-300 hover:text-white transition-colors text-xs font-semibold group"
              >
                <div className="flex items-center gap-2">
                  <LayoutGrid size={13} className="text-[var(--color-admin-primary-on-dark,#D85B83)]" />
                  <span>All Apps Launcher</span>
                </div>
                <ArrowRight size={12} className="text-neutral-500 group-hover:text-white transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

