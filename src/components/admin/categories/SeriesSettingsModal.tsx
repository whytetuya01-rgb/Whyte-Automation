"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { Button, Checkbox, Textarea } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { EMPTY_SERIES, SERIES_LIMITS, normalizeSeries, type CategorySeries } from "@/lib/productSeries";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_SIZE } from "@/lib/validation/upload";
import type { Category } from "@/types";

interface Props {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Series settings for one top-level category: present it as a product series, with a description, an image and
 * whether the quotation document shows it. The image uploads to the company's own product folder (POST /api/upload);
 * nothing is saved until "Save Series".
 */
export default function SeriesSettingsModal({ category, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<CategorySeries>(EMPTY_SERIES);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(normalizeSeries(category?.series));
    setError(null);
  }, [category]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) return setError("Use a PNG, JPG or WebP image.");
    if (file.size > MAX_UPLOAD_SIZE) return setError(`The image must be ${Math.round(MAX_UPLOAD_SIZE / (1024 * 1024))}MB or smaller.`);
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.data?.url || !result?.data?.publicId) {
        setError(result?.error?.message ?? "The image could not be uploaded. Please try again.");
        return;
      }
      setDraft((previous) => ({ ...previous, imageUrl: result.data.url, imagePublicId: result.data.publicId }));
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const save = async () => {
    if (!category) return;
    setSaving(true);
    try {
      await apiJson.patch(`/api/categories/${category.id}/series`, {
        enabled: draft.enabled,
        description: draft.description ?? "",
        showOnPdf: draft.enabled && draft.showOnPdf,
        image: draft.imageUrl && draft.imagePublicId ? { url: draft.imageUrl, publicId: draft.imagePublicId } : null,
      });
      notify.success("Series saved", draft.enabled ? `${category.name} is shown as a product series.` : `${category.name} is no longer a series.`);
      onSaved();
      onClose();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to save the series", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || uploading;
  const description = draft.description ?? "";

  return (
    <Modal isOpen={category !== null} onClose={onClose} title={category ? `Series: ${category.name}` : "Series"} size="lg">
      <div className="space-y-5" data-testid="series-settings">
        <Checkbox
          label="Show this category as a product series"
          description="For product lines such as Tactus or Retro Series. Leave type groups (Accessories, Smart Locks…) unticked."
          checked={draft.enabled}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          data-testid="series-enabled"
        />

        <fieldset disabled={!draft.enabled || busy} className="space-y-5 disabled:opacity-60">
          <div className="space-y-1.5">
            <Textarea
              label="Description"
              rows={4}
              value={description}
              maxLength={SERIES_LIMITS.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What makes this series special: design, technology, finishes…"
              data-testid="series-description"
            />
            <p className="text-right text-[11px] text-neutral-400">{description.length}/{SERIES_LIMITS.description}</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-neutral-800">Image</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 sm:w-44" data-testid="series-image-frame">
                {draft.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.imageUrl} alt={`${category?.name ?? "Series"} image`} className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImagePlus size={24} className="text-neutral-300" aria-hidden="true" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700 focus-within:ring-2 focus-within:ring-accent">
                  {uploading ? "Uploading…" : draft.imageUrl ? "Replace image" : "Upload image"}
                  <input ref={fileInput} type="file" accept={ALLOWED_IMAGE_MIME_TYPES.join(",")} aria-label="Series image file" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
                </label>
                {draft.imageUrl && (
                  <button type="button" onClick={() => setDraft({ ...draft, imageUrl: null, imagePublicId: null })} className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline">
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-neutral-500">PNG, JPG or WebP, up to {Math.round(MAX_UPLOAD_SIZE / (1024 * 1024))}MB. A wide product or lifestyle photo works best.</p>
          </div>

          <Checkbox
            label="Show on the quotation PDF"
            description="Adds a Product Series page with this image and description when a quotation includes products from this series."
            checked={draft.showOnPdf}
            onChange={(e) => setDraft({ ...draft, showOnPdf: e.target.checked })}
            data-testid="series-show-on-pdf"
          />
        </fieldset>

        {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}

        <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={saving} disabled={uploading} onClick={() => void save()} data-testid="series-save">
            Save Series
          </Button>
        </div>
      </div>
    </Modal>
  );
}
