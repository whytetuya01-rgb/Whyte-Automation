"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { Product, Category, QuotationRoom } from "@/types";
import { formatCurrency, getRoomIcon } from "@/lib/utils";
import CategoryFilter from "./CategoryFilter";
import ProductCard from "./ProductCard";
import ItemRow from "./ItemRow";
import { ShoppingBag, Search, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

interface Props {
  products: Product[];
  categories: Category[];
  activeRoom: QuotationRoom;
  allRooms: QuotationRoom[];
  onAddProduct: (productId: number) => void;
  onUpdateItem: (itemId: number, data: any) => Promise<void>;
  onUpdateRoom: (roomId: number, data: any) => Promise<void>;
  onDeleteItem: (itemId: number) => Promise<void>;
  onRefreshProducts: () => Promise<void>;
}

export default function ProductSelector({
  products,
  categories,
  activeRoom,
  allRooms,
  onAddProduct,
  onUpdateItem,
  onUpdateRoom,
  onDeleteItem,
  onRefreshProducts,
}: Props) {
  const [l1Id, setL1Id] = useState<number | null>(null);
  const [l2Id, setL2Id] = useState<number | null>(null);
  const [l3Id, setL3Id] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"products" | "items">("products");
  const [roomNotes, setRoomNotes] = useState(activeRoom.notes ?? "");
  const [roomNotesDirty, setRoomNotesDirty] = useState(false);
  const [savingRoomNotes, setSavingRoomNotes] = useState(false);
  const prevRoomNotes = useRef(activeRoom.notes ?? "");

  useEffect(() => {
    const next = activeRoom.notes ?? "";
    setRoomNotes(next);
    prevRoomNotes.current = next;
    setRoomNotesDirty(false);
  }, [activeRoom.id, activeRoom.notes]);

  /**
   * Category filter logic:
   * The API returns products with their category, and each category has the
   * full parent chain (cat.parent.parent). We filter based on the most specific
   * selection (l3 > l2 > l1). An exact match on the selected level is required.
   *
   * Category tree structure: L1 (Series) → L2 (Tech: WiFi/Zigbee) → L3 (Material: Glass/Acrylic)
   * Products are assigned to ANY level (L1 for SmartLock/VDP, L2 for Retrofit, L3 for Switch Boards)
   */
  const filteredProducts = useMemo(() => {
    let result = products;

    // Apply category filter
    if (l1Id || l2Id || l3Id) {
      result = result.filter((p) => {
        const cat = p.category;
        if (!cat) return false;

        if (l3Id) {
          // Most specific: exact L3 match
          return cat.id === l3Id;
        }
        if (l2Id) {
          // L2 match: product is exactly L2 OR L3 whose parent is this L2
          if (cat.level === 2) return cat.id === l2Id;
          if (cat.level === 3) return cat.parentId === l2Id;
          return false;
        }
        if (l1Id) {
          // L1 match: product at L1, L2 child of L1, or L3 grandchild of L1
          if (cat.level === 1) return cat.id === l1Id;
          if (cat.level === 2) return cat.parentId === l1Id;
          if (cat.level === 3) return cat.parent?.parentId === l1Id;
          return false;
        }
        return true;
      });
    }

    // Apply search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code?.toLowerCase() ?? "").includes(q) ||
          (p.description?.toLowerCase() ?? "").includes(q)
      );
    }

    return result;
  }, [products, l1Id, l2Id, l3Id, search]);

  const roomSubtotal = activeRoom.items.reduce(
    (sum, item) => sum + item.quantity * Number(item.unitPrice),
    0
  );

  const saveRoomNotes = async () => {
    const normalized = roomNotes.trim();
    const previous = prevRoomNotes.current.trim();
    if (normalized === previous) {
      setRoomNotesDirty(false);
      return;
    }

    setSavingRoomNotes(true);
    try {
      console.log("[saveRoomNotes] Saving for room:", activeRoom.id, "notes:", normalized);
      await onUpdateRoom(activeRoom.id, { notes: normalized || null });
      prevRoomNotes.current = roomNotes;
      setRoomNotesDirty(false);
      toast.success("Room note saved");
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Failed to save room note";
      console.error("[saveRoomNotes] Error:", errorMsg, e);
      toast.error(errorMsg);
      setRoomNotesDirty(true);
    } finally {
      setSavingRoomNotes(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Room Header */}
      <div className="px-4 py-3 md:px-5 md:py-4 lg:px-6 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 text-sm md:text-base lg:text-lg tracking-tight">
              {activeRoom.customName ?? activeRoom.roomType?.name ?? "Room"}
            </h2>
            <p className="text-xs md:text-sm text-gray-400">
              {activeRoom.items.length} items • {formatCurrency(roomSubtotal)}
            </p>
          </div>
          <div className="flex gap-1 md:gap-1.5 bg-gray-100 p-0.5 md:p-1 rounded-lg">
            <button
              onClick={() => setTab("products")}
              className={`px-3 py-1 md:px-3.5 md:py-1.5 rounded-md text-xs md:text-sm font-medium transition ${
                tab === "products" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
              }`}
            >
              Products
            </button>
            <button
              onClick={() => setTab("items")}
              className={`px-3 py-1 md:px-3.5 md:py-1.5 rounded-md text-xs md:text-sm font-medium transition ${
                tab === "items" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
              }`}
            >
              Items ({activeRoom.items.length})
            </button>
          </div>
        </div>
      </div>

      {tab === "products" && (
        <>
          <div className="px-3 py-3 md:px-4 md:py-3.5 border-b border-slate-100 bg-slate-50/60 flex flex-col md:flex-row gap-2.5 items-stretch md:items-center">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-xl text-xs md:text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white transition-all"
                aria-label="Search products"
              />
            </div>

            {/* Category Filter Dropdowns */}
            <div className="w-full md:w-auto md:shrink-0">
              <CategoryFilter
                categories={categories}
                l1Id={l1Id}
                l2Id={l2Id}
                l3Id={l3Id}
                onL1Change={(id) => { setL1Id(id); setL2Id(null); setL3Id(null); }}
                onL2Change={(id) => { setL2Id(id); setL3Id(null); }}
                onL3Change={setL3Id}
              />
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefreshProducts}
              className="h-10 px-3.5 inline-flex items-center justify-center gap-1.5 border border-slate-200 bg-white rounded-xl text-xs md:text-sm font-semibold text-slate-600 hover:bg-slate-50 shrink-0 transition-colors"
              title="Refresh product catalog"
              type="button"
            >
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 lg:p-6 bg-slate-50/30">
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <ShoppingBag size={32} className="mb-2 opacity-30" />
                <p className="text-sm md:text-base font-medium">No matching products</p>
                {(l1Id || l2Id || l3Id || search) && (
                  <button
                    onClick={() => { setL1Id(null); setL2Id(null); setL3Id(null); setSearch(""); }}
                    className="mt-2 text-sm text-whyte-light hover:underline"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-slate-500">
                    {filteredProducts.length} products available
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-3 md:gap-4">
                  {filteredProducts.map((p) => (
                    <ProductCard key={p.id} product={p} onAdd={() => onAddProduct(p.id)} />
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {tab === "items" && (
        <div className="flex-1 overflow-y-auto">
          {/* Room Notes (moved here) */}
          <div className="px-4 py-3 md:px-5 md:py-4 border-b border-gray-100 bg-gray-50/30">
            <p className="text-[11px] md:text-xs font-semibold text-gray-500 mb-1">Room Notes (for customer/technician)</p>
            <textarea
              value={roomNotes}
              rows={2}
              onChange={(e) => {
                setRoomNotes(e.target.value);
                setRoomNotesDirty(e.target.value !== prevRoomNotes.current);
              }}
              onBlur={saveRoomNotes}
              placeholder="e.g. Keep switch panel near entrance, maintain 4.5 ft height, avoid drilling on this wall"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-blue-200 resize-y bg-white"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] md:text-xs text-gray-450">
                {savingRoomNotes ? "Saving..." : roomNotesDirty ? "Unsaved changes" : "Saved"}
              </span>
              <button
                type="button"
                onClick={saveRoomNotes}
                disabled={savingRoomNotes || !roomNotesDirty}
                className="px-2.5 py-1 text-[11px] md:text-xs rounded-md bg-gray-100 hover:bg-gray-250 text-gray-700 disabled:opacity-50 transition font-medium"
              >
                Save Note
              </button>
            </div>
          </div>
          {activeRoom.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <p className="text-sm md:text-base">No items in this room</p>
              <button onClick={() => setTab("products")} className="mt-2 md:mt-3 text-xs md:text-sm text-whyte-light hover:underline">
                Browse Products →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {activeRoom.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  currentRoomId={activeRoom.id}
                  allRooms={allRooms}
                  onUpdate={(data) => onUpdateItem(item.id, data)}
                  onDelete={() => onDeleteItem(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
