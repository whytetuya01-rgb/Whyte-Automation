"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui";
import { apiJson } from "@/lib/apiClient";
import { MAX_ACCESSORIES } from "@/lib/productAccessories";

interface Option {
  id: number;
  name: string;
  code: string | null;
}

interface Props {
  /** The product being edited (it cannot be its own accessory); undefined while creating. */
  selfId?: number;
  value: number[];
  onChange: (ids: number[]) => void;
}

/** Choose the products that usually go with this one. They are only suggested on quotations, never added automatically. */
export default function AccessoryPicker({ selfId, value, onChange }: Props) {
  const [names, setNames] = useState<Map<number, Option>>(new Map());
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Option[]>([]);
  const [searching, setSearching] = useState(false);
  const requested = useRef<Set<number>>(new Set());

  // Names for the ones already chosen (a saved product only knows their ids).
  useEffect(() => {
    const missing = value.filter((id) => !requested.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requested.current.add(id));
    apiJson
      .get<Option[]>(`/api/catalog/accessory-options?ids=${missing.join(",")}`)
      .then((options) => setNames((current) => new Map([...current, ...options.map((option) => [option.id, option] as const)])))
      .catch(() => undefined);
  }, [value]);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      apiJson
        .get<Option[]>(`/api/catalog/accessory-options?search=${encodeURIComponent(term)}`)
        .then((options) => {
          setNames((current) => new Map([...current, ...options.map((option) => [option.id, option] as const)]));
          setResults(options);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const full = value.length >= MAX_ACCESSORIES;
  const choices = results.filter((option) => option.id !== selfId && !value.includes(option.id));

  return (
    <div className="space-y-3" data-testid="accessory-picker">
      <p className="text-[11px] text-neutral-500">
        Products that usually go with this one. They are suggested to whoever builds a quotation, who adds them with a click; they are never added automatically. Up to {MAX_ACCESSORIES}.
      </p>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Suggested accessories">
          {value.map((id) => {
            const option = names.get(id);
            return (
              <li key={id} data-testid="accessory-chip" className="inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-200 bg-white py-1 pl-3 pr-1 text-xs text-neutral-800 shadow-2xs">
                <span className="truncate">{option ? `${option.name}${option.code ? ` · ${option.code}` : ""}` : `Product #${id}`}</span>
                <button type="button" onClick={() => onChange(value.filter((other) => other !== id))} aria-label={`Remove ${option?.name ?? `product ${id}`}`} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-1.5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={full ? `The limit of ${MAX_ACCESSORIES} is reached` : "Search products by name or code to add"} disabled={full} data-testid="accessory-search" className="text-xs" />
        {search.trim().length >= 2 && !full && (
          <ul className="max-h-48 divide-y divide-neutral-100 overflow-y-auto rounded-xl border border-neutral-200 bg-white" data-testid="accessory-results">
            {searching && choices.length === 0 ? (
              <li className="px-3 py-2 text-xs text-neutral-500">Searching…</li>
            ) : choices.length === 0 ? (
              <li className="px-3 py-2 text-xs text-neutral-500">No other products match.</li>
            ) : (
              choices.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange([...value, option.id]);
                      setSearch("");
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-neutral-50"
                    data-testid="accessory-result"
                  >
                    <span className="min-w-0 truncate font-medium text-neutral-900">{option.name}{option.code ? <span className="ml-1 font-mono text-neutral-500">{option.code}</span> : null}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
