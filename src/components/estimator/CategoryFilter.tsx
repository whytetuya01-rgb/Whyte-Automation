"use client";
import { Category } from "@/types";
import { useMemo } from "react";
import { Select } from "@/components/ui/Select";

interface Props {
  categories: Category[];
  l1Id: number | null;
  l2Id: number | null;
  l3Id: number | null;
  onL1Change: (id: number | null) => void;
  onL2Change: (id: number | null) => void;
  onL3Change: (id: number | null) => void;
}

export default function CategoryFilter({ categories, l1Id, l2Id, l3Id, onL1Change, onL2Change, onL3Change }: Props) {
  const l1Cats = categories; // Already top-level

  const l2Cats = useMemo(() => {
    if (!l1Id) return [];
    const l1 = l1Cats.find((c) => c.id === l1Id);
    return l1?.children ?? [];
  }, [l1Cats, l1Id]);

  const l3Cats = useMemo(() => {
    if (!l2Id) return [];
    const l2 = l2Cats.find((c) => c.id === l2Id);
    return l2?.children ?? [];
  }, [l2Cats, l2Id]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:flex gap-2 md:gap-3 w-full">
      <div className={`${l2Cats.length > 0 ? "col-span-1" : "col-span-2"} sm:col-span-1 flex-1`}>
        <Select
          value={l1Id ? String(l1Id) : ""}
          onChange={(e) => onL1Change(e.target.value ? Number(e.target.value) : null)}
          triggerClassName="h-10 rounded-xl text-xs md:text-sm border-gray-200"
          options={[
            { value: "", label: "All Series" },
            ...l1Cats.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />
      </div>

      {l2Cats.length > 0 && (
        <div className="col-span-1 flex-1">
          <Select
            value={l2Id ? String(l2Id) : ""}
            onChange={(e) => onL2Change(e.target.value ? Number(e.target.value) : null)}
            triggerClassName="h-10 rounded-xl text-xs md:text-sm border-gray-200"
            options={[
              { value: "", label: "All Tech" },
              ...l2Cats.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
        </div>
      )}

      {l3Cats.length > 0 && (
        <div className="col-span-2 sm:col-span-1 flex-1">
          <Select
            value={l3Id ? String(l3Id) : ""}
            onChange={(e) => onL3Change(e.target.value ? Number(e.target.value) : null)}
            triggerClassName="h-10 rounded-xl text-xs md:text-sm border-gray-200"
            options={[
              { value: "", label: "All Material" },
              ...l3Cats.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
        </div>
      )}
    </div>
  );
}
