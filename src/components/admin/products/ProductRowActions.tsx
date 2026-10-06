import { useEffect, useRef, useState } from "react";
import { Eye, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductRowActionsProps {
  productId: number;
  productName: string;
  /** Collapsing the row closes its overflow menu, so no orphan panel is left behind. */
  isExpanded: boolean;
  onView: () => void;
  onEdit: () => void;
  onEditVariants: () => void;
  onDelete: () => void;
}

/**
 * Row actions with an explicit hierarchy:
 *   primary     — Edit Variants (theme accent, always visible)
 *   secondary   — View / Edit (neutral, labelled from xl up)
 *   destructive — Delete (red, last in reading order)
 *
 * Below xl the secondary and destructive actions collapse into a "More" menu.
 * No action is ever removed: everything stays one click away at every width.
 */
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
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = `product-actions-${productId}`;

  useEffect(() => {
    if (!isExpanded) setIsMenuOpen(false);
  }, [isExpanded]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const buttonClass =
    "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors duration-150";
  const menuItemClass =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors duration-150";

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      {/* Primary — the action admins use most */}
      <button
        type="button"
        onClick={onEditVariants}
        title={`Edit variants of ${productName}`}
        className={cn(
          buttonClass,
          "bg-admin-primary-soft text-admin-primary-foreground ring-1 ring-inset ring-admin-primary-border",
          "hover:bg-admin-primary hover:text-white hover:ring-admin-primary"
        )}
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden lg:inline">Edit Variants</span>
        <span className="lg:hidden">Variants</span>
      </button>

      {/* Secondary — labelled once there is horizontal room */}
      <button
        type="button"
        onClick={onView}
        title={`View ${productName}`}
        className={cn(
          buttonClass,
          "hidden text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 xl:inline-flex"
        )}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        View
      </button>

      <button
        type="button"
        onClick={onEdit}
        title={`Edit ${productName}`}
        className={cn(
          buttonClass,
          "hidden text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 xl:inline-flex"
        )}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Edit
      </button>

      <button
        type="button"
        onClick={onDelete}
        title={`Delete ${productName}`}
        className={cn(buttonClass, "hidden text-red-500 hover:bg-red-50 hover:text-red-600 xl:inline-flex")}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </button>

      {/* Overflow — compact path for tablet and mobile */}
      <button
        type="button"
        onClick={() => setIsMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls={menuId}
        aria-label={`More actions for ${productName}`}
        title="More actions"
        className={cn(
          buttonClass,
          "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 xl:hidden",
          isMenuOpen && "bg-neutral-100 text-neutral-900"
        )}
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {isMenuOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Actions for ${productName}`}
          className="absolute right-0 top-full z-dropdown mt-1 w-48 animate-fadeIn rounded-xl border border-neutral-200 bg-white p-1 shadow-lg shadow-neutral-900/5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              onView();
            }}
            className={cn(menuItemClass, "text-neutral-700 hover:bg-neutral-100")}
          >
            <Eye className="h-3.5 w-3.5 text-neutral-400" aria-hidden="true" />
            View product
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              onEdit();
            }}
            className={cn(menuItemClass, "text-neutral-700 hover:bg-neutral-100")}
          >
            <Pencil className="h-3.5 w-3.5 text-neutral-400" aria-hidden="true" />
            Edit details
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              onEditVariants();
            }}
            className={cn(menuItemClass, "text-neutral-700 hover:bg-neutral-100")}
          >
            <Layers className="h-3.5 w-3.5 text-neutral-400" aria-hidden="true" />
            Edit variants
          </button>

          <div className="my-1 h-px bg-neutral-100" role="separator" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false);
              onDelete();
            }}
            className={cn(menuItemClass, "text-red-600 hover:bg-red-50")}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete product
          </button>
        </div>
      )}
    </div>
  );
}