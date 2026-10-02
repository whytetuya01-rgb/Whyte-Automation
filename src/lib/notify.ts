import toast, { ToastOptions } from "react-hot-toast";

export interface ToastPayload {
  title: string;
  description?: string;
  type?: "success" | "error" | "warning" | "info";
}

/**
 * Standardized notification helper for Whyte Admin.
 * Supports title + optional description for modern SaaS toasts.
 *
 * Examples:
 *   notify.success("Product created", "The product has been added successfully.")
 *   notify.error("Unable to update product", "Please try again.")
 *   notify.warning("Unsaved changes", "You have unsaved changes.")
 *   notify.info("System update", "Inventory sync in progress.")
 */
export const notify = {
  success: (title: string, description?: string, options?: ToastOptions): string => {
    return toast.success({ title, description, type: "success" } as unknown as string, {
      duration: 3500,
      ...options,
    });
  },
  error: (title: string, description?: string, options?: ToastOptions): string => {
    return toast.error({ title, description, type: "error" } as unknown as string, {
      duration: 5500,
      ...options,
    });
  },
  warning: (title: string, description?: string, options?: ToastOptions): string => {
    return toast({ title, description, type: "warning" } as unknown as string, {
      duration: 5000,
      ...options,
    });
  },
  info: (title: string, description?: string, options?: ToastOptions): string => {
    return toast({ title, description, type: "info" } as unknown as string, {
      duration: 4000,
      ...options,
    });
  },
  promise: toast.promise,
  dismiss: toast.dismiss,
  remove: toast.remove,
};

export { toast };
export default notify;
