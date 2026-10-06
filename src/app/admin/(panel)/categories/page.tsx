"use client";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
  useMemo,
} from "react";
import { Category, VariantOption } from "@/types";
import {
  Plus,
  Trash2,
  Pencil,
  FolderOpen,
  X,
  Search,
  Hash,
  Palette,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import Modal from "@/components/shared/Modal";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { useCategories, useAdminProducts } from "@/lib/swr";
import { Input, Button } from "@/components/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Tiny action‑menu for edit / delete, avoids exposing delete as a top‑level CTA
// ─────────────────────────────────────────────────────────────────────────────
function CategoryMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
        title="Actions"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-36 bg-white rounded-xl border border-neutral-200 shadow-lg py-1 text-xs">
          <button
            type="button"
            onClick={() => { setOpen(false); onEdit(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            <Pencil size={13} className="text-neutral-400" /> Edit
          </button>
          <div className="my-1 border-t border-neutral-100" />
          <button
            type="button"
            onClick={() => { setOpen(false); onDelete(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant Dimension Editor (modal form sub-component)
// ─────────────────────────────────────────────────────────────────────────────
function VariantDimensionEditor({
  label,
  description,
  items,
  onChange,
  valuePlaceholder,
  labelPlaceholder,
}: {
  label: string;
  description: string;
  items: VariantOption[];
  onChange: (items: VariantOption[]) => void;
  valuePlaceholder: string;
  labelPlaceholder: string;
}) {
  const addItem = () => onChange([...items, { value: "", label: "" }]);

  const updateItem = (index: number, field: "value" | "label", val: string) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: val };
    if (field === "label" && !next[index].value) {
      next[index].value = val.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    }
    onChange(next);
  };

  const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-neutral-800">{label}</p>
          <p className="text-[11px] text-neutral-500 mt-0.5">{description}</p>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 border border-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors shrink-0"
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-neutral-400 italic">
          No {label.toLowerCase()} configured.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-12 gap-2 px-0.5">
            <p className="col-span-4 text-[9px] font-bold text-neutral-400 uppercase tracking-wider">Value (stored)</p>
            <p className="col-span-7 text-[9px] font-bold text-neutral-400 uppercase tracking-wider">Display Label</p>
          </div>
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <div className="col-span-1 sm:col-span-4">
                <input
                  type="text"
                  value={item.value}
                  onChange={(e) => updateItem(i, "value", e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900 bg-white transition"
                  placeholder={valuePlaceholder}
                />
              </div>
              <div className="col-span-1 sm:col-span-7">
                <input
                  type="text"
                  value={item.label}
                  onChange={(e) => updateItem(i, "label", e.target.value)}
                  className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-900 bg-white transition"
                  placeholder={labelPlaceholder}
                />
              </div>
              <div className="col-span-1 sm:col-span-1 flex justify-end sm:justify-center">
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function CategoriesPage() {
  const { data: categories = [], isLoading: loadingCategories, mutate: mutateCategories } = useCategories();
  const { data: products = [], mutate: mutateProducts } = useAdminProducts();
  const loading = loadingCategories;

  // ── Add state ──────────────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addNameError, setAddNameError] = useState<string | null>(null);
  const [addTiers, setAddTiers] = useState<VariantOption[]>([]);
  const [addFinishes, setAddFinishes] = useState<VariantOption[]>([]);
  const [savingAdd, setSavingAdd] = useState(false);

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameError, setEditNameError] = useState<string | null>(null);
  const [editTiers, setEditTiers] = useState<VariantOption[]>([]);
  const [editFinishes, setEditFinishes] = useState<VariantOption[]>([]);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const confirm = useConfirm();

  const refreshAll = () => { mutateCategories(); mutateProducts(); };

  // ── Add handler ────────────────────────────────────────────────────────────
  const handleAddSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!addName.trim()) { setAddNameError("Category name is required."); return; }
    setAddNameError(null);
    const validTiers = addTiers.filter((t) => t.value.trim() && t.label.trim());
    const validFinishes = addFinishes.filter((f) => f.value.trim() && f.label.trim());
    setSavingAdd(true);
    try {
      await apiJson.post("/api/categories", {
        name: addName.trim(), level: 1, parentId: null, sortOrder: 0,
        variantTiers: validTiers, variantFinishes: validFinishes,
      });
      notify.success("Category created", "Added to catalog.");
      setShowAddModal(false); setAddName(""); setAddTiers([]); setAddFinishes([]);
      refreshAll();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to add category", "Please try again.");
    } finally { setSavingAdd(false); }
  };

  // ── Edit handlers ──────────────────────────────────────────────────────────
  const handleEditOpen = (category: Category) => {
    setEditingCategory(category);
    setEditName(category.name);
    setEditNameError(null);
    setEditTiers((category.variantTiers as VariantOption[]) ?? []);
    setEditFinishes((category.variantFinishes as VariantOption[]) ?? []);
  };

  useEffect(() => {
    if (editingCategory) {
      setTimeout(() => {
        try {
          editInputRef.current?.focus();
          const len = editInputRef.current?.value?.length ?? 0;
          editInputRef.current?.setSelectionRange(len, len);
        } catch {}
      }, 0);
    }
  }, [editingCategory]);

  const handleEditClose = useCallback(() => {
    setEditingCategory(null); setEditName(""); setEditNameError(null);
    setEditTiers([]); setEditFinishes([]); setSavingEdit(false);
  }, []);

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingCategory) return;
    if (!editName.trim()) { setEditNameError("Category name is required."); return; }
    setEditNameError(null);
    const validTiers = editTiers.filter((t) => t.value.trim() && t.label.trim());
    const validFinishes = editFinishes.filter((f) => f.value.trim() && f.label.trim());
    setSavingEdit(true);
    try {
      await apiJson.patch(`/api/categories/${editingCategory.id}`, {
        name: editName.trim(), variantTiers: validTiers, variantFinishes: validFinishes,
      });
      notify.success("Category updated", "Details saved.");
      handleEditClose(); refreshAll();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to update category", "Please try again.");
    } finally { setSavingEdit(false); }
  };

  // ── Delete handler ─────────────────────────────────────────────────────────
  const handleDelete = async (category: Category) => {
    await confirm({
      title: "Delete Category",
      message: `Are you sure you want to delete "${category.name}"?`,
      detail: "Categories with active products cannot be deleted. This action is irreversible.",
      confirmText: "Delete Category", cancelText: "Cancel", variant: "danger",
      onConfirm: async () => {
        try {
          await apiJson.delete(`/api/categories/${category.id}`);
          notify.success("Category deleted", "The category has been removed.");
          refreshAll();
        } catch (err: unknown) {
          notifyApiError(err, "Unable to delete category", "Please try again.");
        }
      },
    });
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const productCountMap = useMemo(() => {
    const map: Record<number, number> = {};
    products.forEach((p) => { if (p.categoryId) map[p.categoryId] = (map[p.categoryId] ?? 0) + 1; });
    return map;
  }, [products]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return categories;
    return categories.filter((c: Category) => c.name.toLowerCase().includes(q));
  }, [categories, searchQuery]);

  const totalTierDimensions = useMemo(
    () => categories.reduce((s, c) => s + ((c.variantTiers as VariantOption[])?.length ?? 0), 0),
    [categories]
  );
  const totalFinishDimensions = useMemo(
    () => categories.reduce((s, c) => s + ((c.variantFinishes as VariantOption[])?.length ?? 0), 0),
    [categories]
  );
  const categorizedProducts = products.filter((p) => p.categoryId !== null).length;

  const openAdd = () => {
    setAddName(""); setAddNameError(null); setAddTiers([]); setAddFinishes([]);
    setShowAddModal(true);
  };

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <LoadingSpinner />
        <p className="text-xs font-semibold text-neutral-500">Loading categories…</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 pb-16">

      {/* ── PAGE HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 tracking-tight">Categories</h1>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            Manage product categories, product lines, and variant configuration.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 active:scale-[0.98] transition-all shadow-sm shrink-0"
        >
          <Plus size={14} /> Add Category
        </button>
      </div>

      {/* ── COMPACT METRIC STRIP ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-neutral-200 divide-x divide-neutral-100 flex overflow-hidden shadow-xs">
        {[
          { label: "Categories", value: categories.length },
          { label: "Products", value: categorizedProducts },
          { label: "Tiers", value: totalTierDimensions },
          { label: "Finishes", value: totalFinishDimensions },
        ].map(({ label, value }) => (
          <div key={label} className="flex-1 flex flex-col items-center justify-center py-4 px-3 min-w-0">
            <span className="text-2xl font-bold text-neutral-900 leading-none tabular-nums">{value}</span>
            <span className="text-[11px] text-neutral-400 font-medium mt-1">{label}</span>
          </div>
        ))}
      </div>

      {/* ── SEARCH / FILTER BAR ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search categories and series…"
            className="w-full pl-8 pr-7 py-2 text-xs border border-neutral-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/8 focus:border-neutral-400 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <span className="text-xs text-neutral-400 tabular-nums shrink-0">
          {filteredCategories.length} of {categories.length} shown
        </span>
      </div>

      {/* ── CATEGORY GRID ───────────────────────────────────────────────────── */}
      {filteredCategories.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-14 text-center space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-neutral-100 mx-auto flex items-center justify-center">
            <FolderOpen className="h-6 w-6 text-neutral-400" />
          </div>
          <p className="text-sm font-semibold text-neutral-700">No categories found</p>
          <p className="text-xs text-neutral-400 max-w-xs mx-auto">
            {searchQuery
              ? `No categories matching "${searchQuery}".`
              : `Click "Add Category" above to create your first product series.`}
          </p>
          {searchQuery && (
            <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="mt-2 text-xs">
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCategories.map((cat: Category) => {
            const count = productCountMap[cat.id] ?? 0;
            const tiers = (cat.variantTiers as VariantOption[]) ?? [];
            const finishes = (cat.variantFinishes as VariantOption[]) ?? [];
            const hasTiers = tiers.length > 0;
            const hasFinishes = finishes.length > 0;
            const hasDimensions = hasTiers || hasFinishes;

            return (
              <div
                key={cat.id}
                className="group bg-white rounded-2xl border border-neutral-200 hover:border-neutral-300 hover:shadow-sm transition-all duration-150 flex flex-col"
              >
                {/* ── Card body ─────────────────────────────────────────── */}
                <div className="p-5 flex-1 space-y-4">

                  {/* Top row: name + actions */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-bold text-neutral-900 leading-tight truncate">
                        {cat.name}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-1">
                        {count > 0 ? (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="text-[12px] text-neutral-500">
                              {count} product{count !== 1 ? "s" : ""}
                            </span>
                          </>
                        ) : (
                          <span className="text-[12px] text-neutral-400">No products yet</span>
                        )}
                      </div>
                    </div>
                    <CategoryMenu
                      onEdit={() => handleEditOpen(cat)}
                      onDelete={() => handleDelete(cat)}
                    />
                  </div>

                  {/* Dimensions section */}
                  {hasDimensions ? (
                    <div className="space-y-3">
                      {hasTiers && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                              Tiers
                            </span>
                            <span className="text-[11px] font-semibold text-neutral-500 tabular-nums">
                              {tiers.length}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {tiers.map((t) => (
                              <span
                                key={t.value}
                                className="inline-block px-2 py-0.5 rounded-md bg-neutral-100 text-[11px] text-neutral-700 font-medium"
                              >
                                {t.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {hasFinishes && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                              Finishes
                            </span>
                            <span className="text-[11px] font-semibold text-neutral-500 tabular-nums">
                              {finishes.length}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {finishes.map((f) => (
                              <span
                                key={f.value}
                                className="inline-block px-2 py-0.5 rounded-md bg-neutral-100 text-[11px] text-neutral-700 font-medium"
                              >
                                {f.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12px] text-neutral-400">
                      Single-price &mdash; no variant dimensions
                    </p>
                  )}
                </div>

                {/* ── Card footer: primary action ───────────────────────── */}
                <button
                  type="button"
                  onClick={() => handleEditOpen(cat)}
                  className="flex items-center justify-between px-5 py-3 border-t border-neutral-100 text-[12px] font-semibold text-accent hover:text-accent-hover hover:bg-accent-muted transition-colors rounded-b-2xl group/footer"
                >
                  <span>Configure category</span>
                  <ChevronRight
                    size={14}
                    className="text-neutral-300 group-hover/footer:text-accent transition-colors"
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ADD MODAL ───────────────────────────────────────────────────────── */}
      <Modal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddName(""); setAddNameError(null); setAddTiers([]); setAddFinishes([]); }}
        title="Add Category / Series"
        size="lg"
      >
        <form onSubmit={handleAddSubmit} noValidate className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-800">
              Category Name <span className="text-red-500">*</span>
            </label>
            <Input
              autoFocus
              value={addName}
              onChange={(e) => { setAddName(e.target.value); if (addNameError) setAddNameError(null); }}
              placeholder="e.g. Tactus VLuxe, Retro Series"
              error={addNameError || undefined}
              className="font-medium"
            />
          </div>

          <div className="space-y-1 border-t border-neutral-100 pt-5">
            <VariantDimensionEditor
              label="Automation Tiers"
              description="Technology tiers for this series (e.g. WiFi, Zigbee). Leave empty for single-price."
              items={addTiers}
              onChange={setAddTiers}
              valuePlaceholder="e.g. wifi"
              labelPlaceholder="e.g. WiFi Smart"
            />
          </div>

          <div className="space-y-1 border-t border-neutral-100 pt-5">
            <VariantDimensionEditor
              label="Surface Finishes"
              description="Surface finish options (e.g. Glass, Acrylic). Leave empty if not applicable."
              items={addFinishes}
              onChange={setAddFinishes}
              valuePlaceholder="e.g. glass"
              labelPlaceholder="e.g. Glass Panel"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setShowAddModal(false); setAddName(""); setAddNameError(null); setAddTiers([]); setAddFinishes([]); }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={savingAdd} variant="primary">
              Add Category
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── EDIT MODAL ──────────────────────────────────────────────────────── */}
      <Modal
        isOpen={!!editingCategory}
        onClose={handleEditClose}
        title={`Edit: ${editingCategory?.name ?? ""}`}
        size="lg"
      >
        <form onSubmit={handleEditSubmit} noValidate className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-800">
              Category Name <span className="text-red-500">*</span>
            </label>
            <Input
              ref={editInputRef}
              value={editName}
              onChange={(e) => { setEditName(e.target.value); if (editNameError) setEditNameError(null); }}
              placeholder="Enter category name"
              error={editNameError || undefined}
              className="font-medium"
            />
          </div>

          <div className="space-y-1 border-t border-neutral-100 pt-5">
            <VariantDimensionEditor
              label="Automation Tiers"
              description="Technology tiers for this series. Changes apply to new products only."
              items={editTiers}
              onChange={setEditTiers}
              valuePlaceholder="e.g. wifi"
              labelPlaceholder="e.g. WiFi Smart"
            />
          </div>

          <div className="space-y-1 border-t border-neutral-100 pt-5">
            <VariantDimensionEditor
              label="Surface Finishes"
              description="Surface finish options for this series. Changes apply to new products only."
              items={editFinishes}
              onChange={setEditFinishes}
              valuePlaceholder="e.g. glass"
              labelPlaceholder="e.g. Glass Panel"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-100">
            <Button type="button" variant="outline" onClick={handleEditClose}>Cancel</Button>
            <Button type="submit" loading={savingEdit} variant="primary">Save Changes</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
