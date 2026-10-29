"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { SiteTheme } from "@/models/Company";
import { DEFAULT_THEME, isValidTheme, THEME_CONFIGS, ThemeConfig } from "@/lib/themeTokens";
import { refreshCachedBranding } from "@/lib/offline/identity";
import { THEME_PREVIEW_ATTRIBUTE } from "@/lib/brandColor";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";
import toast from "react-hot-toast";

interface ThemeContextType {
  activeTheme: SiteTheme;
  previewTheme: SiteTheme | null;
  currentEffectiveTheme: SiteTheme;
  themeConfig: ThemeConfig;
  /** Saves the preset. `clearBrandColor` also removes the company's custom colour in the same request (one choice). */
  setTheme: (theme: SiteTheme, options?: { clearBrandColor?: boolean }) => Promise<boolean>;
  preview: (theme: SiteTheme) => void;
  cancelPreview: () => void;
  isSaving: boolean;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** Older versions kept the chosen preset in the browser under this (shared, not per company) key. */
const LEGACY_STORAGE_KEY = "whyte_site_theme";

/**
 * The company's preset theme. It comes from the server (`initialTheme`, resolved from the trusted session together
 * with the logo and brand colour) and is never read from or kept in browser storage, so one company's preset cannot
 * appear for another on the same browser, during login, logout, account switching or act-as.
 */
export function ThemeProvider({
  children,
  initialTheme = DEFAULT_THEME,
}: {
  children: React.ReactNode;
  initialTheme?: SiteTheme;
}) {
  const router = useRouter();
  const [activeTheme, setActiveThemeState] = useState<SiteTheme>(initialTheme);
  const [previewTheme, setPreviewTheme] = useState<SiteTheme | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Set after a preset replaced the custom colour, until the refreshed server tree no longer carries that colour.
  const [customColorRemoved, setCustomColorRemoved] = useState(false);
  const { brandColor } = useCompanyBranding();
  if (customColorRemoved && !brandColor) setCustomColorRemoved(false);

  // Follow the server whenever it resolves a different company or preset (login, logout, act-as, a refresh).
  const [seenInitial, setSeenInitial] = useState<SiteTheme>(initialTheme);
  if (seenInitial !== initialTheme) {
    setSeenInitial(initialTheme);
    setActiveThemeState(initialTheme);
    setPreviewTheme(null);
  }

  const currentEffectiveTheme = previewTheme || activeTheme;

  // Apply theme to DOM elements
  const applyThemeToDom = useCallback((theme: SiteTheme) => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    document.body?.setAttribute("data-theme", theme);
  }, []);

  useEffect(() => {
    applyThemeToDom(currentEffectiveTheme);
    // While previewing, a saved custom brand colour steps aside so the preset's own accent is visible (see
    // buildBrandStyleCss). Nothing is saved until "Set as Theme". It also steps aside right after a preset replaced
    // it, so the new preset shows at once instead of after the server refresh.
    if (previewTheme || customColorRemoved) document.documentElement.setAttribute(THEME_PREVIEW_ATTRIBUTE, "");
    else document.documentElement.removeAttribute(THEME_PREVIEW_ATTRIBUTE);
  }, [currentEffectiveTheme, previewTheme, customColorRemoved, applyThemeToDom]);

  // One-time cleanup of the legacy shared key.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage unavailable
    }
  }, []);

  const preview = useCallback((theme: SiteTheme) => {
    setPreviewTheme(theme);
  }, []);

  const cancelPreview = useCallback(() => {
    setPreviewTheme(null);
  }, []);

  const setTheme = useCallback(async (newTheme: SiteTheme, options: { clearBrandColor?: boolean } = {}): Promise<boolean> => {
    if (!isValidTheme(newTheme)) return false;
    setIsSaving(true);
    try {
      const res = await fetch("/api/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Preset and custom-colour removal are one atomic update, so the company is never left half-switched.
        body: JSON.stringify(options.clearBrandColor ? { theme: newTheme, brandColor: null } : { theme: newTheme }),
      });

      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error?.message || json.message || "Failed to update theme");
      }

      setActiveThemeState(newTheme);
      setSeenInitial(newTheme);
      setPreviewTheme(null);
      if (options.clearBrandColor) setCustomColorRemoved(true);
      applyThemeToDom(newTheme);
      // Re-render the server tree so the page's own theme attribute and any cached pages match what was saved.
      router.refresh();
      void refreshCachedBranding();
      toast.success(
        options.clearBrandColor
          ? `Switched to ${THEME_CONFIGS[newTheme].name}. Your custom colour was removed.`
          : `Theme updated to ${THEME_CONFIGS[newTheme].name}!`
      );
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to change theme";
      toast.error(msg);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [applyThemeToDom, router]);

  return (
    <ThemeContext.Provider
      value={{
        activeTheme,
        previewTheme,
        currentEffectiveTheme,
        themeConfig: THEME_CONFIGS[currentEffectiveTheme],
        setTheme,
        preview,
        cancelPreview,
        isSaving,
        isLoading: false,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
