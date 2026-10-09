import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductRowActionsProps {
  productId: number;
  productName: string;
  isExpanded: boolean;
  onView: () => void;
  onEdit: () => void;
  onEditVariants: () => void;
  onDelete: () => void;
}

interface MenuRect {
  right: number;
  minWidth: number;
  top?: number;
  bottom?: number;
}

export default function ProductRowActions({
  productId,
  productName,
  isExpanded,
  onView,
  onEdit,
  onEditVariants,
  onDelete,
}: ProductRowActionsProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `product-actions-${productId}`;

  useEffect(() => {
    if (!isExpanded) setIsMenuOpen(false);
  }, [isExpanded]);

  // Positions the menu from the trigger's live viewport rect (fixed, portalled
  // to <body>) so it is never clipped by the card's `overflow-hidden` — only
  // the browser viewport can clip it. Right-aligned to the trigger's right
  // edge, matching the old `absolute right-0` anchor; flips above the trigger
  // when there isn't room below.
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const GAP = 6;
    const MENU_HEIGHT_ESTIMATE = 190;

    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < MENU_HEIGHT_ESTIMATE && rect.top > MENU_HEIGHT_ESTIMATE;

    setMenuRect({
      right: window.innerWidth - rect.right,
      minWidth: 176,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
    });
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    updatePosition();
  }, [isMenuOpen, updatePosition]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setIsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    const handleResize = () => updatePosition();
    // A scrolling list can't keep a stale, misplaced menu floating on screen —
    // close it, same as the rest of the app's portalled menus/dropdowns.
    const handleScroll = () => setIsMenuOpen(false);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isMenuOpen, updatePosition]);

  const buttonClass =
    "inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-all duration-150 cursor-pointer shrink-0";

  return (
    <div ref={containerRef} className="flex items-center gap-1.5 shrink-0">
      {/* Primary: View Details */}
      <button
        type="button"
        onClick={onView}
        title={`View details of ${productName}`}
        className={cn(
          buttonClass,
          "bg-neutral-900 text-white hover:bg-neutral-800 shadow-2xs"
        )}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        <span>View</span>
      </button>

      {/* Secondary: Edit Product */}
      <button
        type="button"
        onClick={onEdit}
        title={`Edit ${productName}`}
        className={cn(
          buttonClass,
          "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900 border border-neutral-200/80"
        )}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Edit</span>
      </button>

      {/* Variant Action: Edit Variants */}
      <button
        type="button"
        onClick={onEditVariants}
        title={`Edit variants of ${productName}`}
        className={cn(
          buttonClass,
          "bg-pink-50 text-pink-700 hover:bg-pink-100 border border-pink-200/60"
        )}
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden md:inline">Variants</span>
      </button>

      {/* Overflow Menu for Delete */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls={menuId}
        aria-label={`More actions for ${productName}`}
        title="More options"
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors",
          isMenuOpen && "bg-neutral-100 text-neutral-900"
        )}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Portalled to <body> with fixed positioning: never clipped by the
          product card's `overflow-hidden` (needed for its rounded corners). */}
      {isMenuOpen &&
        menuRect &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Actions for ${productName}`}
            style={{
              position: "fixed",
              right: menuRect.right,
              top: menuRect.top,
              bottom: menuRect.bottom,
              minWidth: menuRect.minWidth,
            }}
            className="z-[100] w-44 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg text-xs animate-fadeIn"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                onView();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <Eye className="h-3.5 w-3.5 text-neutral-400" />
              View Product
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5 text-neutral-400" />
              Edit Product
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                onEditVariants();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <Layers className="h-3.5 w-3.5 text-neutral-400" />
              Edit Variants
            </button>

            <div className="my-1 border-t border-neutral-100" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Product
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
