"use client";

import React from "react";
import PageHeader from "@/components/admin/PageHeader";
import TemplateDesignerStudio from "@/components/templates/TemplateDesignerStudio";
import { Palette } from "lucide-react";

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotation Template Designer"
        subtitle="Design and manage multiple quotation proposal templates, layout styling, section orders, configurable product columns, custom fields, and numbering formats."
        icon={Palette}
      />

      <TemplateDesignerStudio />
    </div>
  );
}
