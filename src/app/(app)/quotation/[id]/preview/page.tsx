"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import StepProposalPreview from "@/components/proposal-builder/StepProposalPreview";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { Quotation, Company } from "@/types";

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/quotations/${id}`).then((r) => r.json()),
      fetch("/api/company").then((r) => r.json()),
    ])
      .then(([q, c]) => {
        setQuotation(q);
        setCompany(c);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!quotation || (quotation as any).error) {
    return (
      <div className="text-center py-20 text-gray-500 font-medium">
        Quotation not found.
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-2">
      <StepProposalPreview quotation={quotation} company={company} />
    </div>
  );
}
