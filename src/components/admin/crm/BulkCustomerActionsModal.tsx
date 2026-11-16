"use client";

import { useState, useEffect } from "react";
import Modal from "@/components/shared/Modal";
import { Button, Input, Select } from "@/components/ui";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import type { CustomerType } from "@/types/crm";
import { CUSTOMER_TYPE_LABELS } from "@/types/crm";
import { TagChip } from "@/components/admin/crm/LeadTags";
import { Users, Tag, FolderSync, Trash2 } from "lucide-react";

export type BulkActionType = "assign" | "tag" | "updateType" | "delete" | null;

interface BulkCustomerActionsModalProps {
  action: BulkActionType;
  selectedIds: number[];
  onClose: () => void;
  onSuccess: () => void;
}

const COMMON_TAGS = ["VIP", "High Priority", "Architect", "Builder", "Follow-up", "Hot Lead", "Commercial"];

export default function BulkCustomerActionsModal({
  action,
  selectedIds,
  onClose,
  onSuccess,
}: BulkCustomerActionsModalProps) {
  const [submitting, setSubmitting] = useState(false);

  // Assign state
  const [salesList, setSalesList] = useState<Array<{ id: number; name: string }>>([]);
  const [dealersList, setDealersList] = useState<Array<{ id: number; name: string }>>([]);
  const [assignedSalesId, setAssignedSalesId] = useState("");
  const [dealerId, setDealerId] = useState("");

  // Tag state
  const [tag, setTag] = useState("");
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");

  // Type state
  const [customerType, setCustomerType] = useState<CustomerType>("individual");

  // Delete state
  const [deletionReason, setDeletionReason] = useState("Bulk archived from CRM");

  useEffect(() => {
    if (action === "assign") {
      apiJson
        .get<any>("/api/admin/users?role=sales_executive&status=active&pageSize=100")
        .then((res) => {
          const users = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data) ? res.data : [];
          setSalesList(
            users.map((u: any) => ({
              id: Number(u.id ?? u._id),
              name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
            }))
          );
        })
        .catch(() => {});

      apiJson
        .get<any>("/api/admin/dealers?status=active&pageSize=100")
        .then((res) => {
          const dealers = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data) ? res.data : [];
          setDealersList(
            dealers.map((d: any) => ({
              id: Number(d.id ?? d._id),
              name: d.companyName || d.name || d.email,
            }))
          );
        })
        .catch(() => {});
    }
  }, [action]);

  if (!action) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0) return;

    setSubmitting(true);
    try {
      if (action === "assign") {
        await apiJson.post("/api/crm/customers/bulk", {
          action: "assign",
          customerIds: selectedIds,
          assignedSalesId: assignedSalesId ? Number(assignedSalesId) : null,
          dealerId: dealerId ? Number(dealerId) : null,
        });
        notify.success("Assigned successfully", `Updated assignment for ${selectedIds.length} customer(s).`);
      } else if (action === "tag") {
        if (!tag.trim()) {
          notify.error("Tag is required", "Please enter or pick a tag.");
          setSubmitting(false);
          return;
        }
        await apiJson.post("/api/crm/customers/bulk", {
          action: "tag",
          customerIds: selectedIds,
          tag: tag.trim(),
          tagMode,
        });
        notify.success("Tags updated", `Tag "${tag.trim()}" ${tagMode === "add" ? "applied to" : "removed from"} ${selectedIds.length} customer(s).`);
      } else if (action === "updateType") {
        await apiJson.post("/api/crm/customers/bulk", {
          action: "updateType",
          customerIds: selectedIds,
          customerType,
        });
        notify.success("Category updated", `Changed type to "${CUSTOMER_TYPE_LABELS[customerType]}" for ${selectedIds.length} customer(s).`);
      } else if (action === "delete") {
        await apiJson.post("/api/crm/customers/bulk", {
          action: "delete",
          customerIds: selectedIds,
          deletionReason,
        });
        notify.success("Archived successfully", `Archived ${selectedIds.length} customer(s).`);
      }

      onSuccess();
      onClose();
    } catch (err) {
      notifyApiError(err, `Failed to perform bulk ${action}`);
    } finally {
      setSubmitting(false);
    }
  };

  const titles: Record<string, string> = {
    assign: `Reassign ${selectedIds.length} Customer(s)`,
    tag: `Manage Tags for ${selectedIds.length} Customer(s)`,
    updateType: `Change Category for ${selectedIds.length} Customer(s)`,
    delete: `Archive ${selectedIds.length} Customer(s)`,
  };

  return (
    <Modal isOpen={Boolean(action)} onClose={onClose} title={titles[action] || "Bulk Action"} size="md">
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {action === "assign" && (
          <div className="space-y-3.5">
            <p className="text-xs text-neutral-500 leading-relaxed">
              Select a dedicated Sales Executive and/or Dealer to take ownership of all {selectedIds.length} selected customers.
            </p>
            <Select
              label="Assigned Sales Executive"
              value={assignedSalesId}
              onChange={(e) => setAssignedSalesId(e.target.value)}
              options={[
                { value: "", label: "No Assigned Executive (Direct / Unassigned)" },
                ...salesList.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
            <Select
              label="Assigned Dealer / Channel Partner"
              value={dealerId}
              onChange={(e) => setDealerId(e.target.value)}
              options={[
                { value: "", label: "No Assigned Dealer" },
                ...dealersList.map((d) => ({ value: String(d.id), label: d.name })),
              ]}
            />
          </div>
        )}

        {action === "tag" && (
          <div className="space-y-3.5">
            <p className="text-xs text-neutral-500">
              Apply or remove a tag across all {selectedIds.length} selected customer records.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTagMode("add")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition ${
                  tagMode === "add"
                    ? "bg-accent/10 border-accent text-accent"
                    : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                + Add Tag
              </button>
              <button
                type="button"
                onClick={() => setTagMode("remove")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition ${
                  tagMode === "remove"
                    ? "bg-rose-50 border-rose-300 text-rose-700"
                    : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                − Remove Tag
              </button>
            </div>

            <Input
              label="Tag Name"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="e.g. VIP, Architect, Follow-up..."
              required
            />

            <div>
              <span className="block text-[11px] font-medium text-neutral-500 mb-1.5">Common Suggestions</span>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTag(t)}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium transition"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {action === "updateType" && (
          <div className="space-y-3.5">
            <p className="text-xs text-neutral-500">
              Update the customer classification category for all {selectedIds.length} selected records.
            </p>
            <Select
              label="Customer Category / Classification"
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value as CustomerType)}
              options={Object.entries(CUSTOMER_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            />
          </div>
        )}

        {action === "delete" && (
          <div className="space-y-3.5">
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-800">
              <strong className="block font-bold">Caution:</strong>
              You are about to archive <strong>{selectedIds.length}</strong> customer records. Associated quotation documents and financial records will remain preserved in historical audit trails.
            </div>
            <Input
              label="Reason for archiving (Optional)"
              value={deletionReason}
              onChange={(e) => setDeletionReason(e.target.value)}
              placeholder="e.g. Inactive contacts, duplicates, cleaned up..."
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={action === "delete" ? "danger" : "primary"}
            size="sm"
            loading={submitting}
          >
            {action === "delete" ? "Archive Selected" : "Apply Changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

