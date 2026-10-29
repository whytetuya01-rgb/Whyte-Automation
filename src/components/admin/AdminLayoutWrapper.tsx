"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, MotionConfig, motion, type PanInfo } from "motion/react";
import AdminSidebar from "./AdminSidebar";
import ActAsCompanyControl from "./ActAsCompanyControl";
import OfflineStatusPill from "@/components/offline/OfflineStatusPill";
import { ArrowUpRight, Shield } from "lucide-react";
import Link from "next/link";
import { WhyteContentLoader, WhyteFullScreenLoader } from "@/components/shared/WhyteLoader";
import { usePageLoading } from "@/components/providers/NavigationLoaderProvider";
import AnimatedLogo from "./sidebar/AnimatedLogo";
import HamburgerMorph from "./sidebar/HamburgerMorph";
import { DURATION, DURATION_MS, SPRING } from "./sidebar/motionTokens";

const COLLAPSED_STORAGE_KEY = "whyte-admin-sidebar-collapsed";
/** Wait for the drawer spring to settle before the menu rows stagger in. */
const MOBILE_ENTRANCE_DELAY_S = 0.22;

export default function AdminLayoutWrapper({
  children,
  footer,
}: {
  children: React.ReactNode;
  /** Rendered server-side by the panel layout (it reads the Company Profile). */
  footer?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [mounted, setMounted] = useState(false);
  // Desktop icon-rail mode (the mobile drawer uses `isOpen` instead).
  const [collapsed, setCollapsed] = useState(false);
  // True only while the width transition runs, so `will-change` is short-lived.
  const [isCollapsing, setIsCollapsing] = useState(false);
  // Bumped on every mobile drawer open so the menu rows stagger in again.
  const [drawerOpenCount, setDrawerOpenCount] = useState(0);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isContentLoading } = usePageLoading();

  useEffect(() => {
    const checkScreen = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) setIsOpen(false);
    };

    try {
      if (localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // Storage unavailable (private mode / blocked) — start expanded.
    }

    setMounted(true);
    checkScreen();

    window.addEventListener("resize", checkScreen);
    return () => {
      window.removeEventListener("resize", checkScreen);
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, []);

  const isRail = !isMobile && collapsed;

  const toggleSidebar = () => {
    if (isMobile) {
      if (!isOpen) setDrawerOpenCount((n) => n + 1);
      setIsOpen(!isOpen);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Non-fatal: the preference just won't survive a reload.
    }
    setIsCollapsing(true);
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setIsCollapsing(false), DURATION_MS.layout + 40);
  };

  // Swipe-left (or a fast flick) closes the mobile drawer; otherwise it snaps back.
  const handleDrawerDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -400) setIsOpen(false);
  };

  if (!mounted) {
    return <WhyteFullScreenLoader />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="admin-theme flex flex-col h-dvh overflow-hidden bg-[#F6F6F7] w-full select-none">
        {/* Top Header - Black with Whyte Pink Accent */}
        <header className="h-[48px] sm:h-[50px] lg:h-[52px] shrink-0 bg-[#0E0E10] border-b border-[#222226] flex items-center justify-between px-3 sm:px-4 md:px-6 z-50 sticky top-0 shadow-xs">
          <div className="flex items-center gap-2 sm:gap-3  lg:gap-4">
            <button
              onClick={toggleSidebar}
              className="text-neutral-300 hover:text-white p-1.5 sm:p-2 -ml-1 rounded-xl hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-admin-primary-on-dark,#D85B83)]/30 cursor-pointer"
              aria-label={isMobile ? "Toggle Navigation Sidebar" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={isMobile ? isOpen : !collapsed}
            >
              <HamburgerMorph state={isMobile ? (isOpen ? "close" : "menu") : collapsed ? "arrow" : "menu"} />
            </button>
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center rounded-xl px-1.5 sm:px-2 py-0.5 hover:opacity-90 transition"
              aria-label="Whyte Admin Dashboard"
            >
              <AnimatedLogo collapsed={isRail} />
            </Link>
            {/* <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#D85B83]/10 border border-[#D85B83]/30 text-[#D85B83] text-[10px] font-bold uppercase tracking-wider">
            <Shield size={10} /> Admin Control Center
          </span> */}
          </div>

          <div className="flex items-center gap-2">
            <OfflineStatusPill />
            <ActAsCompanyControl />
          </div>

          {/* <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="text-xs text-neutral-300 hover:text-white px-3 py-1.5 rounded-xl border border-[#2A2A30] hover:border-[#D85B83]/50 bg-[#1A1A1E] hover:bg-[#222228] transition-all inline-flex items-center gap-1.5 font-semibold shadow-2xs group"
          >
            <span>Public Estimator</span>
            <ArrowUpRight size={13} className="text-[#D85B83] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div> */}
        </header>

        {/* Body Area */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Mobile Overlay — fades to black/50 with a slight blur; click closes. */}
          <AnimatePresence>
            {isMobile && isOpen && (
              <motion.div
                key="drawer-backdrop"
                className="fixed inset-0 top-[48px] sm:top-[50px] lg:top-[52px] bg-black/50 z-30 lg:hidden backdrop-blur-xs"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.base }}
                onClick={() => setIsOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Sidebar Container — mobile: spring drawer (swipe left to close);
            desktop: width animates between full and the 76px icon rail on the
            same timing as the content offset below. */}
          <motion.div
            className={`
            fixed top-[48px] sm:top-[50px] lg:top-[52px] bottom-0 left-0 z-40 bg-[#111111]
            transition-[width] duration-[var(--motion-layout)] ease-[var(--motion-ease)]
            ${isRail ? "lg:w-[76px]" : "w-60 lg:w-64 xl:w-68"}
            ${isCollapsing ? "will-change-[width]" : ""}
          `}
            initial={false}
            animate={{ x: isMobile && !isOpen ? "-100%" : 0 }}
            transition={SPRING}
            drag={isMobile && isOpen ? "x" : false}
            dragConstraints={{ left: -320, right: 0 }}
            dragElastic={{ left: 0.2, right: 0 }}
            dragSnapToOrigin
            onDragEnd={handleDrawerDragEnd}
          >
            <AdminSidebar
              key={isMobile ? `drawer-${drawerOpenCount}` : "desktop"}
              onClose={() => isMobile && setIsOpen(false)}
              collapsed={isRail}
              entranceDelay={isMobile && drawerOpenCount > 0 ? MOBILE_ENTRANCE_DELAY_S : 0}
            />
          </motion.div>

          {/* Main Content Area */}
          <main
            className={`
            flex-1 overflow-auto min-w-0 flex flex-col bg-[#F6F6F7] w-full
            transition-[margin] duration-[var(--motion-layout)] ease-[var(--motion-ease)]
            ${isRail ? "lg:ml-[76px]" : "lg:ml-64 xl:ml-68"}
          `}
          >
            {isContentLoading ? (
              <div className="flex-1 flex items-center justify-center min-h-[60vh] animate-fadeIn">
                <WhyteContentLoader />
              </div>
            ) : (
              <div className="p-3.5 sm:p-5 md:p-6 xl:p-8 flex-1 max-w-full overflow-x-hidden select-text">
                {children}
              </div>
            )}
            {footer}
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}

