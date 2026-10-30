"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import Modal from "@/components/shared/Modal";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Button, Input, Select, Switch } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError, toErrorMessage } from "@/lib/apiClient";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { SPEC_FIELD_TYPE_LABELS, SPEC_LIMITS, specKeyFromLabel, type ApplicableSpecField, type SpecField, type SpecFieldType } from "@/lib/productSpecs";
import type { Category } from "@/types";

interface Props {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}

interface Loaded {
  fields: SpecField[];
  inherited: ApplicableSpecField[];
  usage: Record<string, number>;
}

const EMPTY_FIELD: SpecField = { key: "", label: "", type: "text", unit: null, options: [], required: false, showInPicker: false, showOnPdf: false, scope: "product" };

function summary(field: SpecField): string {
  if (field.type === "select") return `${field.options.length} option${field.options.length === 1 ? "" : "s"}: ${field.options.slice(0, 3).join(", ")}${field.options.length > 3 ? "…" : ""}`;
  return field.unit ? `${SPEC_FIELD_TYPE_LABELS[field.type]} · ${field.unit}` : SPEC_FIELD_TYPE_LABELS[field.type];
}

/** One field being added or edited. */
function FieldEditor({ initial, isNew, inUse, onDone, onCancel }: { initial: SpecField; isNew: boolean; inUse: number; onDone: (field: SpecField) => void; onCancel: () => void }) {
  const [field, setField] = useState<SpecField>(initial);
  const [option, setOption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addOption = () => {
    const value = option.replace(/\s+/g, " ").trim();
    if (!value) return;
    if (value.length > SPEC_LIMITS.option) return setError(`An option must be ${SPEC_LIMITS.option} characters or fewer.`);
    if (field.options.some((existing) => existing.toLowerCase() === value.toLowerCase())) return setError(`"${value}" is already an option.`);
    if (field.options.length >= SPEC_LIMITS.options) return setError(`Up to ${SPEC_LIMITS.options} options.`);
    setField({ ...field, options: [...field.options, value] });
    setOption("");
    setError(null);
  };

  const done = () => {
    if (!field.label.trim()) return setError("Give the field a name.");
    if (field.type === "select" && field.options.length === 0) return setError("Add at least one option.");
    onDone({ ...field, label: field.label.trim(), unit: field.type === "select" ? null : field.unit?.trim() || null, options: field.type === "select" ? field.options : [] });
  };

  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4" data-testid="spec-field-editor">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Field name"
          value={field.label}
          maxLength={SPEC_LIMITS.label}
          onChange={(e) => {
            setField({ ...field, label: e.target.value });
            setError(null);
          }}
          placeholder="e.g. Load, Glass colour, Warranty"
          data-testid="spec-field-label"
        />
        <Select
          label="Type"
          value={field.type}
          onChange={(e) => setField({ ...field, type: e.target.value as SpecFieldType })}
          options={(Object.keys(SPEC_FIELD_TYPE_LABELS) as SpecFieldType[]).map((type) => ({ value: type, label: SPEC_FIELD_TYPE_LABELS[type] }))}
          disabled={!isNew && inUse > 0}
          helperText={!isNew && inUse > 0 ? `Used by ${inUse} product${inUse === 1 ? "" : "s"}: the type cannot change.` : undefined}
          ariaLabel="Field type"
        />
      </div>

      {field.type === "select" ? (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label="Options"
                value={option}
                maxLength={SPEC_LIMITS.option}
                onChange={(e) => {
                  setOption(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOption();
                  }
                }}
                placeholder="Type an option and press Enter"
                data-testid="spec-option-input"
              />
            </div>
            <Button type="button" variant="secondary" leftIcon={<Plus size={14} />} onClick={addOption} data-testid="spec-option-add">
              Add
            </Button>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Options">
            {field.options.map((value) => (
              <li key={value} className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white py-0.5 pl-2.5 pr-1 text-xs font-medium text-neutral-800">
                {value}
                <button
                  type="button"
                  onClick={() => setField({ ...field, options: field.options.filter((existing) => existing !== value) })}
                  aria-label={`Remove option ${value}`}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Input
          label="Unit (optional)"
          value={field.unit ?? ""}
          maxLength={SPEC_LIMITS.unit}
          onChange={(e) => setField({ ...field, unit: e.target.value })}
          placeholder={field.type === "number" ? "e.g. A, W, mm" : "e.g. years"}
          className="sm:max-w-[12rem]"
          data-testid="spec-field-unit"
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Switch size="sm" checked={field.required} onChange={(checked) => setField({ ...field, required: checked })} label="Required" />
        <Switch size="sm" checked={field.showInPicker} onChange={(checked) => setField({ ...field, showInPicker: checked })} label="Show in product picker" />
        <Switch size="sm" checked={field.showOnPdf} onChange={(checked) => setField({ ...field, showOnPdf: checked })} label="Show on quotation PDF" />
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={done} data-testid="spec-field-done">
          {isNew ? "Add field" : "Update field"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The specification fields of one category: what every product in it (and in its sub-categories) fills in. Fields
 * are edited as a draft and saved together; inherited fields are shown for reference.
 */
export default function SpecFieldsModal({ category, onClose, onSaved }: Props) {
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fields, setFields] = useState<SpecField[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  // Keyed on the id: the page hands over a fresh category object on every refresh, which must not reload (and
  // discard) the draft.
  const categoryId = category?.id ?? null;
  useEffect(() => {
    if (categoryId === null) return;
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    setEditing(null);
    apiJson
      .get<Loaded>(`/api/categories/${categoryId}/spec-fields`)
      .then((data) => {
        if (cancelled) return;
        setLoaded(data);
        setFields(data.fields);
      })
      .catch((err: unknown) => !cancelled && setLoadError(toErrorMessage(err, "The fields could not be loaded.")));
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const usage = loaded?.usage ?? {};
  const move = (index: number, by: -1 | 1) => {
    const next = [...fields];
    const [field] = next.splice(index, 1);
    next.splice(index + by, 0, field);
    setFields(next);
  };

  const remove = async (field: SpecField) => {
    const used = usage[field.key] ?? 0;
    const ok = await confirm({
      title: `Remove "${field.label}"?`,
      message: used > 0 ? `${used} product${used === 1 ? " has" : "s have"} a value for it. The values are hidden, and dropped when each product is next saved.` : "No product has a value for it yet.",
      confirmText: "Remove field",
    });
    if (ok) setFields(fields.filter((row) => row.key !== field.key));
  };

  const save = async () => {
    if (!category) return;
    setSaving(true);
    try {
      await apiJson.put(`/api/categories/${category.id}/spec-fields`, { fields: fields.map(({ scope: _scope, ...field }) => field) });
      notify.success("Specification fields saved", `${fields.length} field${fields.length === 1 ? "" : "s"} for ${category.name}.`);
      onSaved();
      onClose();
    } catch (err: unknown) {
      notifyApiError(err, "Unable to save the fields", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const takenKeys = [...fields.map((field) => field.key), ...(loaded?.inherited ?? []).map((field) => field.key)];
  const dirty = loaded !== null && JSON.stringify(fields) !== JSON.stringify(loaded.fields);

  return (
    <Modal isOpen={category !== null} onClose={onClose} title={category ? `Specifications: ${category.name}` : "Specifications"} size="2xl">
      <div className="space-y-5" data-testid="spec-fields">
        <p className="text-sm text-neutral-600">
          Fields every product in <strong className="font-semibold text-neutral-900">{category?.name}</strong> fills in, such as load, size or glass colour. Choose which ones the product picker and the quotation PDF show.
        </p>

        {loadError ? (
          <p role="alert" className="text-sm text-red-600">{loadError}</p>
        ) : !loaded ? (
          <div className="flex justify-center py-8"><LoadingSpinner /></div>
        ) : (
          <>
            {loaded.inherited.length > 0 && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
                <span className="font-semibold text-neutral-800">Also filled in (from above):</span> {loaded.inherited.map((field) => `${field.label} (${field.categoryName ?? "parent"})`).join(", ")}
              </div>
            )}

            {fields.length === 0 && editing === null ? (
              <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500" data-testid="spec-empty">
                No fields yet. Add the details your products in this category should list.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="spec-field-list">
                {fields.map((field, index) =>
                  editing === index ? (
                    <li key={field.key}>
                      <FieldEditor
                        initial={field}
                        isNew={false}
                        inUse={usage[field.key] ?? 0}
                        onDone={(updated) => {
                          setFields(fields.map((row, i) => (i === index ? updated : row)));
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  ) : (
                    <li key={field.key} className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="spec-field-row">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900">
                          {field.label}
                          {field.required && <span className="ml-1 text-red-500" aria-label="required">*</span>}
                        </p>
                        <p className="break-words text-xs text-neutral-500">{summary(field)}</p>
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-semibold uppercase tracking-wider">
                          {field.showInPicker && <span className="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-neutral-600">Picker</span>}
                          {field.showOnPdf && <span className="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-neutral-600">PDF</span>}
                          {(usage[field.key] ?? 0) > 0 && <span className="px-1 py-0.5 normal-case tracking-normal text-neutral-500">{usage[field.key]} product{usage[field.key] === 1 ? "" : "s"}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                        {[
                          { label: `Move ${field.label} up`, icon: ArrowUp, onClick: () => move(index, -1), disabled: index === 0 },
                          { label: `Move ${field.label} down`, icon: ArrowDown, onClick: () => move(index, 1), disabled: index === fields.length - 1 },
                          { label: `Edit ${field.label}`, icon: Pencil, onClick: () => setEditing(index), disabled: editing !== null },
                          { label: `Remove ${field.label}`, icon: Trash2, onClick: () => void remove(field), disabled: editing !== null },
                        ].map(({ label, icon: Icon, onClick, disabled }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={onClick}
                            disabled={disabled || saving}
                            aria-label={label}
                            title={label}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <Icon size={15} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </li>
                  )
                )}
              </ul>
            )}

            {editing === "new" ? (
              <FieldEditor
                initial={EMPTY_FIELD}
                isNew
                inUse={0}
                onDone={(field) => {
                  setFields([...fields, { ...field, key: specKeyFromLabel(field.label, takenKeys) }]);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              editing === null &&
              fields.length < SPEC_LIMITS.fields && (
                <Button type="button" variant="secondary" leftIcon={<Plus size={14} />} onClick={() => setEditing("new")} data-testid="spec-add-field">
                  Add field
                </Button>
              )
            )}
          </>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={saving} disabled={!dirty || editing !== null} onClick={() => void save()} data-testid="spec-fields-save">
            Save fields
          </Button>
        </div>
      </div>
    </Modal>
  );
}
