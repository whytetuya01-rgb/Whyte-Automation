"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ADD_TAG_MESSAGES, MAX_LEAD_TAGS, MAX_LEAD_TAG_LENGTH, addTag, tagTone, type TagCount } from "@/lib/leadTags";

/** One tag as a small coloured chip. Pass `onClick` to make it a button (a filter), `onRemove` to add a remove control. */
export function TagChip({ tag, onClick, onRemove, active, size = "sm" }: { tag: string; onClick?: () => void; onRemove?: () => void; active?: boolean; size?: "xs" | "sm" }) {
  const tone = tagTone(tag);
  const base = cn(
    "inline-flex max-w-full items-center gap-1 rounded-full border font-semibold leading-none",
    size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]",
    tone.chip,
    active && "ring-2 ring-accent ring-offset-1"
  );
  const label = (
    <>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
      <span className="truncate">{tag}</span>
    </>
  );
  return (
    <span className={cn(base, onRemove && "pr-1")} data-testid="tag-chip" data-tag={tag}>
      {onClick ? (
        <button type="button" onClick={onClick} aria-pressed={active} className="inline-flex min-w-0 items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {label}
        </button>
      ) : (
        label
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag}`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full opacity-60 transition hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={10} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/** A lead's tags as a wrapped row of chips; more than `max` shows the first ones and "+N". Nothing when there are none. */
export function TagChips({ tags, max = 3, size = "xs", onTagClick, activeTag }: { tags?: readonly string[] | null; max?: number; size?: "xs" | "sm"; onTagClick?: (tag: string) => void; activeTag?: string | null }) {
  const list = tags ?? [];
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const hidden = list.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="tag-chips">
      {shown.map((tag) => (
        <TagChip key={tag} tag={tag} size={size} onClick={onTagClick ? () => onTagClick(tag) : undefined} active={Boolean(activeTag) && activeTag!.toLowerCase() === tag.toLowerCase()} />
      ))}
      {hidden > 0 && (
        <span className={cn("rounded-full border border-neutral-200 bg-neutral-50 font-semibold text-neutral-500", size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]")} title={list.slice(max).join(", ")} data-testid="tag-more">
          +{hidden}
        </span>
      )}
    </div>
  );
}

/**
 * The tag field of the lead form: type a tag and press Enter or comma to turn it into a chip, Backspace on an empty box
 * removes the last one, click a suggestion (tags already used on other leads) to add it, paste "a, b, c" to add several.
 */
export function TagInput({ value, onChange, suggestions = [], disabled, label = "Tags" }: { value: string[]; onChange: (next: string[]) => void; suggestions?: TagCount[]; disabled?: boolean; label?: string }) {
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const full = value.length >= MAX_LEAD_TAGS;

  const commit = (raw: string): boolean => {
    let next = value;
    let problem: string | null = null;
    for (const part of raw.split(/[,\n]/)) {
      if (!part.trim()) continue;
      const result = addTag(next, part);
      if (result.added) next = result.tags;
      else if (result.reason && result.reason !== "empty") problem = ADD_TAG_MESSAGES[result.reason];
    }
    if (next !== value) onChange(next);
    setMessage(problem);
    return problem === null;
  };

  const matching = useMemo(() => {
    const typed = draft.trim().toLowerCase();
    const taken = new Set(value.map((tag) => tag.toLowerCase()));
    return suggestions.filter((entry) => !taken.has(entry.tag.toLowerCase()) && (!typed || entry.tag.toLowerCase().includes(typed))).slice(0, 8);
  }, [suggestions, value, draft]);

  return (
    <div data-testid="tag-input">
      <label htmlFor={inputId} className="mb-1 flex items-center justify-between text-xs font-semibold text-neutral-700">
        <span className="inline-flex items-center gap-1.5">
          <TagIcon size={12} className="text-neutral-400" aria-hidden="true" />
          {label}
        </span>
        <span className={cn("font-medium", full ? "text-amber-600" : "text-neutral-400")} aria-live="polite">
          {value.length}/{MAX_LEAD_TAGS}
        </span>
      </label>
      <div
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border bg-white px-2.5 py-1.5 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
          message ? "border-rose-300" : "border-neutral-300",
          disabled && "opacity-60"
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <AnimatePresence initial={false}>
          {value.map((tag) => (
            <motion.span key={tag.toLowerCase()} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.16 }} className="inline-flex max-w-full">
              <TagChip tag={tag} onRemove={disabled ? undefined : () => onChange(value.filter((other) => other !== tag))} />
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          ref={inputRef}
          id={inputId}
          value={draft}
          disabled={disabled || full}
          maxLength={MAX_LEAD_TAG_LENGTH + 8}
          onChange={(event) => {
            const next = event.target.value;
            if (next.includes(",")) {
              if (commit(next)) setDraft("");
              else setDraft(next.replace(/,/g, ""));
            } else {
              setDraft(next);
              if (message) setMessage(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (draft.trim() && commit(draft)) setDraft("");
            } else if (event.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim() && commit(draft)) setDraft("");
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (/[,\n]/.test(text)) {
              event.preventDefault();
              commit(draft + text);
              setDraft("");
            }
          }}
          placeholder={full ? "Tag limit reached" : value.length ? "Add another…" : "Type a tag and press Enter, e.g. VIP, Villa"}
          aria-describedby={hintId}
          aria-invalid={message ? true : undefined}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
      </div>
      <p id={hintId} className={cn("mt-1 text-[11px]", message ? "text-rose-600" : "text-neutral-400")} role={message ? "alert" : undefined}>
        {message ?? "Enter or comma adds a tag. Backspace removes the last one."}
      </p>
      {!disabled && !full && matching.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Suggested tags" data-testid="tag-suggestions">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Used before</span>
          {matching.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              onClick={() => {
                commit(entry.tag);
                inputRef.current?.focus();
              }}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-600 transition hover:border-accent hover:bg-accent-light hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus size={10} aria-hidden="true" />
              {entry.tag}
              <span className="font-medium text-neutral-400">{entry.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
