import { connectMongoDB } from "@/lib/mongodb";
import { Product, Category, Quotation } from "@/models";
import {
  Package,
  CheckCircle2,
  FolderTree,
  FileText,
  Tag,
  Home,
  DoorOpen,
  Building2,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Clock,
  Layers,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { formatDate, formatCurrency } from "@/lib/utils";
import StatusBadge from "@/components/shared/StatusBadge";
import ProductCategoryConfigCell from "@/components/admin/ProductCategoryConfigCell";
import { normalizeProducts, normalizeCategories } from "@/lib/quotationNormalization";
import { QuotationStatus, Product as IProduct, Category as ICategory } from "@/types";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  switch_board: "Switch Boards",
  accessory: "Accessories",
  curtain: "Curtain Controllers",
  smart_lock: "Smart Locks",
  vdp: "Video Door Phones",
  other: "Other Devices",
};

const TYPE_BADGES: Record<string, string> = {
  switch_board: "bg-[#FCEAF0] text-[#B83E68] border-[#F1B8C8]",
  accessory: "bg-[#F6F6F7] text-neutral-700 border-[#E5E5E7]",
  curtain: "bg-[#FCEAF0] text-[#B83E68] border-[#F1B8C8]",
  smart_lock: "bg-[#FCEAF0] text-[#B83E68] border-[#F1B8C8]",
  vdp: "bg-[#F6F6F7] text-neutral-700 border-[#E5E5E7]",
  other: "bg-[#F6F6F7] text-neutral-600 border-[#E5E5E7]",
};

function getProductDisplayPrice(p: IProduct): number {
  const activeVariants = p.variants?.filter((v) => v.isActive) ?? [];
  const prices = activeVariants.map((v) => Number(v.price)).filter((x) => Number.isFinite(x) && x > 0);
  if (prices.length > 0) return Math.min(...prices);
  if (p.variants && p.variants.length > 0 && p.variants[0].price) return Number(p.variants[0].price);
  return Number(p.price || 0);
}

