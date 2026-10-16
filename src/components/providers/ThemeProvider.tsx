"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { SiteTheme } from "@/models/Company";
import { DEFAULT_THEME, isValidTheme, THEME_CONFIGS, ThemeConfig } from "@/lib/themeTokens";
import toast from "react-hot-toast";

interface ThemeContextType {
  activeTheme: SiteTheme;
  previewTheme: SiteTheme | null;
  currentEffectiveTheme: SiteTheme;
  themeConfig: ThemeConfig;
  setTheme: (theme: SiteTheme) => Promise<boolean>;
  preview: (theme: SiteTheme) => void;
  cancelPreview: () => void;
  isSaving: boolean;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = "whyte_site_theme";

export function ThemeProvider({
  children,
  initialTheme = DEFAULT_THEME,
}: {
  children: React.ReactNode;
  initialTheme?: SiteTheme;
}) {
  const [activeTheme, setActiveThemeState] = useState<SiteTheme>(initialTheme);
  const [previewTheme, setPreviewTheme] = useState<SiteTheme | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const currentEffectiveTheme = previewTheme || activeTheme;

  // Apply theme to DOM elements
  const applyThemeToDom = useCallback((theme: SiteTheme) => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    document.body?.setAttribute("data-theme", theme);
  }, []);

  // Sync theme changes to DOM and localStorage
  useEffect(() => {
    applyThemeToDom(currentEffectiveTheme);
  }, [currentEffectiveTheme, applyThemeToDom]);

  // Initial client hydration: read localStorage if available, then sync with server
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored && isValidTheme(stored)) {
        setActiveThemeState(stored);
        applyThemeToDom(stored);
      }
    } catch {
      // Storage unavailable
    }

    // Fetch confirmed theme from company profile
    fetch("/api/theme")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load theme");
        return res.json();
      })
      .then((json) => {
        const theme = json?.data?.currentTheme || json?.currentTheme;
        if (theme && isValidTheme(theme)) {
          setActiveThemeState(theme);
          applyThemeToDom(theme);
          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, theme);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Fallback to default/local
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [applyThemeToDom]);

  const preview = useCallback((theme: SiteTheme) => {
    setPreviewTheme(theme);
  }, []);

  const cancelPreview = useCallback(() => {
    setPreviewTheme(null);
  }, []);

  const setTheme = useCallback(async (newTheme: SiteTheme): Promise<boolean> => {
    if (!isValidTheme(newTheme)) return false;
    setIsSaving(true);
    try {
      const res = await fetch("/api/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: newTheme }),
      });

      const json = await res.json();
      if (!res.ok || json.success === false) {
        throw new Error(json.error?.message || json.message || "Failed to update theme");
      }

      setActiveThemeState(newTheme);
      setPreviewTheme(null);
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, newTheme);
      } catch {
        // ignore
      }

      applyThemeToDom(newTheme);
      toast.success(`Theme updated to ${THEME_CONFIGS[newTheme].name}!`);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to change theme";
      toast.error(msg);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [applyThemeToDom]);

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
        isLoading,
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
