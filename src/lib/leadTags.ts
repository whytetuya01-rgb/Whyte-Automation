/**
 * Lead tags: short free-text labels a company puts on a lead (for example "VIP", "Villa", "Architect referral").
 * Pure (no server imports) so the form, the pipeline, the API validation and the tests share one set of rules.
 */

export const MAX_LEAD_TAGS = 10;
export const MAX_LEAD_TAG_LENGTH = 24;

/** Characters a tag may not contain: control characters and angle brackets. */
export const LEAD_TAG_FORBIDDEN = /[\u0000-\u001f\u007f<>]/;

/** One tag as the person typed it, tidied: no leading "#", single spaces, trimmed. */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
}

/** A list of tags tidied, empties dropped, duplicates removed ignoring case (the first spelling wins). */
export function normalizeTags(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    const tag = cleanTag(String(raw));
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export type AddTagResult = { tags: string[]; added: boolean; reason?: "empty" | "duplicate" | "too_long" | "limit" | "forbidden" };

/** Adds one tag to a list, or says why it was not added. */
export function addTag(list: readonly string[], raw: string): AddTagResult {
  const tag = cleanTag(raw);
  if (!tag) return { tags: [...list], added: false, reason: "empty" };
  if (LEAD_TAG_FORBIDDEN.test(tag)) return { tags: [...list], added: false, reason: "forbidden" };
  if (tag.length > MAX_LEAD_TAG_LENGTH) return { tags: [...list], added: false, reason: "too_long" };
  if (list.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return { tags: [...list], added: false, reason: "duplicate" };
  if (list.length >= MAX_LEAD_TAGS) return { tags: [...list], added: false, reason: "limit" };
  return { tags: [...list, tag], added: true };
}

export const ADD_TAG_MESSAGES: Record<NonNullable<AddTagResult["reason"]>, string> = {
  empty: "Type a tag first.",
  duplicate: "That tag is already added.",
  too_long: `A tag can have at most ${MAX_LEAD_TAG_LENGTH} characters.`,
  limit: `A lead can have at most ${MAX_LEAD_TAGS} tags.`,
  forbidden: "A tag cannot contain < or > characters.",
};

export interface TagTone {
  chip: string;
  dot: string;
}

/** Soft colour pairs; a tag always gets the same one (from its text, ignoring case) so it is recognisable at a glance. */
const TAG_TONES: readonly TagTone[] = [
  { chip: "border-sky-200 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
  { chip: "border-violet-200 bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  { chip: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  { chip: "border-amber-200 bg-amber-50 text-amber-900", dot: "bg-amber-500" },
  { chip: "border-rose-200 bg-rose-50 text-rose-800", dot: "bg-rose-500" },
  { chip: "border-teal-200 bg-teal-50 text-teal-800", dot: "bg-teal-500" },
  { chip: "border-indigo-200 bg-indigo-50 text-indigo-800", dot: "bg-indigo-500" },
  { chip: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800", dot: "bg-fuchsia-500" },
];

export function tagTone(tag: string): TagTone {
  let hash = 0;
  for (const char of tag.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TAG_TONES[hash % TAG_TONES.length];
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Counts tags across leads ignoring case; the spelling used most often is shown (on a tie, one with capitals over all lower case). Most used first, then A to Z. */
export function countTags(lists: ReadonlyArray<readonly string[] | null | undefined>): TagCount[] {
  const byKey = new Map<string, { spellings: Map<string, number>; count: number }>();
  for (const list of lists) {
    for (const tag of list ?? []) {
      const key = tag.toLowerCase();
      const entry = byKey.get(key) ?? { spellings: new Map<string, number>(), count: 0 };
      entry.count += 1;
      entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .map((entry) => ({ tag: [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || Number(a[0] === a[0].toLowerCase()) - Number(b[0] === b[0].toLowerCase()) || a[0].localeCompare(b[0]))[0][0], count: entry.count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
