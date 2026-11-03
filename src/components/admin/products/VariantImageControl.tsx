"use client";

import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import notify from "@/lib/notify";

interface Props {
  /** The variant's own picture, or null (the product's cover is used instead). */
  url: string | null;
  /** Shown when the variant has no picture of its own. */
  fallbackUrl?: string | null;
  disabled?: boolean;
  onChange: (picture: { url: string; publicId: string | null } | null) => void;
}

/** One optional picture for a variant: upload, replace or remove. The caller decides when it is saved or deleted from storage. */
export default function VariantImageControl({ url, fallbackUrl, disabled, onChange }: Props) {
  const [uploading, setUploading] = useState(false);

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      notify.error("Invalid file", "Please select an image (JPG, PNG or WebP).");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
        throw new Error((typeof body?.error === "string" ? body.error : body?.error?.message) || "Failed to upload image");
      }
      const payload = (await res.json()) as { data?: { url?: string; publicId?: string } };
      if (!payload.data?.url) throw new Error("Upload succeeded but no image URL was returned.");
      onChange({ url: payload.data.url, publicId: payload.data.publicId ?? null });
    } catch (error) {
      notify.error("Upload error", error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploading(false);
    }
  };

  const shown = url ?? fallbackUrl ?? null;
  return (
    <div className="flex items-center gap-2" data-testid="variant-image-control">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className={`h-full w-full object-contain p-0.5 ${url ? "" : "opacity-40"}`} data-testid="variant-image-preview" data-own={url ? "true" : "false"} />
        ) : (
          <ImagePlus className="h-4 w-4 text-neutral-300" aria-hidden />
        )}
      </div>
      <div className="flex flex-col items-start gap-0.5">
        <label className={`text-[10px] font-semibold text-neutral-600 underline-offset-2 ${disabled || uploading ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:underline"}`}>
          {uploading ? "Uploading..." : url ? "Replace" : "Add image"}
          <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={disabled || uploading} data-testid="variant-image-upload" />
        </label>
        {url && (
          <button type="button" onClick={() => onChange(null)} disabled={disabled} className="inline-flex items-center gap-0.5 text-[10px] text-neutral-500 hover:text-red-600" aria-label="Remove variant image">
            <X className="h-2.5 w-2.5" aria-hidden /> Remove
          </button>
        )}
      </div>
    </div>
  );
}
