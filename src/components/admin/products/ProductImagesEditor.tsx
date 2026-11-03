"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Link2, Package, Star, X } from "lucide-react";
import { Input } from "@/components/ui";
import notify from "@/lib/notify";
import { MAX_PRODUCT_IMAGES, isAcceptableImageUrl, moveImage, type ProductImage } from "@/lib/productImages";

interface Props {
  images: ProductImage[];
  /** Like a state setter: receives the current list, returns the new one (uploads finish at different times). */
  onChange: (update: (current: ProductImage[]) => ProductImage[]) => void;
  /** A file was uploaded in this editing session but is not saved on the product yet. */
  onUploaded: (publicId: string) => void;
  /** An unsaved upload was taken out again: the caller deletes it from storage now. */
  onDiscardUploaded: (publicId: string) => void;
  /** Uploaded in this session and not saved yet. */
  isUnsaved: (publicId: string) => boolean;
}

async function uploadOne(file: File): Promise<ProductImage> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new Error(message || "Failed to upload image");
  }
  const payload = (await res.json()) as { data?: { url?: string; publicId?: string }; url?: string; publicId?: string };
  const url = payload.data?.url ?? payload.url;
  if (!url) throw new Error("Upload succeeded but no image URL was returned.");
  return { url, publicId: payload.data?.publicId ?? payload.publicId ?? null };
}

/** Up to six pictures for a product. The first is the cover (what quotations and pickers show). */
export default function ProductImagesEditor({ images, onChange, onUploaded, onDiscardUploaded, isUnsaved }: Props) {
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState("");
  const full = images.length >= MAX_PRODUCT_IMAGES;

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const room = MAX_PRODUCT_IMAGES - images.length;
    if (room <= 0) {
      notify.error("Image limit reached", `A product can have up to ${MAX_PRODUCT_IMAGES} images. Remove one first.`);
      return;
    }
    if (files.length > room) notify.info("Some images were skipped", `Only ${room} more ${room === 1 ? "image fits" : "images fit"}; the rest were not uploaded.`);
    setUploading(true);
    try {
      for (const file of files.slice(0, room)) {
        if (!file.type.startsWith("image/")) {
          notify.error("Invalid file", `${file.name} is not an image (JPG, PNG or WebP).`);
          continue;
        }
        try {
          const uploaded = await uploadOne(file);
          if (uploaded.publicId) onUploaded(uploaded.publicId);
          onChange((current) => (current.length >= MAX_PRODUCT_IMAGES ? current : [...current, uploaded]));
        } catch (error) {
          notify.error("Upload error", error instanceof Error ? error.message : "Image upload failed");
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const addLink = () => {
    const url = link.trim();
    if (!url) return;
    if (!isAcceptableImageUrl(url)) {
      notify.error("Not a valid image address", "Use an https link, or a catalogue path that starts with a single /.");
      return;
    }
    if (images.some((image) => image.url === url)) {
      notify.error("Already added", "That image is already on this product.");
      return;
    }
    if (full) {
      notify.error("Image limit reached", `A product can have up to ${MAX_PRODUCT_IMAGES} images. Remove one first.`);
      return;
    }
    onChange((current) => [...current, { url, publicId: null }]);
    setLink("");
  };

  const remove = (index: number) => {
    const target = images[index];
    // A picture uploaded in this session and never saved is unreachable once removed: delete it from storage right away.
    if (target?.publicId && isUnsaved(target.publicId)) onDiscardUploaded(target.publicId);
    onChange((current) => current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3" data-testid="product-images-editor">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-neutral-500" data-testid="product-images-count">
          {images.length} of {MAX_PRODUCT_IMAGES} images. The first one is the cover shown on quotations.
        </p>
      </div>

      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3 md:grid-cols-6" aria-label="Product images">
          {images.map((image, index) => (
            <li key={image.url} data-testid="product-image-tile" data-index={index} className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs">
              <div className="relative flex aspect-square items-center justify-center bg-neutral-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`Product image ${index + 1}`} className="h-full w-full object-contain p-1" onError={(e) => ((e.target as HTMLElement).style.opacity = "0.25")} />
                {index === 0 && (
                  <span data-testid="product-image-cover-badge" className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-full bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    <Star className="h-2.5 w-2.5" aria-hidden /> Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Remove image ${index + 1}`}
                  title="Remove image"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900/80 text-white transition-colors hover:bg-neutral-900"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-1 border-t border-neutral-100 px-1.5 py-1">
                <button type="button" onClick={() => onChange((current) => moveImage(current, index, index - 1))} disabled={index === 0} aria-label={`Move image ${index + 1} earlier`} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                {index > 0 ? (
                  <button type="button" onClick={() => onChange((current) => moveImage(current, index, 0))} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-100">
                    Make cover
                  </button>
                ) : (
                  <span className="text-[10px] text-neutral-400">Cover</span>
                )}
                <button type="button" onClick={() => onChange((current) => moveImage(current, index, index + 1))} disabled={index === images.length - 1} aria-label={`Move image ${index + 1} later`} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white text-neutral-400" data-testid="product-images-empty">
          <Package className="h-8 w-8" aria-hidden />
          <span className="ml-2 text-xs">No images yet</span>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <label className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-2xs transition-colors ${full || uploading ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-neutral-50"}`}>
          <ImagePlus className="h-3.5 w-3.5 text-neutral-500" />
          <span>{uploading ? "Uploading..." : "Upload images"}</span>
          <input type="file" accept="image/*" multiple onChange={handleFiles} disabled={full || uploading} className="hidden" data-testid="product-image-upload" />
        </label>
        <div className="flex min-w-0 flex-1 gap-2">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder="Or paste an https link / catalogue path"
            className="text-xs font-mono"
            data-testid="product-image-url"
            disabled={full}
          />
          <button type="button" onClick={addLink} disabled={full || !link.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40" data-testid="product-image-add-link">
            <Link2 className="h-3.5 w-3.5" aria-hidden /> Add link
          </button>
        </div>
      </div>
    </div>
  );
}
