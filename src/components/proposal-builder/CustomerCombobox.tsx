"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { CheckCircle2, Loader2, Mail, MapPin, Phone, Plus, RefreshCw, Unlink, User, UserCheck, X } from "lucide-react";
import type { Customer, CustomerType } from "@/types/crm";
import { CUSTOMER_TYPE_LABELS } from "@/types/crm";

/** What the picker's lookup returns at most (one request, no paging); typing narrows the list on the server. */
const LIST_LIMIT = 100;

/** A role with no customer access at all: for it the field is a plain text box and the server is never asked. */
const ROLES_WITHOUT_CUSTOMERS = new Set(["sales_executive"]);

type CustomerLike = Pick<Customer, "id" | "name"> & Partial<Customer>;

/** The same rule the server's search uses: the typed text appears in the name, mobile number or email. */
function matchesQuery(customer: Pick<Customer, "name" | "phone" | "email">, query: string): boolean {
  const needle = query.toLowerCase();
  return [customer.name, customer.phone, customer.email].some((field) => (field ?? "").toLowerCase().includes(needle));
}

interface ComboboxProps {
  /** The client name as typed (this is the "Client / Customer Name" field itself). */
  value: string;
  onChangeText: (name: string) => void;
  /** An existing customer was picked from the list. */
  onSelect: (customer: Customer) => void;
  /** The typed name no longer belongs to the linked customer (the user is writing another name). */
  onUnlink: (reason: "edit") => void;
  linked: boolean;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * The "Client / Customer Name" field as a combobox:
 *  - opening it lists the company's customers A to Z (one request, no paging);
 *  - typing searches by name, mobile number or email;
 *  - choosing a customer links it and fills the client's details;
 *  - a name that is not in the list can simply be typed ("Use … as a new customer"): it stays as written and the
 *    customer is saved to the customer list when the quotation is saved with a phone number or email.
 *
 * Customers come from GET /api/customers/lookup: an admin sees the company's customers, a Dealer only their own. A role
 * with no customer access makes no request and gets a normal text box; if the server still refuses (403), the field
 * quietly behaves the same way. Internal ids are never shown.
 */
export default function CustomerCombobox({ value, onChangeText, onSelect, onUnlink, linked, invalid, disabled, placeholder }: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Customer[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // True once the whole customer list is in memory (it fits in one request): typing then narrows it instantly.
  const [loadedAll, setLoadedAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refused, setRefused] = useState(false);
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  // Nothing is asked until the role is known, and never for a role that has no CRM access.
  const unavailable = refused || status === "unauthenticated" || (role !== undefined && ROLES_WITHOUT_CUSTOMERS.has(role));
  const ready = status === "authenticated" && !unavailable;
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedQueryRef = useRef<string | null>(null);

  const query = value.trim();
  // Always narrowed by what is typed right now, so a list that is still on screen from before can never be picked from.
  const shownItems = useMemo(() => (query ? items.filter((item) => matchesQuery(item, query)) : items), [items, query]);
  const exactMatch = shownItems.some((item) => item.name.trim().toLowerCase() === query.toLowerCase());
  const showNewRow = query.length > 0 && !exactMatch && !unavailable;
  const rows: Array<{ kind: "new" } | { kind: "customer"; customer: Customer }> = [
    ...(showNewRow ? [{ kind: "new" as const }] : []),
    ...shownItems.map((customer) => ({ kind: "customer" as const, customer })),
  ];

  const load = useCallback(async (text: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (text) params.set("search", text);
      const response = await fetch(`/api/customers/lookup?${params.toString()}`, { signal: controller.signal, headers: { "x-skip-api-loader": "true" } });
      if (response.status === 401 || response.status === 403) {
        setRefused(true);
        setItems([]);
        return;
      }
      if (!response.ok) return;
      const json = await response.json();
      const found: Customer[] = json?.data?.items ?? [];
      setItems(found);
      setHasMore(Boolean(json?.data?.truncated));
      setLoadedAll(text === "" && !json?.data?.truncated);
      loadedQueryRef.current = text;
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") setItems([]);
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  // An empty field shows the A to Z list. When that is every customer, typing just narrows it here; only a company with
  // more customers than one request returns asks the server again, after a short pause in typing.
  useEffect(() => {
    if (!open || !ready) return;
    if (loadedQueryRef.current === query) return;
    if (loadedAll && query) return;
    const timer = setTimeout(() => void load(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, query, ready, loadedAll, load]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => setHighlight(0), [shownItems, showNewRow]);

  const choose = (row: (typeof rows)[number]) => {
    if (row.kind === "customer") onSelect(row.customer);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (unavailable) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(rows.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && open && rows[highlight]) {
      event.preventDefault();
      choose(rows[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        type="text"
        role="combobox"
        data-testid="client-name-combobox"
        aria-expanded={open && !unavailable}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? "Search a customer or type a new name"}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          if (linked) onUnlink("edit");
          onChangeText(event.target.value);
          setOpen(true);
        }}
        className={`w-full h-11 pl-10 pr-10 border rounded-xl text-sm focus:outline-none focus:ring-2 transition bg-white text-gray-900 ${
          invalid ? "border-red-400 focus:ring-red-500/20" : "border-gray-200 focus:border-accent focus:ring-accent/20"
        }`}
      />
      {loading ? (
        <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-accent animate-spin" />
      ) : value && !disabled ? (
        <button
          type="button"
          aria-label="Clear name"
          onClick={() => {
            if (linked) onUnlink("edit");
            onChangeText("");
            setOpen(true);
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-md"
        >
          <X size={14} />
        </button>
      ) : null}

      {open && !unavailable && (loading || rows.length > 0 || items.length === 0) && (
        <div id={listId} role="listbox" className="absolute z-30 left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden max-h-80 overflow-y-auto">
          {rows.length === 0 && loading && <p className="p-3 text-xs text-gray-500">Loading customers…</p>}
          {rows.length === 0 && !loading && <p className="p-3 text-xs text-gray-500">No customers yet. Type a name to add the first one.</p>}
          {rows.map((row, index) =>
            row.kind === "new" ? (
              <button
                key="new"
                type="button"
                role="option"
                aria-selected={highlight === index}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(row)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm border-b border-gray-100 ${highlight === index ? "bg-accent-light/60" : "hover:bg-gray-50"}`}
              >
                <span className="w-6 h-6 rounded-lg bg-gray-950 text-white flex items-center justify-center shrink-0">
                  <Plus size={13} />
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-gray-900">Use &ldquo;{query}&rdquo; as a new customer</span>
                  <span className="block text-[11px] text-gray-500">Saved to your customer list when you add a phone number or email.</span>
                </span>
              </button>
            ) : (
              <CustomerRow key={row.customer.id} customer={row.customer} active={highlight === index} onHover={() => setHighlight(index)} onPick={() => choose(row)} />
            )
          )}
          {hasMore && (
            <p className="px-3 py-2.5 text-[11px] text-gray-500 border-t border-gray-100" data-testid="customer-list-truncated">
              Showing the first {LIST_LIMIT} customers. Type a name, mobile number or email to narrow the list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerRow({ customer, active, onHover, onPick }: { customer: Customer; active: boolean; onHover: () => void; onPick: () => void }) {
  const typeLabel = customer.customerType ? CUSTOMER_TYPE_LABELS[customer.customerType as CustomerType] || customer.customerType : null;
  const place = customer.siteAddress || customer.billingAddress;
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onPick}
      className={`w-full text-left px-3 py-2.5 transition-colors ${active ? "bg-accent-light/60" : "hover:bg-gray-50"}`}
    >
      <span className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-gray-900">{customer.name}</span>
        {typeLabel && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{typeLabel}</span>}
      </span>
      <span className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-500 flex-wrap">
        {customer.phone && (
          <span className="flex items-center gap-1 font-mono">
            <Phone size={11} className="text-gray-400" />
            {customer.phone}
          </span>
        )}
        {customer.email && (
          <span className="flex items-center gap-1">
            <Mail size={11} className="text-gray-400" />
            {customer.email}
          </span>
        )}
        {place && (
          <span className="flex items-center gap-1 truncate max-w-[220px]">
            <MapPin size={11} className="text-gray-400" />
            {place}
          </span>
        )}
      </span>
    </button>
  );
}

/** The customer this quotation is linked to. Shows who they are, never their internal id. */
export function LinkedCustomerCard({
  customer,
  onChange,
  onUnlink,
  disabled,
}: {
  customer: CustomerLike | null;
  onChange: () => void;
  onUnlink: () => void;
  disabled?: boolean;
}) {
  const typeLabel = customer?.customerType ? CUSTOMER_TYPE_LABELS[customer.customerType as CustomerType] || customer.customerType : null;
  const place = customer?.siteAddress || customer?.billingAddress;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 mb-4" data-testid="linked-customer">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <UserCheck size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                <CheckCircle2 size={13} className="text-emerald-600" />
                Existing customer
              </span>
              {typeLabel && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white text-gray-700 border border-emerald-200">{typeLabel}</span>}
            </div>
            <p className="text-sm font-bold text-gray-950 mt-1 truncate">{customer?.name || "Linked customer"}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-600 flex-wrap">
              {customer?.phone && (
                <span className="flex items-center gap-1 font-mono text-[11px]">
                  <Phone size={12} className="text-gray-400" />
                  {customer.phone}
                </span>
              )}
              {customer?.email && (
                <span className="flex items-center gap-1 text-[11px]">
                  <Mail size={12} className="text-gray-400" />
                  {customer.email}
                </span>
              )}
              {place && (
                <span className="flex items-center gap-1 text-[11px] text-gray-500">
                  <MapPin size={12} className="text-gray-400" />
                  <span className="truncate max-w-[200px]">{place}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <button type="button" onClick={onChange} disabled={disabled} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50">
            <RefreshCw size={12} />
            Change
          </button>
          <button type="button" onClick={onUnlink} disabled={disabled} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50">
            <Unlink size={12} />
            Unlink
          </button>
        </div>
      </div>
    </div>
  );
}
