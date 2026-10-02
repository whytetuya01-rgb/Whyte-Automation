"use client";

import React, { useMemo } from "react";
import { Toaster, Toast, resolveValue, toast } from "react-hot-toast";
import {
  CheckCircle2,
  CircleX,
  TriangleAlert,
  Info,
  X,
  Loader2,
} from "lucide-react";

interface ToastPayload {
  title: string;
  description?: string;
  type?: "success" | "error" | "warning" | "info";
}

function WhyteToastItem({ t }: { t: Toast }) {
  const rawMessage = resolveValue(t.message, t);

  const { title, description, resolvedType } = useMemo(() => {
    // If message is a structured ToastPayload object
    if (
      typeof rawMessage === "object" &&
      rawMessage !== null &&
      !("$$typeof" in rawMessage) &&
      "title" in rawMessage
    ) {
      const payload = rawMessage as ToastPayload;
      return {
        title: payload.title,
        description: payload.description,
        resolvedType: payload.type || t.type,
      };
    }

    // If message is a string
    if (typeof rawMessage === "string") {
      if (rawMessage.includes("\n")) {
        const [first, ...rest] = rawMessage.split("\n");
        return {
          title: first,
          description: rest.join(" ").trim(),
          resolvedType: t.type,
        };
      }
      return {
        title: rawMessage,
        description: undefined,
        resolvedType: t.type,
      };
    }

    // Fallback for ReactNode
    return {
      title: rawMessage as React.ReactNode,
      description: undefined,
      resolvedType: t.type,
    };
  }, [rawMessage, t.type]);

  // Semantic styles for each notification type
  const config = useMemo(() => {
    switch (resolvedType) {
      case "error":
        return {
          icon: <CircleX className="w-5 h-5 text-rose-600 shrink-0" strokeWidth={2.2} />,
          iconBg: "bg-rose-50 border-rose-100/90 text-rose-600",
          progressBg: "bg-rose-500",
          role: "alert" as const,
        };
      case "warning":
        return {
          icon: <TriangleAlert className="w-5 h-5 text-amber-600 shrink-0" strokeWidth={2.2} />,
          iconBg: "bg-amber-50 border-amber-100/90 text-amber-600",
          progressBg: "bg-amber-500",
          role: "status" as const,
        };
      case "info":
        return {
          icon: <Info className="w-5 h-5 text-accent shrink-0" strokeWidth={2.2} />,
          iconBg: "bg-accent-light border-accent-border/90 text-accent",
          progressBg: "bg-accent",
          role: "status" as const,
        };
      case "loading":
        return {
          icon: <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" strokeWidth={2.2} />,
          iconBg: "bg-neutral-50 border-neutral-100 text-accent",
          progressBg: "bg-accent",
          role: "status" as const,
        };
      case "success":
      default:
        return {
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" strokeWidth={2.2} />,
          iconBg: "bg-emerald-50 border-emerald-100/90 text-emerald-600",
          progressBg: "bg-emerald-500",
          role: "status" as const,
        };
    }
  }, [resolvedType]);

  const duration = t.duration || 4000;

  return (
    <div
      role={config.role}
      aria-live={config.role === "alert" ? "assertive" : "polite"}
      className={`group relative overflow-hidden w-full max-w-[360px] sm:max-w-[420px] bg-white rounded-2xl border border-neutral-200/90 shadow-xl shadow-black/5 p-3.5 sm:p-4 transition-all duration-200 ease-out select-none pointer-events-auto ${t.visible
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 -translate-y-2 scale-95 pointer-events-none"
        }`}
    >
      <div className="flex items-start gap-3">
        {/* Semantic Icon Container */}
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 shadow-2xs ${config.iconBg}`}
        >
          {config.icon}
        </div>

        {/* Text Content */}
        <div className="min-w-0 flex-1 pt-0.5 pr-1">
          <div className="text-sm font-semibold text-neutral-900 leading-snug tracking-tight">
            {title}
          </div>
          {description && (
            <p className="text-xs text-neutral-500 leading-relaxed mt-1 break-words">
              {description}
            </p>
          )}
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={() => toast.dismiss(t.id)}
          aria-label="Close notification"
          className="w-7 h-7 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100/80 active:bg-neutral-200/80 flex items-center justify-center transition-colors shrink-0 -mr-1 -mt-1 focus:outline-none focus:ring-2 focus:ring-accent/20 cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      {/* Subtle Progress Bar */}
      {duration > 0 && duration !== Infinity && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gray-100 overflow-hidden">
          <div
            className={`h-full ${config.progressBg} opacity-75`}
            style={{
              animation: `whyteToastProgress ${duration}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function WhyteToaster() {
  return (
    <Toaster
      position="top-right"
      gutter={10}
      containerStyle={{
        top: 20,
        right: 20,
        bottom: 20,
        left: 20,
        zIndex: "var(--z-toast)",
      }}
      toastOptions={{
        duration: 4000,
        success: {
          duration: 3500,
        },
        error: {
          duration: 5500,
        },
      }}
    >
      {(t) => <WhyteToastItem t={t} />}
    </Toaster>
  );
}
