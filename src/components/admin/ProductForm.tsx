"use client";

import { useState, useMemo, useEffect } from "react";
import { Product, ProductVariant, Category } from "@/types";
import notify from "@/lib/notify";
import { ApiClientError, apiJson, notifyApiError } from "@/lib/apiClient";
import { getCategoryVariantMatrix } from "@/lib/categoryConfig";
import { suggestVariantCode, validateVariantCode } from "@/lib/productVariantService";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import {
  ImagePlus,
  X,
  Package,
  Tag,
  Layers,
  Hash,
  Cpu,
  Info,
  ChevronDown,
  ChevronUp,
  Trash2,
  AlertCircle,
  Save,
  LayoutGrid,
  ListChecks,
  Wand2,
} from "lucide-react";
import { Input, Select, Textarea, Button, Switch } from "@/components/ui";

/** A single editable variant row inside the Edit Product → Variant Configurations tab */
interface VariantRow {
  id: number;
  displayName: string;
  automationTier: string;
  surfaceFinish: string;
  variantCode: string;
  price: string;
  hasPriceError: boolean;
}

/** A single editable row in the variant matrix during product creation */
interface EditableVariantRow {
  /** Stable key identifying which matrix combination this row represents */
  comboKey: string;
  automationTier: string | null;
  surfaceFinish: string | null;
  tierLabel: string | null;
  finishLabel: string | null;
  displayName: string;
  variantCode: string;
  price: string; // stored as string so the input stays editable
}

const PRODUCT_TYPES = [
  { value: "switch_board", label: "Switch Board" },
  { value: "accessory", label: "Accessory" },
  { value: "retrofit", label: "Retrofit" },
  { value: "curtain", label: "Curtain" },
  { value: "smart_lock", label: "Smart Lock" },
  { value: "vdp", label: "VDP" },
  { value: "other", label: "Other" },
];

const COMMON_MODULE_SIZES = [
  "2M",
  "3M",
  "4M",
  "6M",
  "8M",
  "8 SQ.",
  "12M",
  "16M",
  "18M",
  "NA",
];

interface Props {
  product: Product | null;
  categories: Category[];
  onSuccess: () => void;
  onCancel?: () => void;
}

function flattenCategories(
  cats: Category[],
  prefix = ""
): { id: number; label: string; category: Category }[] {
  const result: { id: number; label: string; category: Category }[] = [];
  for (const cat of cats) {
    result.push({ id: cat.id, label: prefix + cat.name, category: cat });
    if (cat.children?.length) {
      result.push(...flattenCategories(cat.children, prefix + "  › "));
    }
  }
  return result;
}

