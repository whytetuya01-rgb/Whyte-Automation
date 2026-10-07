"use client";

import { useCallback } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/providers/ConfirmProvider";

/**
 * Returns a function that asks for confirmation and then signs the user out.
 *
 * Signing out goes through next-auth's client `signOut()` (a CSRF-protected
 * POST), never a plain link to `/api/auth/signout`, which only renders
 * next-auth's unstyled GET confirmation page.
 *
 * `beforeSignOut` runs once the user has confirmed, e.g. to start a loader.
 */
export function useConfirmSignOut(callbackUrl: string) {
  const confirm = useConfirm();

  return useCallback(
    async (beforeSignOut?: () => void) => {
      await confirm({
        title: "Sign out?",
        message: "Are you sure you want to sign out of your account?",
        detail: "Any unsaved changes on this page will be lost.",
        confirmText: "Sign Out",
        cancelText: "Stay Signed In",
        variant: "danger",
        icon: <LogOut size={20} className="text-red-600" />,
        onConfirm: async () => {
          try {
            beforeSignOut?.();
            await signOut({ callbackUrl });
          } catch (error) {
            console.error("Sign out failed:", error);
            toast.error("Unable to sign out. Please try again.");
            throw error;
          }
        },
      });
    },
    [confirm, callbackUrl]
  );
}

interface SignOutButtonProps {
  callbackUrl?: string;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}

export default function SignOutButton({
  callbackUrl = "/login",
  className,
  title = "Sign Out",
  children,
}: SignOutButtonProps) {
  const confirmSignOut = useConfirmSignOut(callbackUrl);

  return (
    <button
      type="button"
      onClick={() => void confirmSignOut()}
      className={className}
      title={title}
      aria-label={title}
    >
      {children ?? <LogOut size={15} />}
    </button>
  );
}