export default async function DashboardPage() {
  await connectMongoDB();

  // Run all database metrics in parallel
  const [
    totalProducts,
    activeProducts,
    inactiveProducts,
    matrixProducts,
    categoryCount,
    categorySeriesCount,
    quotationCount,
    rawProducts,
    rawQuotations,
    rawCategories,
    productsByTypeRaw,
  ] = await Promise.all([
    Product.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: false }),
    Product.countDocuments({ isMatrix: true }),
    Category.countDocuments(),
    Category.countDocuments({ level: 1 }),
    Quotation.countDocuments(),
    Product.find()
      .sort({ createdAt: -1 })
      .limit(6)
      .populate({
        path: "category",
        populate: { path: "parent" },
      })
      .populate({
        path: "variants",
        options: { sort: { sortOrder: 1 } },
      }),
    Quotation.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({ path: "houseType" }),
    Category.find().lean(),
    Product.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
  ]);

  // Normalize plain JS objects for client components and server rendering
  const recentProducts: IProduct[] = normalizeProducts(
    rawProducts.map((doc: any) => (typeof doc.toObject === "function" ? doc.toObject() : doc))
  );

  const recentQuotations = rawQuotations.map((d: any) =>
    typeof d.toJSON === "function" ? d.toJSON() : d
  );

  const categories: ICategory[] = normalizeCategories(rawCategories);

  const typeBreakdown = productsByTypeRaw.map((item: any) => {
    const count = Number(item.count) || 0;
    const percent = totalProducts > 0 ? Math.round((count / totalProducts) * 100) : 0;
    return {
      type: String(item._id || "other"),
      label: TYPE_LABELS[String(item._id)] || String(item._id),
      count,
      percent,
    };
  });

  const stats = [
    {
      label: "Total Products",
      value: totalProducts,
      subtext: `${activeProducts} active in catalog`,
      icon: Package,
      href: "/admin/products",
    },
    {
      label: "Active Products",
      value: activeProducts,
      subtext:
        totalProducts > 0
          ? `${Math.round((activeProducts / totalProducts) * 100)}% active catalog ratio`
          : "Catalog empty",
      icon: CheckCircle2,
      href: "/admin/products?status=active",
    },
    {
      label: "Categories & Series",
      value: categoryCount,
      subtext: `${categorySeriesCount} series configured`,
      icon: FolderTree,
      href: "/admin/categories",
    },
    {
      label: "Generated Quotations",
      value: quotationCount,
      subtext: "Client proposals generated",
      icon: FileText,
      href: "/admin/quotations",
    },
  ];

  const quickConfigs = [
    {
      href: "/admin/categories",
      title: "Product Categories",
      desc: "Manage catalog structure, WiFi/Zigbee tiers & finishes",
      icon: Tag,
    },
    {
      href: "/admin/house-types",
      title: "House Templates",
      desc: "Default room setups (1BHK, 2BHK, 3BHK, Villas)",
      icon: Home,
    },
    {
      href: "/admin/room-types",
      title: "Room Presets",
      desc: "Standard room templates, spaces & item defaults",
      icon: DoorOpen,
    },
    {
      href: "/admin/company",
      title: "Company Profile",
      desc: "Business profile, brand logo & quotation terms",
      icon: Building2,
    },
  ];

  return (
    <div className="max-w-full space-y-6 sm:space-y-7">
      {/* ── 1. Page Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1 border-b border-[#E5E5E7]">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-7 bg-[#D85B83] rounded-full shrink-0 shadow-[0_0_8px_rgba(216,91,131,0.4)]" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
              Dashboard Overview
            </h1>
            <p className="text-[#8A8A93] text-xs sm:text-sm mt-0.5">
              Monitor products, catalog configuration, and quotation activity
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-xs text-[#B83E68] font-mono hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FCEAF0] border border-[#F1B8C8]">
            <Clock size={12} className="text-[#D85B83]" />
            <span>Live Data</span>
          </span>

          <Link
            href="/admin/products"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#111111] text-white hover:bg-[#1E1E22] transition-colors shadow-2xs cursor-pointer"
          >
            <Plus size={15} className="stroke-[2.5]" />
            <span>Add Product</span>
          </Link>
        </div>
      </div>

      {/* ── 2. Top KPI Section ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          const isPrimary = idx === 0;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className={`bg-white rounded-2xl p-4 sm:p-5 border border-[#E5E5E7] shadow-xs hover:border-[#F1B8C8] hover:shadow-sm transition-all group flex flex-col justify-between ${
                isPrimary ? "border-t-2 border-t-[#D85B83]" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-[#8A8A93] uppercase tracking-wider">
                  {stat.label}
                </span>
                <div className="w-9 h-9 rounded-xl bg-[#FFF6F8] text-[#D85B83] flex items-center justify-center border border-[#F1B8C8] group-hover:bg-[#FCEAF0] group-hover:text-[#B83E68] transition-colors shrink-0">
                  <Icon size={16} />
                </div>
              </div>
              <div>
                <p className="text-2xl sm:text-3xl font-extrabold text-[#111111] tracking-tight">
                  {stat.value}
                </p>
                <p className="text-xs text-[#8A8A93] mt-1 flex items-center justify-between">
                  <span>{stat.subtext}</span>
                  <ArrowUpRight
                    size={13}
                    className="text-[#8A8A93] group-hover:text-[#D85B83] transition-colors shrink-0 ml-1"
                  />
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* ── 3. Quick Configuration ────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-[#8A8A93] uppercase tracking-wider">
            Quick Configuration
          </h2>
          <span className="text-xs text-[#8A8A93]">Templates & Catalog Settings</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
          {quickConfigs.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="bg-white rounded-2xl p-4 border border-[#E5E5E7] shadow-xs hover:border-[#F1B8C8] hover:bg-[#FFF6F8] transition-all group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF6F8] text-[#D85B83] flex items-center justify-center border border-[#F1B8C8] group-hover:bg-[#FCEAF0] group-hover:text-[#B83E68] transition-colors shrink-0">
                        <Icon size={15} />
                      </div>
                      <span className="font-semibold text-[#111111] text-sm group-hover:text-black">
                        {link.title}
                      </span>
                    </div>
                    <ArrowUpRight
                      size={15}
                      className="text-[#8A8A93] group-hover:text-[#D85B83] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0"
                    />
                  </div>
                  <p className="text-[#8A8A93] text-xs leading-relaxed line-clamp-2">
                    {link.desc}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── 4. Middle Section: Catalog Overview & Recent Quotations ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
        {/* Left: Product & Hardware Classification Breakdown */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E5E5E7] shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#E5E5E7]">
              <div>
                <h2 className="font-bold text-[#111111] text-sm sm:text-base">
                  Hardware Distribution
                </h2>
                <p className="text-xs text-[#8A8A93] mt-0.5">
                  Breakdown by hardware classification across catalog
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#FCEAF0] text-[#B83E68] border border-[#F1B8C8] font-mono">
                {totalProducts} Items
              </span>
            </div>

            {/* Inventory Status Metric Pills */}
            <div className="grid grid-cols-3 divide-x divide-[#E5E5E7] border-b border-[#E5E5E7] bg-[#F6F6F7]/60 text-center">
              <div className="py-2.5 px-3">
                <span className="text-[10px] uppercase font-semibold text-[#8A8A93] tracking-wider block">
                  Active
                </span>
                <span className="text-sm font-bold text-[#111111] font-mono">
                  {activeProducts}
                </span>
              </div>
              <div className="py-2.5 px-3">
                <span className="text-[10px] uppercase font-semibold text-[#8A8A93] tracking-wider block">
                  Inactive
                </span>
                <span className="text-sm font-bold text-[#8A8A93] font-mono">
                  {inactiveProducts}
                </span>
              </div>
              <div className="py-2.5 px-3">
                <span className="text-[10px] uppercase font-semibold text-[#8A8A93] tracking-wider block">
                  Matrix Variants
                </span>
                <span className="text-sm font-bold text-[#111111] font-mono">
                  {matrixProducts}
                </span>
              </div>
            </div>

            {/* Classification Progress Bars */}
            <div className="p-4 sm:p-5 space-y-3.5">
              {typeBreakdown.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#8A8A93]">
                  No products classified yet
                </div>
              ) : (
                typeBreakdown.map((item, idx) => {
                  // Controlled pink/rose/charcoal palette for distribution bars
                  const barColors = [
                    "bg-[#D85B83]", // Primary Pink
                    "bg-[#B83E68]", // Deep Rose
                    "bg-[#E58AA7]", // Soft Rose
                    "bg-[#1E1E22]", // Dark Charcoal
                    "bg-[#8A8A93]", // Medium Grey
                    "bg-[#B0B0B8]", // Muted Grey
                  ];
                  const barColor = barColors[idx % barColors.length];
                  const isTop = idx < 2;

                  return (
                    <div key={item.type} className="group">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-medium text-[#111111]">{item.label}</span>
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-[#8A8A93]">{item.count} items</span>
                          <span
                            className={`w-9 text-right font-semibold ${
                              isTop ? "text-[#B83E68]" : "text-[#1E1E22]"
                            }`}
                          >
                            {item.percent}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-[#F0F0F2] rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all duration-300`}
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="p-3.5 bg-[#F6F6F7]/60 border-t border-[#E5E5E7] flex items-center justify-between text-xs text-[#8A8A93]">
            <span>Dynamic configuration active across all series</span>
            <Link
              href="/admin/products"
              className="font-semibold text-[#111111] hover:text-[#B83E68] hover:underline transition-colors inline-flex items-center gap-1"
            >
              <span>Manage Items</span>
              <ArrowRight size={13} className="text-[#D85B83]" />
            </Link>
          </div>
        </div>

        {/* Right: Recent Quotations */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E5E5E7] shadow-xs overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#E5E5E7]">
              <div>
                <h2 className="font-bold text-[#111111] text-sm sm:text-base">
                  Recent Quotations
                </h2>
                <p className="text-xs text-[#8A8A93] mt-0.5">
                  Latest client proposals generated in estimator
                </p>
              </div>
              <Link
                href="/admin/quotations"
                className="text-xs font-semibold text-[#111111] hover:text-[#B83E68] px-2.5 py-1 rounded-lg border border-[#E5E5E7] hover:border-[#F1B8C8] hover:bg-[#FFF6F8] transition-colors inline-flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowRight size={12} className="text-[#D85B83]" />
              </Link>
            </div>

            <div className="divide-y divide-[#E5E5E7]/70">
              {recentQuotations.length === 0 ? (
                <div className="py-10 px-4 text-center">
                  <div className="w-10 h-10 rounded-xl bg-[#FFF6F8] border border-[#F1B8C8] flex items-center justify-center text-[#D85B83] mx-auto mb-2">
                    <FileText size={18} />
                  </div>
                  <p className="text-xs font-semibold text-[#111111]">
                    No quotations created yet
                  </p>
                  <p className="text-[11px] text-[#8A8A93] mt-0.5 max-w-xs mx-auto">
                    New proposals generated in the quotation estimator will appear here.
                  </p>
                  <Link
                    href="/quotation/new"
                    className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#111111] text-white hover:bg-[#1E1E22] transition-colors"
                  >
                    <Plus size={13} />
                    <span>Create Proposal</span>
                  </Link>
                </div>
              ) : (
                recentQuotations.map((q) => (
                  <Link
                    key={q.id}
                    href={`/quotation/${q.id}`}
                    className="flex items-center justify-between p-3.5 hover:bg-[#FFF6F8] transition-colors gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#111111] text-xs sm:text-sm font-mono group-hover:text-[#B83E68] transition-colors">
                          {q.quotationNumber}
                        </span>
                      </div>
                      <p className="text-[#8A8A93] text-xs truncate mt-0.5">
                        {q.clientName} {q.houseType?.name ? `• ${q.houseType.name}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                      <span className="text-[#8A8A93] text-xs hidden sm:inline font-mono">
                        {formatDate(q.createdAt)}
                      </span>
                      <StatusBadge status={q.status as QuotationStatus} />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="p-3.5 bg-[#F6F6F7]/60 border-t border-[#E5E5E7] flex items-center justify-between text-xs text-[#8A8A93]">
            <span>Total Proposals: {quotationCount}</span>
            <Link
              href="/admin/quotations"
              className="font-semibold text-[#111111] hover:text-[#B83E68] hover:underline transition-colors inline-flex items-center gap-1"
            >
              <span>All Proposals</span>
              <ArrowRight size={12} className="text-[#D85B83]" />
            </Link>
          </div>
        </div>
      </div>

      {/* ── 5. Recently Added Products (Full Width Table) ──────────── */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-xs overflow-hidden">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#E5E5E7]">
          <div>
            <h2 className="font-bold text-[#111111] text-sm sm:text-base">
              Recently Added Products
            </h2>
            <p className="text-xs text-[#8A8A93] mt-0.5">
              Latest hardware catalog entries and variant configurations
            </p>
          </div>
          <Link
            href="/admin/products"
            className="text-xs font-semibold text-[#111111] hover:text-[#B83E68] px-3 py-1.5 rounded-lg border border-[#E5E5E7] hover:border-[#F1B8C8] hover:bg-[#FFF6F8] transition-colors inline-flex items-center gap-1.5"
          >
            <span>View All Products</span>
            <ArrowRight size={13} className="text-[#D85B83]" />
          </Link>
        </div>

        <div className="overflow-x-auto">
        {recentProducts.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-10 h-10 rounded-xl bg-[#FFF6F8] border border-[#F1B8C8] flex items-center justify-center text-[#D85B83] mx-auto mb-2">
              <Package size={20} />
            </div>
            <p className="text-sm font-semibold text-[#111111]">No products added yet</p>
            <p className="text-xs text-[#8A8A93] mt-0.5">
              Add your first hardware item to start populating the catalog.
            </p>
            <Link
              href="/admin/products"
              className="inline-flex items-center gap-1.5 mt-3.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#111111] text-white hover:bg-[#1E1E22] transition-colors"
            >
              <Plus size={13} />
              <span>Add Product</span>
            </Link>
          </div>
        ) : (
          <>
            {/* ── Desktop & Tablet Fixed-Layout Table (md and up) ──────── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[880px]">
                <colgroup>
                  <col className="w-[68px]" />
                  <col className="w-[24%]" />
                  <col className="w-[24%]" />
                  <col className="w-[125px]" />
                  <col className="w-[155px]" />
                  <col className="w-[105px]" />
                  <col className="w-[105px]" />
                  <col className="w-[125px]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#E5E5E7] bg-[#F6F6F7] text-[11px] font-semibold text-[#8A8A93] uppercase tracking-wider">
                    <th scope="col" className="w-[68px] px-3.5 py-3.5 text-center align-middle">
                      Image
                    </th>
                    <th scope="col" className="px-3.5 py-3.5 align-middle">
                      Product
                    </th>
                    <th scope="col" className="px-3.5 py-3.5 align-middle">
                      Configuration
                    </th>
                    <th scope="col" className="w-[125px] px-3.5 py-3.5 align-middle">
                      Code
                    </th>
                    <th scope="col" className="w-[155px] px-3.5 py-3.5 align-middle">
                      Type
                    </th>
                    <th scope="col" className="w-[105px] px-3.5 py-3.5 text-right align-middle">
                      Price
                    </th>
                    <th scope="col" className="w-[105px] px-3.5 py-3.5 text-center align-middle">
                      Status
                    </th>
                    <th scope="col" className="w-[125px] pl-3.5 pr-5 sm:pr-6 py-3.5 text-right align-middle">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E5E7]/70">
                  {recentProducts.map((p) => {
                    const typeBadgeClass =
                      TYPE_BADGES[p.type] || "bg-[#F6F6F7] text-neutral-700 border-[#E5E5E7]";
                    const typeLabel = TYPE_LABELS[p.type] || p.type;

                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-[#FFF6F8] transition-colors group"
                      >
                        {/* Image Thumbnail */}
                        <td className="px-3.5 py-3.5 text-center align-middle">
                          <Link
                            href={`/admin/products/${p.id}`}
                            className="inline-block"
                            tabIndex={-1}
                            aria-label={`View ${p.name}`}
                          >
                            {p.imageUrl ? (
                              <div className="w-11 h-11 rounded-xl border border-[#E5E5E7] bg-white p-1 flex items-center justify-center overflow-hidden group-hover:border-[#D85B83] transition-colors mx-auto">
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="w-full h-full object-contain"
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <div className="w-11 h-11 rounded-xl border border-[#E5E5E7] bg-[#F6F6F7] flex items-center justify-center text-[#8A8A93] group-hover:text-[#D85B83] transition-colors mx-auto">
                                <Package size={18} className="stroke-[1.5]" />
                              </div>
                            )}
                          </Link>
                        </td>

                        {/* Product Name & Description */}
                        <td className="px-3.5 py-3.5 align-middle overflow-hidden">
                          <Link
                            href={`/admin/products/${p.id}`}
                            className="group/product block cursor-pointer"
                            title={`View details for ${p.name}`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-[#111111] text-sm group-hover/product:text-[#B83E68] group-hover/product:underline decoration-[#D85B83]/30 underline-offset-2 transition-colors truncate block">
                                {p.name}
                              </span>
                              <ArrowRight
                                size={12}
                                className="text-[#D85B83] opacity-0 -translate-x-1 group-hover/product:opacity-100 group-hover/product:translate-x-0 transition-all shrink-0"
                              />
                            </div>
                            {p.description ? (
                              <p className="text-[#8A8A93] text-xs truncate mt-0.5 block group-hover/product:text-[#111111] transition-colors">
                                {p.description}
                              </p>
                            ) : (
                              <p className="text-[#8A8A93]/60 text-[11px] italic mt-0.5 truncate block">
                                No description provided
                              </p>
                            )}
                          </Link>
                        </td>

                        {/* Configuration Cell */}
                        <td className="px-3.5 py-3.5 align-middle overflow-hidden">
                          <ProductCategoryConfigCell product={p} categories={categories} />
                        </td>

                        {/* Code */}
                        <td className="px-3.5 py-3.5 align-middle whitespace-nowrap overflow-hidden">
                          {p.code ? (
                            <span className="font-mono text-xs font-semibold text-[#111111] bg-[#F6F6F7] px-2 py-0.5 rounded-md border border-[#E5E5E7] inline-block whitespace-nowrap truncate max-w-full">
                              {p.code}
                            </span>
                          ) : (
                            <span className="text-[#8A8A93] text-xs">—</span>
                          )}
                        </td>

                        {/* Type Badge */}
                        <td className="px-3.5 py-3.5 align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${typeBadgeClass}`}
                          >
                            {typeLabel}
                          </span>
                        </td>

                        {/* Price */}
                        <td className="px-3.5 py-3.5 text-right align-middle whitespace-nowrap">
                          <span className="text-xs font-bold text-neutral-900 font-mono whitespace-nowrap inline-flex items-center justify-end gap-1">
                            {p.isMatrix && p.variants && p.variants.length > 1 && (
                              <span className="text-[10px] text-neutral-500 font-normal">
                                From
                              </span>
                            )}
                            {formatCurrency(getProductDisplayPrice(p))}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-3.5 py-3.5 text-center align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${
                              p.isActive
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-neutral-100 text-neutral-600 border-neutral-200"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                p.isActive ? "bg-emerald-500" : "bg-neutral-400"
                              }`}
                            />
                            <span>{p.isActive ? "Active" : "Inactive"}</span>
                          </span>
                        </td>

                        {/* Created Date */}
                        <td className="pl-3.5 pr-5 sm:pr-6 py-3.5 text-right align-middle whitespace-nowrap text-xs text-neutral-500 font-mono">
                          {formatDate(p.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Mobile Responsive Card View (screens < md) ───────────── */}
            <div className="divide-y divide-[#E5E5E7]/70 md:hidden">
              {recentProducts.map((p) => {
                const typeBadgeClass =
                  TYPE_BADGES[p.type] || "bg-[#F6F6F7] text-neutral-700 border-[#E5E5E7]";
                const typeLabel = TYPE_LABELS[p.type] || p.type;

                return (
                  <div
                    key={p.id}
                    className="p-3.5 sm:p-4 space-y-2.5 hover:bg-[#FFF6F8] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Image Thumbnail */}
                      <Link
                        href={`/admin/products/${p.id}`}
                        className="shrink-0"
                        tabIndex={-1}
                        aria-label={`View ${p.name}`}
                      >
                        {p.imageUrl ? (
                          <div className="w-12 h-12 rounded-xl border border-[#E5E5E7] bg-white p-1 flex items-center justify-center overflow-hidden">
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-xl border border-[#E5E5E7] bg-[#F6F6F7] flex items-center justify-center text-[#8A8A93]">
                            <Package size={20} className="stroke-[1.5]" />
                          </div>
                        )}
                      </Link>

                      {/* Product Name, Description & Price */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <Link
                            href={`/admin/products/${p.id}`}
                            className="font-semibold text-[#111111] text-sm hover:text-[#B83E68] hover:underline truncate block"
                          >
                            {p.name}
                          </Link>
                          <span className="font-mono text-xs font-bold text-[#111111] whitespace-nowrap shrink-0">
                            {p.isMatrix && p.variants && p.variants.length > 1 && (
                              <span className="text-[10px] text-[#8A8A93] font-normal mr-1">
                                From
                              </span>
                            )}
                            {formatCurrency(getProductDisplayPrice(p))}
                          </span>
                        </div>

                        {p.description ? (
                          <p className="text-[#8A8A93] text-xs truncate mt-0.5">
                            {p.description}
                          </p>
                        ) : null}

                        {/* Configuration */}
                        <div className="mt-1.5">
                          <ProductCategoryConfigCell product={p} categories={categories} />
                        </div>
                      </div>
                    </div>

                    {/* Secondary Details: Code, Type, Status, Date */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E5E5E7] text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.code ? (
                          <span className="font-mono text-[11px] font-semibold text-[#111111] bg-[#F6F6F7] px-1.5 py-0.5 rounded border border-[#E5E5E7] whitespace-nowrap">
                            {p.code}
                          </span>
                        ) : null}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${typeBadgeClass}`}
                        >
                          {typeLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-auto">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${
                            p.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-[#F6F6F7] text-[#8A8A93] border-[#E5E5E7]"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              p.isActive ? "bg-emerald-500" : "bg-neutral-400"
                            }`}
                          />
                          <span>{p.isActive ? "Active" : "Inactive"}</span>
                        </span>
                        <span className="text-[#8A8A93] font-mono text-[11px] whitespace-nowrap">
                          {formatDate(p.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