export default function ProductForm({
  product,
  categories,
  onSuccess,
  onCancel,
}: Props) {
  const isEdit = Boolean(product);

  const [form, setForm] = useState({
    name: product?.name ?? "",
    code: product?.code ?? "",
    description: product?.description ?? "",
    type: product?.type ?? "switch_board",
    categoryId: product?.categoryId ? String(product.categoryId) : "",
    moduleSize: product?.moduleSize ?? "",
    unit: product?.unit ?? "pcs",
    notes: product?.notes ?? "",
    imageUrl: product?.imageUrl ?? "",
    isActive: product?.isActive ?? true,
    sortOrder: product?.sortOrder ?? 0,
  });

  const confirm = useConfirm();

  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showSecondaryInfo, setShowSecondaryInfo] = useState(isEdit);

  // ── Edit-mode variant state ────────────────────────────────────────────────
  // Two tabs: "current" (editable list) | "matrix" (read-only category view)
  const [activeVariantTab, setActiveVariantTab] = useState<"current" | "matrix">("current");
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);
  const [savingVariants, setSavingVariants] = useState(false);
  const [deletingVariantId, setDeletingVariantId] = useState<number | null>(null);

  // Hydrate variant rows whenever the product changes (edit mode only)
  useEffect(() => {
    if (!isEdit || !product) return;
    const variants: ProductVariant[] = (product.variants as ProductVariant[]) || [];
    setVariantRows(
      variants.map((v) => {
        const autoTier = v.automationTier || (v.config as any)?.series || "";
        const finish = v.surfaceFinish || (v.config as any)?.finish || "";
        const parts: string[] = [];
        if (autoTier) parts.push(autoTier.charAt(0).toUpperCase() + autoTier.slice(1));
        if (finish) parts.push(finish.charAt(0).toUpperCase() + finish.slice(1));
        return {
          id: v.id,
          displayName: parts.length > 0 ? parts.join(" · ") : "Standard",
          automationTier: autoTier ? autoTier.charAt(0).toUpperCase() + autoTier.slice(1) : "—",
          surfaceFinish: finish ? finish.charAt(0).toUpperCase() + finish.slice(1) : "—",
          variantCode: v.variantCode || v.code || (v.config as any)?.variantCode || "",
          price: v.price !== undefined && v.price !== null ? String(v.price) : "",
          hasPriceError: false,
        };
      })
    );
  }, [isEdit, product]);

  const handleVariantCodeChange = (id: number, val: string) =>
    setVariantRows((prev) => prev.map((r) => (r.id === id ? { ...r, variantCode: val } : r)));

  const handleVariantPriceChange = (id: number, val: string) =>
    setVariantRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const num = Number(val);
        const isInvalid = val.trim() === "" || !Number.isFinite(num) || isNaN(num) || num < 0;
        return { ...r, price: val, hasPriceError: isInvalid };
      })
    );

  /** Save variant Code + Price in bulk via PATCH */
  const handleSaveVariants = async () => {
    if (!product) return;
    const invalid = variantRows.find((r) => r.hasPriceError || r.price.trim() === "");
    if (invalid) {
      notify.error("Validation error", `${invalid.displayName}: price is required and must be ≥ 0.`);
      return;
    }
    const missingCode = variantRows.find((r) => r.variantCode.trim() === "");
    if (missingCode) {
      notify.error("Validation error", `${missingCode.displayName}: variant code is required.`);
      return;
    }
    setSavingVariants(true);
    try {
      await apiJson.patch(`/api/products/${product.id}/variants`, {
        variants: variantRows.map((r) => ({
          id: r.id,
          variantCode: r.variantCode.trim(),
          price: Number(r.price),
        })),
      });
      notify.success("Variants saved", `Updated ${variantRows.length} variants for "${product.name}".`);
    } catch (err: unknown) {
      notifyApiError(err, "Save failed", "Failed to save variants");
    } finally {
      setSavingVariants(false);
    }
  };

  /** Delete a single variant — uses the global confirm dialog's loading mode */
  const handleDeleteVariant = async (variantId: number, displayName: string) => {
    if (!product) return;
    const productId = product.id;

    await confirm({
      title: "Delete Variant?",
      message: `Are you sure you want to delete "${displayName}"?`,
      detail: "This will permanently remove this variant from the product.",
      confirmText: "Delete Variant",
      variant: "danger",
      onConfirm: async () => {
        setDeletingVariantId(variantId);
        try {
          await apiJson.delete(`/api/products/${productId}/variants/${variantId}`);
          setVariantRows((prev) => prev.filter((r) => r.id !== variantId));
          notify.success("Variant deleted", `"${displayName}" deleted successfully.`);
        } catch (err: unknown) {
          if (err instanceof ApiClientError && err.code === "MINIMUM_VARIANT") {
            notify.error("Cannot delete variant", err.message);
            return;
          }
          notifyApiError(err, "Delete failed", "Unable to delete this variant.");
        } finally {
          setDeletingVariantId(null);
        }
      },
    });
  };

  // Editable variant rows — only used during product creation
  const [editableRows, setEditableRows] = useState<EditableVariantRow[]>([]);

  const flatCats = useMemo(() => flattenCategories(categories), [categories]);

  // Determine the authoritative Category Variant Matrix for selected category
  const selectedCategory = useMemo(() => {
    if (!form.categoryId) return null;
    return (
      flatCats.find((c) => String(c.id) === String(form.categoryId))?.category ||
      null
    );
  }, [form.categoryId, flatCats]);

  const variantMatrix = useMemo(() => {
    if (!selectedCategory) return null;
    return getCategoryVariantMatrix(selectedCategory);
  }, [selectedCategory]);

  // When category changes (create mode only), reset editable rows from the new matrix
  useEffect(() => {
    if (isEdit) return;
    if (!variantMatrix || !variantMatrix.hasMatrix) {
      setEditableRows([]);
      return;
    }
    setEditableRows(
      variantMatrix.combinations.map((comb) => ({
        comboKey: `${comb.automationTier ?? ""}::${comb.surfaceFinish ?? ""}`,
        automationTier: comb.automationTier,
        surfaceFinish: comb.surfaceFinish,
        tierLabel: comb.tierLabel,
        finishLabel: comb.finishLabel,
        displayName: comb.displayName,
        variantCode: "",
        price: "",
      }))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantMatrix, isEdit]);

  /** Update a single field of one editable row */
  const updateRow = (comboKey: string, field: "variantCode" | "price", value: string) => {
    setEditableRows((prev) =>
      prev.map((row) => (row.comboKey === comboKey ? { ...row, [field]: value } : row))
    );
  };

  /** Remove a single combination from the pending creation list */
  const removeRow = (comboKey: string) => {
    setEditableRows((prev) => prev.filter((row) => row.comboKey !== comboKey));
  };

  /** Validate all editable rows; returns error message or null */
  const validateEditableRows = (): string | null => {
    if (editableRows.length === 0) {
      return "At least one variant configuration is required.";
    }
    const seenCodes = new Map<string, number>(); // lowercase code → row index
    for (let i = 0; i < editableRows.length; i++) {
      const row = editableRows[i];
      // Price validation
      const priceVal = row.price.trim();
      if (priceVal === "") {
        return `Row ${i + 1} (${row.displayName}): Price is required.`;
      }
      const parsedPrice = Number(priceVal);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        return `Row ${i + 1} (${row.displayName}): Price must be a valid number ≥ 0.`;
      }
      // Variant code is required for every new variant
      const code = row.variantCode.trim();
      if (code === "") {
        return `Row ${i + 1} (${row.displayName}): Variant code is required.`;
      }
      const codeCheck = validateVariantCode(code, `Row ${i + 1} (${row.displayName}) variant code`);
      if (!codeCheck.valid) {
        return codeCheck.message;
      }
      const codeKey = code.toUpperCase();
      if (seenCodes.has(codeKey)) {
        return `Variant code '${code}' is already used by another variant (row ${(seenCodes.get(codeKey) ?? 0) + 1}).`;
      }
      seenCodes.set(codeKey, i);
    }
    return null;
  };

  /** Fills an empty variant code with a suggestion derived from product + combination. */
  const handleAutoCode = (comboKey: string) => {
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.comboKey !== comboKey || row.variantCode.trim() !== "") return row;
        return {
          ...row,
          variantCode: suggestVariantCode({
            productCode: form.code,
            automationTier: row.automationTier,
            surfaceFinish: row.surfaceFinish,
            existingCodes: prev
              .filter((other) => other.comboKey !== comboKey)
              .map((other) => other.variantCode.trim())
              .filter(Boolean),
          }),
        };
      })
    );
  };

  /** Fills every empty variant code in one go. */
  const handleAutoCodeAll = () => {
    setEditableRows((prev) => {
      const taken = prev.map((row) => row.variantCode.trim()).filter(Boolean);
      return prev.map((row) => {
        if (row.variantCode.trim() !== "") return row;
        const suggestion = suggestVariantCode({
          productCode: form.code,
          automationTier: row.automationTier,
          surfaceFinish: row.surfaceFinish,
          existingCodes: taken,
        });
        taken.push(suggestion);
        return { ...row, variantCode: suggestion };
      });
    });
  };

  /** Number of rows still waiting for a code — drives the "Auto-fill" button state. */
  const missingCodeCount = editableRows.filter(
    (row) => row.variantCode.trim() === ""
  ).length;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      notify.error("Invalid file", "Please select a valid image file (JPG, PNG, WebP).");
      return;
    }

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to upload image");
      }

      const data = await res.json();
      setForm((prev) => ({ ...prev, imageUrl: data.url }));
      notify.success("Image uploaded", "Product image uploaded successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Image upload failed";
      notify.error("Upload error", msg);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) {
      notify.error("Validation error", "Product name is required.");
      return;
    }

    if (!form.categoryId) {
      notify.error("Validation error", "Please select a Category.");
      return;
    }

    // Validate editable variant rows on create
    if (!isEdit && variantMatrix?.hasMatrix) {
      const rowError = validateEditableRows();
      if (rowError) {
        notify.error("Variant configuration error", rowError);
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        description: form.description.trim() || null,
        type: form.type,
        categoryId: Number(form.categoryId),
        moduleSize: form.moduleSize.trim() || null,
        unit: form.unit.trim() || "pcs",
        notes: form.notes.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 0,
      };

      if (isEdit && product) {
        await apiJson.patch(`/api/products/${product.id}`, payload);

        notify.success("Product updated", `Product "${form.name}" has been updated.`);
      } else {
        // Build the variants array from editable rows (only the remaining user-selected rows)
        const variantsPayload = editableRows.map((row) => ({
          automationTier: row.automationTier,
          surfaceFinish: row.surfaceFinish,
          variantCode: row.variantCode.trim(),
          price: Number(row.price.trim()),
        }));

        const created = await apiJson.post<Product & { variants?: ProductVariant[] }>(
          "/api/products",
          { ...payload, variants: variantsPayload }
        );

        const count = created?.variants?.length ?? variantsPayload.length;
        notify.success(
          "Product created",
          `Product "${form.name}" created with ${count} ${
            count === 1 ? "variant" : "variants"
          }.`
        );
      }

      onSuccess();
    } catch (err: unknown) {
      notifyApiError(err, "Save error", "Failed to save product");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ============================================================== */}
      {/* SECTION 1: PRIMARY PRODUCT IDENTITY / CONFIGURATION            */}
      {/* ============================================================== */}
      <div className="space-y-4">
        {/* 1. Product Image */}
        <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            1. Product Image
          </label>
          <div className="flex items-start gap-4">
            <div className="relative h-20 w-20 shrink-0 rounded-xl border border-neutral-200 bg-white overflow-hidden flex items-center justify-center shadow-xs">
              {form.imageUrl ? (
                <img
                  src={form.imageUrl}
                  alt="Product thumbnail"
                  className="h-full w-full object-contain p-1"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <Package className="h-8 w-8 text-neutral-300" />
              )}
              {form.imageUrl && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, imageUrl: "" }))}
                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-neutral-900/80 text-white flex items-center justify-center hover:bg-neutral-900 transition-colors"
                  title="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex-1 space-y-2">
              <div>
                <Input
                  value={form.imageUrl}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, imageUrl: e.target.value }))
                  }
                  placeholder="Image path or URL (e.g. /whyte_catalog_images/Tactus_item_001.jpg)"
                  className="text-xs font-mono"
                />
                <p className="text-[11px] text-neutral-400 mt-1">
                  Static catalog image path or external HTTPS URL.
                </p>
              </div>
              <div>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer transition-colors shadow-2xs">
                  <ImagePlus className="h-3.5 w-3.5 text-neutral-500" />
                  <span>{uploadingImage ? "Uploading..." : "Upload New Image"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={uploadingImage}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Primary Identity Fields (Grid) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 2. Product Name */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-semibold text-neutral-800">
              2. Product Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Touch 2 Switch 1 Socket (6A)"
              required
              className="font-medium"
            />
          </div>

          {/* 3. Product Code / Base SKU */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-800 flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-neutral-500" />
              3. Product Code (Base SKU)
            </label>
            <Input
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              placeholder="e.g. TAC-004-2M"
              className="font-mono text-xs uppercase"
            />
            <p className="text-[11px] text-neutral-400">
              Optional base catalog identifier. Specific options use Variant Code.
            </p>
          </div>

          {/* 4. Category */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-800 flex items-center justify-between">
              <span>
                4. Category <span className="text-red-500">*</span>
              </span>
              {selectedCategory && (
                <span className="text-[10px] font-normal text-blue-600">
                  Matrix source loaded
                </span>
              )}
            </label>
            <Select
              value={form.categoryId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, categoryId: e.target.value }))
              }
              required
            >
              <option value="">Select a Category</option>
              {flatCats.map((cat) => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.label}
                </option>
              ))}
            </Select>
          </div>

          {/* 5. Module Size */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-800 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-neutral-500" />
              5. Module Size
            </label>
            <Input
              value={form.moduleSize}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, moduleSize: e.target.value }))
              }
              placeholder="e.g. 2M, 4M, 8SQ, NA"
              className="font-medium"
            />
            <div className="flex flex-wrap gap-1 pt-1">
              {COMMON_MODULE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, moduleSize: size }))}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                    form.moduleSize.toUpperCase() === size.toUpperCase()
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* 6. Product Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-800">
              6. Product Type
            </label>
            <Select
              value={form.type}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, type: e.target.value as any }))
              }
            >
              {PRODUCT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* SECTION 2: VARIANT CONFIGURATIONS (EDIT MODE)                  */}
      {/* Two tabs: Current Variants (editable) | Possible Matrix         */}
      {/* ============================================================== */}
      {isEdit && product && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-4 py-3 bg-neutral-50 border-b border-neutral-200">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                Variant Configurations
              </h3>
            </div>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                variantRows.length > 0
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-neutral-100 text-neutral-500 border-neutral-200"
              }`}
            >
              {variantRows.length} {variantRows.length === 1 ? "Variant" : "Variants"}
            </span>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-neutral-200">
            <button
              type="button"
              onClick={() => setActiveVariantTab("current")}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                activeVariantTab === "current"
                  ? "border-neutral-900 text-neutral-900 bg-white"
                  : "border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              <ListChecks className="h-3.5 w-3.5" />
              Current Variants
            </button>
            <button
              type="button"
              onClick={() => setActiveVariantTab("matrix")}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                activeVariantTab === "matrix"
                  ? "border-neutral-900 text-neutral-900 bg-white"
                  : "border-transparent text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Possible Matrix
            </button>
          </div>

          {/* ── Tab: Current Variants ── */}
          {activeVariantTab === "current" && (
            <div className="p-4 space-y-3">
              {variantRows.length === 0 ? (
                <div className="py-10 text-center text-xs text-neutral-400 italic">
                  No variants configured for this product.
                </div>
              ) : (
                <>
                  {variantRows.map((r) => {
                    const isDeleting = deletingVariantId === r.id;
                    return (
                      <div
                        key={r.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          isDeleting
                            ? "border-red-200 bg-red-50/40"
                            : "border-neutral-200 bg-neutral-50/50 hover:bg-white"
                        }`}
                      >
                        {/* Variant name + badge */}
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-neutral-900">
                              {r.displayName}
                            </span>
                            {r.automationTier !== "—" && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                {r.automationTier}
                              </span>
                            )}
                            {r.surfaceFinish !== "—" && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-neutral-100 text-neutral-600 border border-neutral-200">
                                {r.surfaceFinish}
                              </span>
                            )}
                          </div>
                          {/* Delete button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteVariant(r.id, r.displayName)}
                            disabled={savingVariants || deletingVariantId !== null}
                            title={`Delete ${r.displayName}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-red-500 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        </div>

                        {/* Code + Price row */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                              Variant Code / SKU
                            </label>
                            <Input
                              type="text"
                              value={r.variantCode}
                              onChange={(e) => handleVariantCodeChange(r.id, e.target.value)}
                              placeholder="e.g. TAC-001"
                              className="h-8 font-mono text-xs uppercase"
                              disabled={isDeleting || savingVariants}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                              Price (₹) <span className="text-red-400">*</span>
                            </label>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs select-none">
                                ₹
                              </span>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={r.price}
                                onChange={(e) => handleVariantPriceChange(r.id, e.target.value)}
                                placeholder="0"
                                disabled={isDeleting || savingVariants}
                                className={`h-8 pl-6 text-right font-semibold text-xs ${
                                  r.hasPriceError
                                    ? "border-red-400 focus:border-red-400 focus:ring-red-200"
                                    : ""
                                }`}
                              />
                            </div>
                            {r.hasPriceError && (
                              <p className="text-[10px] text-red-600">
                                Valid price ≥ 0 required
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Save variants button */}
                  <div className="flex items-center justify-between pt-1 border-t border-neutral-100">
                    <p className="text-[11px] text-neutral-400">
                      Delete is immediate. Save updates Code &amp; Price for all variants.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveVariants}
                      disabled={savingVariants || deletingVariantId !== null || variantRows.length === 0}
                      className="gap-1.5 shrink-0"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {savingVariants ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Tab: Possible Matrix ── */}
          {activeVariantTab === "matrix" && (
            <div className="p-4">
              {!variantMatrix || !variantMatrix.hasMatrix ? (
                <div className="p-4 rounded-lg bg-amber-50/60 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2">
                  <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">No matrix configured for this category.</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      The selected category has no automation tiers or surface finishes defined.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[11px] text-neutral-500">
                    These are all valid combinations for <strong>{selectedCategory?.name ?? "this category"}</strong>.
                    Greyed combinations are not currently on this product.
                  </p>
                  <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-neutral-900 text-white text-[10px] font-semibold">
                          <th className="py-2.5 px-3 text-left">#</th>
                          <th className="py-2.5 px-3 text-left">Combination</th>
                          {variantMatrix.hasAutomationTiers && (
                            <th className="py-2.5 px-3 text-left">Automation</th>
                          )}
                          {variantMatrix.hasSurfaceFinishes && (
                            <th className="py-2.5 px-3 text-left">Finish</th>
                          )}
                          <th className="py-2.5 px-3 text-center">On Product</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {variantMatrix.combinations.map((comb, idx) => {
                          const existsOnProduct = variantRows.some(
                            (r) =>
                              (r.automationTier.toLowerCase() === (comb.automationTier ?? "").toLowerCase() ||
                                (r.automationTier === "—" && !comb.automationTier)) &&
                              (r.surfaceFinish.toLowerCase() === (comb.surfaceFinish ?? "").toLowerCase() ||
                                (r.surfaceFinish === "—" && !comb.surfaceFinish))
                          );
                          return (
                            <tr
                              key={`${comb.automationTier ?? ""}::${comb.surfaceFinish ?? ""}`}
                              className={existsOnProduct ? "bg-white" : "bg-neutral-50/60 opacity-50"}
                            >
                              <td className="py-2 px-3 text-neutral-400 font-mono">{idx + 1}</td>
                              <td className="py-2 px-3 font-medium text-neutral-900">
                                {comb.displayName}
                              </td>
                              {variantMatrix.hasAutomationTiers && (
                                <td className="py-2 px-3">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                    {comb.tierLabel ?? comb.automationTier ?? "—"}
                                  </span>
                                </td>
                              )}
                              {variantMatrix.hasSurfaceFinishes && (
                                <td className="py-2 px-3">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                    {comb.finishLabel ?? comb.surfaceFinish ?? "—"}
                                  </span>
                                </td>
                              )}
                              <td className="py-2 px-3 text-center">
                                {existsOnProduct ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    ✓ Active
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-neutral-400 italic">Not added</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="px-3 py-2 bg-neutral-50 border-t border-neutral-100 text-[10px] text-neutral-400">
                      {variantRows.length} of {variantMatrix.totalCombinations} combinations active on this product
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* SECTION 2b: EDITABLE VARIANT CONFIGURATION MATRIX (CREATE ONLY) */}
      {/* ============================================================== */}
      {!isEdit && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-200/80 pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                Variant Configuration
              </h3>
            </div>
            {selectedCategory && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-neutral-600">
                  Category: <strong>{selectedCategory.name}</strong>
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                    editableRows.length > 0
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-red-50 text-red-700 border-red-200"
                  }`}
                >
                  {editableRows.length} {editableRows.length === 1 ? "Variant" : "Variants"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAutoCodeAll}
                  disabled={missingCodeCount === 0}
                  className="h-7 px-2.5 text-[11px] font-semibold"
                  title="Generate a code for every row that is still empty"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Auto-fill codes
                  {missingCodeCount > 0 && (
                    <span className="ml-0.5 text-neutral-500">({missingCodeCount})</span>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* No category selected */}
          {!selectedCategory ? (
            <div className="p-4 rounded-lg bg-white border border-neutral-200 text-center">
              <p className="text-xs text-neutral-500 font-medium">
                Select a Category above to load the Variant Configuration matrix.
              </p>
            </div>

          ) : !variantMatrix || !variantMatrix.hasMatrix ? (
            // Category has no matrix
            <div className="p-4 rounded-lg bg-amber-50/60 border border-amber-200/80 text-amber-900 text-xs space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <Info className="h-4 w-4 text-amber-600 shrink-0" />
                No variant matrix is configured for this category.
              </p>
              <p className="text-amber-700/90 pl-5 text-[11px]">
                This category has no automation tiers or surface finishes. The product will be created with no variants.
              </p>
            </div>

          ) : editableRows.length === 0 ? (
            // All rows removed — show validation warning
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">At least one variant configuration is required.</p>
                <p className="text-[11px] text-red-600 mt-0.5">
                  You have removed all variant rows. Please change the category or re-add a combination before saving.
                </p>
              </div>
            </div>

          ) : (
            // Editable variant table
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden shadow-2xs">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-neutral-900 text-white text-[11px] font-semibold">
                    <th className="py-2.5 px-3 text-left w-6 text-neutral-400">#</th>
                    <th className="py-2.5 px-3 text-left">Variant</th>
                    {variantMatrix.hasAutomationTiers && (
                      <th className="py-2.5 px-3 text-left">Automation</th>
                    )}
                    {variantMatrix.hasSurfaceFinishes && (
                      <th className="py-2.5 px-3 text-left">Finish</th>
                    )}
                    <th className="py-2.5 px-3 text-left">
                      Variant Code / SKU
                    </th>
                    <th className="py-2.5 px-3 text-left">
                      Price (₹) <span className="text-red-400">*</span>
                    </th>
                    <th className="py-2.5 px-3 text-center w-10">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {editableRows.map((row, idx) => {
                    const priceNum = Number(row.price.trim());
                    const priceInvalid =
                      row.price.trim() !== "" &&
                      (!Number.isFinite(priceNum) || priceNum < 0);
                    // Duplicate code check
                    const codeKey = row.variantCode.trim().toLowerCase();
                    const isDuplicateCode =
                      codeKey !== "" &&
                      editableRows.some(
                        (r, i) =>
                          i !== idx &&
                          r.variantCode.trim().toLowerCase() === codeKey
                      );

                    return (
                      <tr
                        key={row.comboKey}
                        className="hover:bg-neutral-50/70 transition-colors"
                      >
                        {/* # */}
                        <td className="py-2 px-3 text-neutral-400 font-mono text-[11px]">
                          {idx + 1}
                        </td>

                        {/* Variant display name */}
                        <td className="py-2 px-3">
                          <span className="font-medium text-neutral-900">
                            {row.displayName}
                          </span>
                        </td>

                        {/* Automation Tier (read-only) */}
                        {variantMatrix.hasAutomationTiers && (
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              {row.tierLabel ?? row.automationTier ?? "—"}
                            </span>
                          </td>
                        )}

                        {/* Surface Finish (read-only) */}
                        {variantMatrix.hasSurfaceFinishes && (
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                              {row.finishLabel ?? row.surfaceFinish ?? "—"}
                            </span>
                          </td>
                        )}

                        {/* Variant Code / SKU (editable) */}
                        <td className="py-1.5 px-3">
                          <div className="relative">
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={row.variantCode}
                                onChange={(e) =>
                                  updateRow(row.comboKey, "variantCode", e.target.value)
                                }
                                placeholder="e.g. T-RE-AC"
                                className={`w-full min-w-[100px] rounded border px-2 py-1 text-xs font-mono uppercase focus:outline-none focus:ring-1 transition-colors ${
                                  isDuplicateCode
                                    ? "border-red-400 bg-red-50 text-red-700 focus:ring-red-400"
                                    : "border-neutral-200 bg-white text-neutral-900 focus:ring-blue-500 focus:border-blue-400"
                                }`}
                              />
                              {row.variantCode.trim() === "" && (
                                <button
                                  type="button"
                                  onClick={() => handleAutoCode(row.comboKey)}
                                  title="Generate a code for this row"
                                  className="shrink-0 rounded border border-neutral-200 bg-white p-1 text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-800"
                                >
                                  <Wand2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {isDuplicateCode && (
                              <p className="text-[10px] text-red-600 mt-0.5">
                                Duplicate code
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Price (editable) */}
                        <td className="py-1.5 px-3">
                          <div className="relative">
                            <div className="flex items-center">
                              <span className="text-[11px] text-neutral-500 mr-1 shrink-0">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.price}
                                onChange={(e) =>
                                  updateRow(row.comboKey, "price", e.target.value)
                                }
                                placeholder="0.00"
                                className={`w-full min-w-[80px] rounded border px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 transition-colors ${
                                  priceInvalid
                                    ? "border-red-400 bg-red-50 text-red-700 focus:ring-red-400"
                                    : row.price.trim() === ""
                                    ? "border-amber-300 bg-amber-50 focus:ring-amber-400"
                                    : "border-neutral-200 bg-white text-neutral-900 focus:ring-blue-500 focus:border-blue-400"
                                }`}
                              />
                            </div>
                            {priceInvalid && (
                              <p className="text-[10px] text-red-600 mt-0.5">
                                Invalid price
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Remove button */}
                        <td className="py-1.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => removeRow(row.comboKey)}
                            title={`Remove ${row.displayName}`}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Footer */}
              <div className="px-3 py-2 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between">
                <span className="text-[11px] text-neutral-500">
                  <span className="font-semibold text-neutral-700">{editableRows.length}</span>{" "}
                  of{" "}
                  <span className="font-semibold">{variantMatrix.totalCombinations}</span>{" "}
                  combinations selected
                </span>
                <span className="text-[10px] text-neutral-400 italic">
                  Automation &amp; Finish are read-only — defined by category matrix
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* SECTION 3: ADDITIONAL / SECONDARY INFORMATION                  */}
      {/* ============================================================== */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-4 shadow-2xs">
        <button
          type="button"
          onClick={() => setShowSecondaryInfo((prev) => !prev)}
          className="w-full flex items-center justify-between text-left focus:outline-hidden"
        >
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700">
              Additional Information
            </h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Description, Catalog Notes, Unit, Sort Order, Active Status
            </p>
          </div>
          <div className="h-6 w-6 rounded flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            {showSecondaryInfo ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </button>

        {showSecondaryInfo && (
          <div className="pt-3 border-t border-neutral-100 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Description */}
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-neutral-700">
                Description
              </label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={2}
                placeholder="Official catalog product description..."
              />
            </div>

            {/* Catalog Notes / Reference */}
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-neutral-700">
                Catalog Notes / Reference
              </label>
              <Input
                value={form.notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="e.g. Catalog: Tactus_4, Source Page: 1"
              />
            </div>

            {/* Unit */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700">
                Unit of Measure
              </label>
              <Input
                value={form.unit}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, unit: e.target.value }))
                }
                placeholder="e.g. pcs, set, meter"
              />
            </div>

            {/* Sort Order */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700 flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-neutral-500" />
                Sort Order
              </label>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    sortOrder: parseInt(e.target.value, 10) || 0,
                  }))
                }
              />
            </div>

            {/* Status Toggle */}
            <div className="md:col-span-2 rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-neutral-900">
                  Product Active Status
                </p>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  {form.isActive
                    ? "Active products appear in proposal builder & estimator."
                    : "Inactive products are archived and hidden from new quotations."}
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onChange={(checked) =>
                  setForm((prev) => ({ ...prev, isActive: checked }))
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* SECTION 4: FORM BUTTONS                                        */}
      {/* ============================================================== */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-200">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={saving}>
          {saving
            ? "Saving..."
            : isEdit
            ? "Update Product"
            : "Create Product"}
        </Button>
      </div>
    </form>
  );
}
