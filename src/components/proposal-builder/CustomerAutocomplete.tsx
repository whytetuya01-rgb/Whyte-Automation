"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  UserCheck,
  Unlink,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  Building,
  Loader2,
  CheckCircle2,
  X,
  User,
} from "lucide-react";
import type { Customer, CustomerType } from "@/types/crm";
import { CUSTOMER_TYPE_LABELS } from "@/types/crm";

interface Props {
  linkedCustomerId?: number | null;
  linkedCustomer?: Partial<Customer> | null;
  onSelectCustomer: (customer: Customer) => void;
  onUnlinkCustomer: () => void;
  disabled?: boolean;
}

export default function CustomerAutocomplete({
  linkedCustomerId,
  linkedCustomer,
  onSelectCustomer,
  onUnlinkCustomer,
  disabled = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsOpen(false);
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/crm/customers?search=${encodeURIComponent(trimmed)}&pageSize=6`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const json = await res.json();
          const items: Customer[] = json?.data?.data || json?.data || [];
          setResults(items);
          setHasSearched(true);
          setIsOpen(true);
        } else {
          setResults([]);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleSelect = (customer: Customer) => {
    onSelectCustomer(customer);
    setQuery("");
    setResults([]);
    setIsOpen(false);
    setIsChanging(false);
  };

  const handleUnlink = () => {
    onUnlinkCustomer();
    setIsChanging(false);
    setQuery("");
  };

  const isLinked = Boolean(linkedCustomerId);

  // 1. Linked State: Display Linked CRM Customer Card
  if (isLinked && !isChanging) {
    const displayName = linkedCustomer?.name || `Customer #${linkedCustomerId}`;
    const typeLabel = linkedCustomer?.customerType
      ? CUSTOMER_TYPE_LABELS[linkedCustomer.customerType as CustomerType] || linkedCustomer.customerType
      : null;

    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 sm:p-4 transition-all mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5 sm:mt-0">
              <UserCheck size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  Linked to CRM Customer
                </span>
                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200">
                  ID #{linkedCustomerId}
                </span>
                {typeLabel && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white text-gray-700 border border-emerald-200 shadow-2xs">
                    {typeLabel}
                  </span>
                )}
              </div>
              <p className="text-sm font-bold text-gray-950 mt-1">{displayName}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-600 flex-wrap">
                {linkedCustomer?.phone && (
                  <span className="flex items-center gap-1 font-mono text-[11px]">
                    <Phone size={12} className="text-gray-400" />
                    {linkedCustomer.phone}
                  </span>
                )}
                {linkedCustomer?.email && (
                  <span className="flex items-center gap-1 text-[11px]">
                    <Mail size={12} className="text-gray-400" />
                    {linkedCustomer.email}
                  </span>
                )}
                {(linkedCustomer?.siteAddress || linkedCustomer?.billingAddress) && (
                  <span className="flex items-center gap-1 text-[11px] text-gray-500">
                    <MapPin size={12} className="text-gray-400" />
                    <span className="truncate max-w-[200px]">
                      {linkedCustomer.siteAddress || linkedCustomer.billingAddress}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <button
              type="button"
              onClick={() => setIsChanging(true)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} />
              Change
            </button>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 hover:text-red-700 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <Unlink size={12} />
              Unlink
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Unlinked / Searching State
  return (
    <div ref={containerRef} className="relative mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
          <Search size={13} className="text-accent" />
          Lookup from CRM Customers (Optional)
        </label>
        {isChanging && (
          <button
            type="button"
            onClick={() => setIsChanging(false)}
            className="text-xs text-gray-500 hover:text-gray-800 underline"
          >
            Cancel change
          </button>
        )}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          disabled={disabled}
          placeholder="Search by customer name, mobile number, or email to autofill..."
          className="w-full h-11 pl-10 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition bg-white text-gray-900 placeholder:text-gray-400"
        />

        {loading ? (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-accent">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-md"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <p className="text-[11px] text-gray-400 mt-1">
        Selecting a CRM customer automatically prefills contact details, location, and sales assignments.
      </p>

      {/* Dropdown Suggestions */}
      {isOpen && (
        <div className="absolute z-30 left-0 right-0 mt-1.5 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {results.length > 0 ? (
            <div className="p-1.5">
              <div className="px-2.5 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                Matching CRM Customers ({results.length})
              </div>
              {results.map((c) => {
                const typeLabel = c.customerType
                  ? CUSTOMER_TYPE_LABELS[c.customerType] || c.customerType
                  : null;

                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelect(c)}
                    className="w-full text-left p-2.5 hover:bg-gray-50 rounded-lg transition-colors flex items-start justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 group-hover:text-accent">
                          {c.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          #{c.id}
                        </span>
                        {typeLabel && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                            {typeLabel}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        {c.phone && (
                          <span className="flex items-center gap-1 font-mono text-[11px]">
                            <Phone size={11} className="text-gray-400" />
                            {c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="flex items-center gap-1 text-[11px]">
                            <Mail size={11} className="text-gray-400" />
                            {c.email}
                          </span>
                        )}
                        {(c.siteAddress || c.billingAddress) && (
                          <span className="flex items-center gap-1 text-[11px] text-gray-400 truncate max-w-[200px]">
                            <MapPin size={11} className="text-gray-400" />
                            {c.siteAddress || c.billingAddress}
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="text-xs font-semibold text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1">
                      Select →
                    </span>
                  </button>
                );
              })}
            </div>
          ) : hasSearched && !loading ? (
            <div className="p-4 text-center">
              <p className="text-xs font-medium text-gray-600">No CRM customer found matching &quot;{query}&quot;</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                You can continue entering client details manually below.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

