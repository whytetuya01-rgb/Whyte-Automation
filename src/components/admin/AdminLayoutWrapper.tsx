"use client";

import { useState, useEffect } from "react";
import AdminSidebar from "./AdminSidebar";
import { Menu, X } from "lucide-react";
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
      // Auto-close sidebar when resizing to mobile
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
    <div className="admin-theme flex flex-col h-dvh overflow-hidden bg-admin-background w-full">
      {/* Top Header - Black with White Text/Logo & Pink Accent */}
      <header className="h-[56px] sm:h-[64px] lg:h-[68px] shrink-0 bg-[#111111] border-b border-[#222226] flex items-center justify-between px-3 sm:px-4 md:px-6 z-50 sticky top-0 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="text-neutral-300 hover:text-white p-2 -ml-1 rounded-xl hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#D85B83]/30 cursor-pointer"
            aria-label="Toggle Sidebar"
          >
            {isOpen && isMobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center rounded-xl px-2 sm:px-2.5 py-1 hover:opacity-90 transition"
            aria-label="Admin Dashboard"
          >
            <WhyteLogo
              theme="dark"
              alt="Whyte logo"
              size="header"
              preload
            />
          </Link>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="text-xs text-neutral-300 hover:text-white px-3 py-1.5 rounded-lg border border-[#2A2A30] hover:border-[#D85B83] bg-[#1E1E22] hover:bg-[#28282E] transition-colors hidden sm:inline-flex items-center gap-1.5 font-medium shadow-2xs"
          >
            <span>Public Estimator</span>
            <span className="text-[#D85B83] font-bold">↗</span>
          </Link>
        </div>
      </header>

      {/* Body Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile Overlay */}
        {isMobile && isOpen && (
          <div
            className="fixed inset-0 top-[56px] sm:top-[64px] lg:top-[68px] bg-black/60 z-30 lg:hidden transition-opacity backdrop-blur-xs"
            onClick={() => setIsOpen(false)}
          />
        )}

        {/* Sidebar Container */}
        <div
          className={`
            fixed top-[56px] sm:top-[64px] lg:top-[68px] bottom-0 left-0 z-40 transform transition-transform duration-300 ease-in-out
            w-60 lg:w-64 xl:w-68 bg-[#111111]
            ${isOpen ? "translate-x-0" : "-translate-x-full"}
          `}
        >
          <AdminSidebar onClose={() => isMobile && setIsOpen(false)} />
        </div>

        {/* Main Content */}
        <main
          className={`
            flex-1 overflow-auto min-w-0 flex flex-col bg-[#F6F6F7]
            transition-all duration-300 ease-in-out w-full
            ${isOpen && !isMobile ? "lg:ml-64 xl:ml-68" : "ml-0"}
          `}
        >
          {isContentLoading ? (
            <div className="flex-1 flex items-center justify-center min-h-[60vh] animate-fadeIn">
              <WhyteContentLoader />
            </div>
          ) : (
            <div className="p-3 sm:p-5 md:p-6 xl:p-8 flex-1 max-w-full overflow-x-hidden">
              {children}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
