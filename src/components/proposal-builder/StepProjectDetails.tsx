"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building, MapPin, User, Phone, Mail, FileText } from "lucide-react";
import { HouseType, Quotation } from "@/types";
import { Select, SelectOption } from "@/components/ui/Select";

interface Props {
  initialData?: Partial<Quotation>;
  houseTypes: HouseType[];
  onSaveAndContinue: (formData: ProjectFormData) => Promise<void>;
  isSaving: boolean;
}

export interface ProjectFormData {
  clientName: string;
  projectName: string;
  projectType: string;
  houseTypeId: number | null;
  location: string;
  clientPhone: string;
  clientEmail: string;
  clientGstNumber: string;
  notes: string;
}

export default function StepProjectDetails({
  initialData,
  houseTypes,
  onSaveAndContinue,
  isSaving,
}: Props) {
  // Parse any existing property name from notes or initialize
  const existingNotes = initialData?.notes ?? "";
  const matchProject = existingNotes.match(/^Project:\s*([^\n|]+)/i);
  const initialProjectName = matchProject ? matchProject[1].trim() : "";
  const cleanNotes = matchProject ? existingNotes.replace(/^Project:\s*[^\n|]+(\||\n)?/i, "").trim() : existingNotes;

  const [form, setForm] = useState<ProjectFormData>({
    clientName: initialData?.clientName ?? "",
    projectName: initialProjectName,
    projectType: initialData?.houseTypeId ? String(initialData.houseTypeId) : "",
    houseTypeId: initialData?.houseTypeId ?? null,
    location: initialData?.clientAddress ?? "",
    clientPhone: initialData?.clientPhone ?? "",
    clientEmail: initialData?.clientEmail ?? "",
    clientGstNumber: initialData?.clientGstNumber ?? "",
    notes: cleanNotes,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.clientName.trim()) {
      errs.clientName = "Client Name is required";
    }
    if (!form.location.trim()) {
      errs.location = "City / Project Location is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSaveAndContinue(form);
  };

  return (
    <div className="w-full space-y-6">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-100">
        <div>
          <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold block mb-0.5">
            Step 1 of 5
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-950 tracking-tight">
            Project & Client Details
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Enter project specifications and client contact information to initialize your proposal.
          </p>
        </div>

        <div className="flex items-center gap-2.5 bg-white px-3.5 py-2 rounded-2xl border border-gray-200 shadow-none shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gray-950 text-white flex items-center justify-center font-bold text-xs ring-2 ring-accent/30">
            01
          </div>
          <div>
            <p className="text-[10px] text-accent uppercase font-bold tracking-wider">Phase</p>
            <p className="text-xs font-bold text-gray-900 leading-tight">Project Setup</p>
          </div>
        </div>
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Form Fields (Span 8) */}
        <div className="lg:col-span-8 xl:col-span-8 2xl:col-span-8">
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-7 shadow-none">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Section: Project Overview */}
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-4 flex items-center gap-1.5">
                  <Building size={14} className="text-gray-950" />
                  Project Identity
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Client Name */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                      Client / Customer Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={form.clientName}
                        onChange={(e) => {
                          setForm({ ...form, clientName: e.target.value });
                          if (errors.clientName) setErrors({ ...errors, clientName: "" });
                        }}
                        placeholder="e.g. Mr. Rajesh Sharma"
                        className={`w-full h-11 pl-10 pr-3.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition bg-white text-gray-900 ${
                          errors.clientName
                            ? "border-red-400 focus:ring-red-500/20"
                            : "border-gray-200 focus:border-accent focus:ring-accent/20"
                        }`}
                      />
                    </div>
                    {errors.clientName && (
                      <p className="text-xs text-red-500 mt-1 font-medium">{errors.clientName}</p>
                    )}
                  </div>

                  {/* Project / Property Name */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                      Project / Property Name
                    </label>
                    <div className="relative">
                      <Building size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={form.projectName}
                        onChange={(e) => setForm({ ...form, projectName: e.target.value })}
                        placeholder="e.g. Sharma Residence, Villa 42"
                        className="w-full h-11 pl-10 pr-3.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition bg-white text-gray-900"
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Identifies this property in proposals</p>
                  </div>

                  {/* Project Type */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                      Project Type / House Type
                    </label>
                    <Select
                      value={form.houseTypeId ? String(form.houseTypeId) : (form.projectType || "")}
                      onChange={(e) => {
                        const val = e.target.value;
                        const num = Number(val);
                        const isNum = val !== "" && !isNaN(num);
                        setForm({
                          ...form,
                          houseTypeId: isNum ? num : null,
                          projectType: val,
                        });
                      }}
                      placeholder="— Select Project Type (Optional) —"
                      options={[
                        { value: "", label: "— Select Project Type (Optional) —" },
                        ...(Array.isArray(houseTypes) ? houseTypes : []).map((ht) => ({
                          value: String(ht.id),
                          label: `${ht.name}${ht.description ? ` (${ht.description})` : ""}`,
                        })),
                        { value: "residential", label: "Residential / Apartment" },
                        { value: "villa", label: "Luxury Villa" },
                        { value: "commercial", label: "Commercial / Retail" },
                        { value: "office", label: "Corporate Office" },
                        { value: "hotel", label: "Hospitality / Hotel" },
                      ]}
                      triggerClassName="h-11 rounded-xl text-sm"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Pre-populates template room presets in Step 2</p>
                  </div>

                  {/* Location / City */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                      City / Location <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={form.location}
                        onChange={(e) => {
                          setForm({ ...form, location: e.target.value });
                          if (errors.location) setErrors({ ...errors, location: "" });
                        }}
                        placeholder="e.g. Ahmedabad, Gujarat"
                        className={`w-full h-11 pl-10 pr-3.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition bg-white text-gray-900 ${
                          errors.location
                            ? "border-red-400 focus:ring-red-500/20"
                            : "border-gray-200 focus:border-accent focus:ring-accent/20"
                        }`}
                      />
                    </div>
                    {errors.location && (
                      <p className="text-xs text-red-500 mt-1 font-medium">{errors.location}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Section: Client Contact Information */}
              <div className="pt-5 border-t border-gray-100">
                <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-4 flex items-center gap-1.5">
                  <User size={14} className="text-gray-950" />
                  Contact Information
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                      Contact Phone Number
                    </label>
                    <div className="relative">
                      <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="tel"
                        value={form.clientPhone}
                        onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
                        placeholder="+91 98765 43210"
                        className="w-full h-11 pl-10 pr-3.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition bg-white text-gray-900"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="email"
                        value={form.clientEmail}
                        onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
                        placeholder="client@example.com"
                        className="w-full h-11 pl-10 pr-3.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition bg-white text-gray-900"
                      />
                    </div>
                  </div>

                  {/* Customer GSTIN */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                      Client GSTIN (Optional)
                    </label>
                    <input
                      type="text"
                      value={form.clientGstNumber}
                      onChange={(e) => setForm({ ...form, clientGstNumber: e.target.value.toUpperCase() })}
                      placeholder="24AAAAA0000A1Z5"
                      className="w-full h-11 px-3.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition bg-white text-gray-900 uppercase"
                    />
                  </div>
                </div>
              </div>

              {/* Section: Project Notes */}
              <div className="pt-5 border-t border-gray-100">
                <h3 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-4 flex items-center gap-1.5">
                  <FileText size={14} className="text-gray-950" />
                  Project Notes & Requirements
                </h3>

                <div>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={4}
                    placeholder="Specific client requirements, preferred automation ecosystem, site visit observations..."
                    className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition bg-white text-gray-900 resize-none leading-relaxed"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-6 border-t border-gray-100">
                <Link
                  href="/"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-700 font-semibold text-sm rounded-xl hover:bg-gray-50 transition"
                >
                  <ArrowLeft size={16} />
                  Back to Quotations
                </Link>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 bg-gray-950 text-white font-semibold text-sm rounded-xl hover:bg-gray-800 active:scale-[0.99] transition shadow-sm disabled:opacity-50"
                >
                  <span>{isSaving ? "Saving..." : "Save & Select Spaces"}</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Live Project Summary & Guidance Sidebar (Span 4) */}
        <div className="lg:col-span-4 xl:col-span-4 2xl:col-span-4 space-y-5 lg:sticky lg:top-20">
          {/* Card 1: Live Setup Overview */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-none space-y-4">
            <div className="pb-3 border-b border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Project Overview
              </span>
              <h4 className="text-base font-extrabold text-gray-950 truncate mt-0.5">
                {form.clientName.trim() || "Untitled Project"}
              </h4>
              <p className="text-xs text-gray-400 truncate">
                {form.projectName.trim() || "Whyte Smart Automation Proposal"}
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-400">Location</span>
                <span className="font-semibold text-gray-800">
                  {form.location.trim() || "Not specified"}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-400">Project Type</span>
                <span className="font-semibold text-gray-800">
                  {houseTypes.find((h) => h.id === form.houseTypeId)?.name ??
                    (form.projectType || "Standard")}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-400">Phone</span>
                <span className="font-mono font-medium text-gray-800">
                  {form.clientPhone.trim() || "—"}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-gray-400">Email</span>
                <span className="font-medium text-gray-800 truncate max-w-[150px]">
                  {form.clientEmail.trim() || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Proposal Workflow Roadmap */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-none space-y-3">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Quotation Flow
            </span>
            <div className="space-y-2.5">
              {[
                { step: "01", name: "Project Identity", active: true, desc: "Client & site details" },
                { step: "02", name: "Automated Spaces", active: false, desc: "Add rooms & living spaces" },
                { step: "03", name: "Product Config", active: false, desc: "Assign smart switchboards & devices" },
                { step: "04", name: "Review & Discount", active: false, desc: "Verify line items & discounts" },
                { step: "05", name: "Proposal Preview", active: false, desc: "Export professional PDF quotation" },
              ].map((item) => (
                <div
                  key={item.step}
                  className={`flex items-start gap-3 p-2.5 rounded-xl border transition ${
                    item.active
                      ? "bg-gray-950 text-white border-gray-950"
                      : "bg-gray-50/60 text-gray-600 border-gray-100"
                  }`}
                >
                  <span
                    className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${
                      item.active ? "bg-white/20 text-white" : "bg-gray-200/70 text-gray-700"
                    }`}
                  >
                    {item.step}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-xs font-bold ${item.active ? "text-white" : "text-gray-900"}`}>
                      {item.name}
                    </p>
                    <p className={`text-[11px] ${item.active ? "text-gray-300" : "text-gray-400"}`}>
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
