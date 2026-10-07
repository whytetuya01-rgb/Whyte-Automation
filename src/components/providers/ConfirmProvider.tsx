"use client";

/**
 * Global Confirmation Modal System
 * ──────────────────────────────────────────────────────────────────────────────
 * Simple form (dialog closes, you then run the action):
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: "Delete Variant?", message: "..." });
 *   if (!ok) return;
 *   await doDelete();
 *
 * Loading form (dialog stays open with a spinner, double-click impossible):
 *
 *   const ok = await confirm({
 *     title: "Delete Variant?",
 *     message: "...",
 *     onConfirm: async () => {
 *       try { await apiJson.delete(...); } catch (e) { notifyApiError(e); }
 *     },
 *   });
 *   if (!ok) return;
 *
 * Mount <ConfirmProvider> once at the app root (src/app/providers.tsx).
 * The dialog renders through a React Portal at document.body, so it is never
 * nested inside another modal and always sits on the topmost z-layer.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  /** Modal title (default: "Confirm Action") */
  title?: string;
  /** The main description / body text */
  message: string;
  /** Optional extra detail line shown below the message */
  detail?: string;
  /** Text for the confirm button (default: "Confirm") */
  confirmText?: string;
  /** Text for the cancel button (default: "Cancel") */
  cancelText?: string;
  /** Visual variant of the confirm button (default: "danger") */
  variant?: "danger" | "primary";
  /** Optional icon replacing the default warning triangle. */
  icon?: React.ReactNode;
  /**
   * Optional async action. When provided the dialog stays open in a loading
   * state until it settles, so the action can never be fired twice.
   * Handle your own errors inside it; the dialog closes either way.
   */
  onConfirm?: () => Promise<void>;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface ConfirmContextValue {
  confirm: ConfirmFn;
}

const ConfirmContext = createContext<ConfirmContextValue>({
  confirm: () => Promise.resolve(false),
});

interface DialogState extends ConfirmOptions {
  open: boolean;
  loading: boolean;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false,
    loading: false,
    title: "Confirm Action",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    variant: "danger",
  });
  const [mounted, setMounted] = useState(false);

  // The pending resolver lives in a ref so state updaters stay pure and the
  // dialog never holds onto a stale closure.
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState((prev) => ({ ...prev, open: false, loading: false }));
  }, []);

  // Focus the confirm button and handle Escape while the dialog is open
  useEffect(() => {
    if (!state.open) return;

    const frame = requestAnimationFrame(() => confirmBtnRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // A running action must not be cancelled half-way through.
      if (!state.loading) close(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.open, state.loading, close]);

  const { loading, onConfirm } = state;

  const handleConfirm = useCallback(() => {
    if (loading) return;

    if (!onConfirm) {
      close(true);
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    // A rejected action is reported as "not confirmed" so the caller can bail out
    // instead of continuing as if the mutation had succeeded.
    onConfirm().then(
      () => close(true),
      () => close(false)
    );
  }, [loading, onConfirm, close]);

  const handleCancel = useCallback(() => {
    if (loading) return;
    close(false);
  }, [loading, close]);

  const confirm: ConfirmFn = useCallback((options) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({
        open: true,
        loading: false,
        title: "Confirm Action",
        confirmText: "Confirm",
        cancelText: "Cancel",
        variant: "danger",
        ...options,
      });
    });
  }, []);

  const contextValue = useMemo(() => ({ confirm }), [confirm]);

  const dialog =
    state.open && mounted
      ? createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: "var(--z-confirm)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={handleCancel}
              aria-hidden="true"
            />

            <div
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md border border-neutral-200"
              style={{ animation: "whyte-confirm-in 150ms ease-out" }}
            >
              <div className="flex items-start gap-4 p-6 pb-0">
                <div
                  className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ${
                    state.variant === "danger"
                      ? "bg-red-50 border border-red-100"
                      : "bg-blue-50 border border-blue-100"
                  }`}
                >
                  {state.icon ?? (
                    <AlertTriangle
                      size={20}
                      className={
                        state.variant === "danger" ? "text-red-600" : "text-blue-600"
                      }
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0 pr-2">
                  <h3
                    id="confirm-dialog-title"
                    className="text-base font-bold text-neutral-900 leading-tight"
                  >
                    {state.title || "Confirm Action"}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={state.loading}
                  className="shrink-0 p-1.5 rounded-xl text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors disabled:opacity-40"
                  aria-label="Cancel and close"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-6 pt-3 pb-6">
                <p
                  id="confirm-dialog-message"
                  className="text-sm text-neutral-600 leading-relaxed"
                >
                  {state.message}
                </p>
                {state.detail && (
                  <p className="mt-2 text-xs text-neutral-500 leading-relaxed">
                    {state.detail}
                  </p>
                )}

                <div className="flex gap-2.5 justify-end mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    disabled={state.loading}
                  >
                    {state.cancelText || "Cancel"}
                  </Button>
                  <Button
                    ref={confirmBtnRef}
                    type="button"
                    variant={state.variant === "danger" ? "danger" : "primary"}
                    size="sm"
                    loading={state.loading}
                    onClick={handleConfirm}
                  >
                    {state.confirmText || "Confirm"}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      {dialog}
    </ConfirmContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the global `confirm` function.
 *
 * @example
 * const confirm = useConfirm();
 * const ok = await confirm({ title: "Delete?", message: "...", variant: "danger" });
 * if (ok) doDelete();
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext).confirm;
}
