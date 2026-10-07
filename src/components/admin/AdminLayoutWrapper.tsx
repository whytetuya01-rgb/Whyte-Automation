"use client";

import { useState, useEffect } from "react";
import AdminSidebar from "./AdminSidebar";
import { Menu, X, ArrowUpRight, Shield } from "lucide-react";
import Link from "next/link";
import WhyteLogo from "@/components/shared/WhyteLogo";
import { WhyteContentLoader, WhyteFullScreenLoader } from "@/components/shared/WhyteLoader";
import { usePageLoading } from "@/components/providers/NavigationLoaderProvider";

export default function AdminLayoutWrapper({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [mounted, setMounted] = useState(false);
  const { isContentLoading } = usePageLoading();

  useEffect(() => {
    const checkScreen = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) setIsOpen(false);
    };

    setMounted(true);
    checkScreen();

    window.addEventListener("resize", checkScreen);
    return () => window.removeEventListener("resize", checkScreen);
  }, []);

  if (!mounted) {
    return <WhyteFullScreenLoader />;
  }

  return (
    <div className="admin-theme flex flex-col h-dvh overflow-hidden bg-[#F6F6F7] w-full select-none">
      {/* Top Header - Black with Whyte Pink Accent */}
      <header className="h-[48px] sm:h-[50px] lg:h-[52px] shrink-0 bg-[#0E0E10] border-b border-[#222226] flex items-center justify-between px-3 sm:px-4 md:px-6 z-50 sticky top-0 shadow-xs">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-neutral-300 hover:text-white p-1.5 sm:p-2 -ml-1 rounded-xl hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#D85B83]/30 cursor-pointer"
            aria-label="Toggle Navigation Sidebar"
          >
            {isOpen && isMobile ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center rounded-xl px-1.5 sm:px-2 py-0.5 hover:opacity-90 transition"
            aria-label="Whyte Admin Dashboard"
          >
            <WhyteLogo
              theme="dark"
              alt="Whyte Automations logo"
              size="header"
              preload
            />
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#D85B83]/10 border border-[#D85B83]/30 text-[#D85B83] text-[10px] font-bold uppercase tracking-wider">
            <Shield size={10} /> Admin Control Center
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="text-xs text-neutral-300 hover:text-white px-3 py-1.5 rounded-xl border border-[#2A2A30] hover:border-[#D85B83]/50 bg-[#1A1A1E] hover:bg-[#222228] transition-all inline-flex items-center gap-1.5 font-semibold shadow-2xs group"
          >
            <span>Public Estimator</span>
            <ArrowUpRight size={13} className="text-[#D85B83] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </header>

      {/* Body Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Overlay */}
        {isMobile && isOpen && (
          <div
            className="fixed inset-0 top-[48px] sm:top-[50px] lg:top-[52px] bg-black/60 z-30 lg:hidden transition-opacity backdrop-blur-xs"
            onClick={() => setIsOpen(false)}
          />
        )}

        {/* Sidebar Container */}
        <div
          className={`
            fixed top-[48px] sm:top-[50px] lg:top-[52px] bottom-0 left-0 z-40 transform transition-transform duration-300 ease-in-out
            w-60 lg:w-64 xl:w-68 bg-[#111111]
            ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          `}
        >
          <AdminSidebar onClose={() => isMobile && setIsOpen(false)} />
        </div>

        {/* Main Content Area */}
        <main
          className={`
            flex-1 overflow-auto min-w-0 flex flex-col bg-[#F6F6F7]
            transition-all duration-300 ease-in-out w-full
            ${isOpen || !isMobile ? "lg:ml-64 xl:ml-68" : "ml-0"}
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
        </main>
      </div>
    </div>
  );
}

