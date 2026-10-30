"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Compass,
  Plus,
  RefreshCw,
  Edit2,
  Check,
  X,
  Layers,
  ArrowUpDown,
} from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Modal from "@/components/shared/Modal";
import { Button, Input } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { LeadSource } from "@/types/crm";

export default function LeadSourcesPage() {
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<LeadSource | null>(null);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson.get<LeadSource[]>("/api/crm/sources");
      if (Array.isArray(res)) {
        setSources(res);
      }
    } catch (err) {
      notifyApiError(err, "Failed to load lead sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleOpenModal = (source?: LeadSource) => {
    if (source) {
      setEditingSource(source);
      setName(source.name);
      setSortOrder(source.sortOrder);
    } else {
      setEditingSource(null);
      setName("");
      setSortOrder(sources.length + 1);
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      if (editingSource) {
        await apiJson.patch(`/api/crm/sources?id=${editingSource.id}`, {
          name: name.trim(),
          sortOrder: Number(sortOrder),
        });
        notify.success("Source updated", `Lead source "${name}" updated.`);
      } else {
        await apiJson.post("/api/crm/sources", {
          name: name.trim(),
          sortOrder: Number(sortOrder),
        });
        notify.success("Source created", `Lead source "${name}" added.`);
      }

      setModalOpen(false);
      fetchSources();
    } catch (err) {
      notifyApiError(err, "Failed to save lead source");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (source: LeadSource) => {
    try {
      await apiJson.patch(`/api/crm/sources?id=${source.id}`, {
        isActive: !source.isActive,
      });
      notify.success(
        source.isActive ? "Source disabled" : "Source enabled",
        `"${source.name}" is now ${source.isActive ? "hidden" : "active"} in lead creation.`
      );
      fetchSources();
    } catch (err) {
      notifyApiError(err, "Failed to update source status");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lead Sources Management"
        subtitle="Manage acquisition channels, marketing attribution, and referral partners"
        icon={Compass}
        actions={
          <Button type="button" variant="primary" size="sm" onClick={() => handleOpenModal()}>
            <Plus size={15} className="mr-1" />
            <span>New Lead Source</span>
          </Button>
        }
      />

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center items-center">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50/80 text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Order</th>
                  <th className="py-3 px-4">Source Name</th>
                  <th className="py-3 px-4">Default Channel</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sources.map((s) => (
                  <tr key={s.id} className="hover:bg-neutral-50/80 transition">
                    <td className="py-3.5 px-4 font-mono font-medium text-neutral-500">
                      {s.sortOrder}
                    </td>

                    <td className="py-3.5 px-4 font-bold text-neutral-900 text-sm">
                      {s.name}
                    </td>

                    <td className="py-3.5 px-4">
                      {s.isDefault ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-100 text-neutral-600">
                          System Default
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-accent-light text-accent">
                          Custom
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(s)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition cursor-pointer ${
                          s.isActive
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-neutral-100 text-neutral-500 border border-neutral-200"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${s.isActive ? "bg-emerald-500" : "bg-neutral-400"}`} />
                        <span>{s.isActive ? "Active" : "Disabled"}</span>
                      </button>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenModal(s)}
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition"
                        title="Edit Source"
                      >
                        <Edit2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingSource ? `Edit Source — ${editingSource.name}` : "New Lead Source"}
        size="sm"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Source Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Architect Referral or LinkedIn Campaign"
            className="text-sm"
          />

          <Input
            label="Display Sort Order"
            type="number"
            min="0"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="text-sm"
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              {editingSource ? "Save Changes" : "Create Source"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
