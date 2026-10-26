"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import notify from "@/lib/notify";
import { MAX_SPACE_NAME_LENGTH, validateSpaceName } from "@/lib/spaceName";

interface RoomNameEditorProps {
  roomId: number;
  /** The space's current display name (custom name, or the room type's name). */
  name: string;
  /** Floor label to show after the name; `null` for flats and rooms without a floor. */
  floorLabel: string | null;
  /** Persists the new quotation-specific name; must throw when saving fails. */
  onRename?: (roomId: number, customName: string) => Promise<void>;
  /** Locked quotations (approved/delivered) cannot be renamed. */
  disabled?: boolean;
  /** `true` renders the name in the large heading style. */
  prominent?: boolean;
  className?: string;
}

/**
 * Inline rename for one quotation space. It only ever writes `customName` on this quotation's room record through
 * `onRename` — the global room type, templates and every other quotation are never touched.
 */
export default function RoomNameEditor({
  roomId,
  name,
  floorLabel,
  onRename,
  disabled = false,
  prominent = false,
  className = "",
}: RoomNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const canRename = Boolean(onRename) && !disabled;

  const start = () => {
    setValue(name);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    if (savingRef.current) return;
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (savingRef.current || !onRename) return;
    const checked = validateSpaceName(value);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    if (checked.value === name) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onRename(roomId, checked.value);
      notify.success(`Renamed space to "${checked.value}"`);
      setEditing(false);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to rename space");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <form
        className={`flex flex-col gap-1 ${className}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={value}
            maxLength={MAX_SPACE_NAME_LENGTH + 1}
            disabled={saving}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            aria-label="Space name"
            aria-invalid={error ? true : undefined}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-950 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={saving}
            aria-label="Save space name"
            title="Save"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-950 text-white transition hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            aria-label="Cancel renaming"
            title="Cancel"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-60"
          >
            <X size={14} />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-[11px] font-medium text-red-600">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
      <span className={prominent ? "text-sm font-extrabold text-gray-950" : "font-bold text-gray-950"}>{name}</span>
      {floorLabel && <span className="text-xs font-normal text-gray-400">· {floorLabel}</span>}
      {canRename && (
        <button
          type="button"
          onClick={start}
          aria-label={`Rename ${name}`}
          title="Rename this space"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Pencil size={12} />
        </button>
      )}
    </span>
  );
}
