"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";
import notify from "@/lib/notify";
import { COVER_IMAGE_SPEC, coverImageHelp, coverImageProblem } from "@/lib/coverImage";
import { ALLOWED_IMAGE_MIME_TYPES } from "@/lib/validation/upload";

/** Same rules the server enforces (it stays the authority). */
async function checkCoverFile(file: File): Promise<string | null> {
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPG or WebP image.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > COVER_IMAGE_SPEC.maxBytes) return `The cover image must be ${COVER_IMAGE_SPEC.maxBytes / (1024 * 1024)}MB or smaller.`;
  const url = URL.createObjectURL(file);
  try {
    const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const probe = new window.Image();
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => resolve(null);
      probe.src = url;
    });
    return size ? coverImageProblem(size) : "That image could not be read. Please choose a different file.";
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The quotation cover picture: shown beside the cover title of the company's quotation documents. Uploads and
 * removals are saved straight away (the company comes from the session on the server).
 */
export default function CoverImageEditor({ coverImageUrl, onChanged }: { coverImageUrl: string | null; onChanged: () => Promise<void> | void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | null) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setError(null);
    const problem = await checkCoverFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("coverImage", file);
      const response = await fetch("/api/company/cover-image", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const message = result?.error?.message ?? "The cover image could not be saved. Your current cover was not changed.";
        setError(message);
        notify.error("Cover image not saved", message);
        return;
      }
      notify.success("Cover image saved", "Your quotation documents now show it on the cover.");
      await onChanged();
    } catch {
      setError("Unable to reach the server. Your current cover was not changed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/company/cover-image", { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error?.message ?? "The cover image could not be removed.");
        return;
      }
      notify.success("Cover image removed", "The cover shows the title only.");
      await onChanged();
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Cover image" data-testid="cover-image-editor" className="space-y-2">
      <p className="text-sm font-semibold text-gray-900">Cover image <span className="font-normal text-gray-500">(optional)</span></p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-[100px] w-[148px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50" data-testid="cover-image-frame">
          {coverImageUrl ? (
            <Image src={coverImageUrl} alt="Current cover image" width={148} height={100} unoptimized className="h-full w-full object-cover" />
          ) : (
            <ImagePlus size={24} className="text-gray-300" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 focus-within:ring-2 focus-within:ring-accent aria-disabled:opacity-60" aria-disabled={busy}>
              {busy ? "Working…" : coverImageUrl ? "Replace cover image" : "Upload cover image"}
              <input
                ref={input}
                type="file"
                accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
                aria-label="Cover image file"
                className="sr-only"
                disabled={busy}
                onChange={(event) => void upload(event.target.files?.[0] ?? null)}
              />
            </label>
            {coverImageUrl && (
              <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">{coverImageHelp()} It appears beside the cover title, cropped to fill.</p>
          {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
        </div>
      </div>
    </section>
  );
}
