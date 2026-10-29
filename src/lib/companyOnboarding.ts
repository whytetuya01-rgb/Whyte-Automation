import { AdminUser, Category, Company, HouseType, Product, Quotation } from "@/models";

/**
 * The "Set up your workspace" guide for a newly approved company. Every step's status is read from the company's
 * real data (nothing to tick by hand), so the guide is always accurate. Must run inside the company's tenant
 * context (the counted collections are tenant-scoped).
 */

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  dismissed: boolean;
}

export async function getOnboardingState(companyId: number): Promise<OnboardingState> {
  const [company, categories, products, houseTypes, dealers, quotations] = await Promise.all([
    Company.findById(companyId)
      .select("name phone email address logoUrl brandColor theme documentSettings coverImageUrl onboardingDismissedAt")
      .lean<{
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        address?: string | null;
        logoUrl?: string | null;
        brandColor?: string | null;
        theme?: string | null;
        documentSettings?: Record<string, unknown> | null;
        coverImageUrl?: string | null;
        onboardingDismissedAt?: Date | null;
      } | null>(),
    Category.countDocuments({}),
    Product.countDocuments({}),
    HouseType.countDocuments({}),
    AdminUser.countDocuments({ role: "dealer" }),
    Quotation.countDocuments({}),
  ]);
  const filled = (value: string | null | undefined) => Boolean(value && value.trim());
  const steps: OnboardingStep[] = [
    {
      id: "profile",
      title: "Complete your company profile",
      description: "Name, phone, email and address appear on every quotation.",
      href: "/admin/company",
      done: filled(company?.name) && filled(company?.phone) && filled(company?.email) && filled(company?.address),
    },
    { id: "logo", title: "Upload your logo", description: "Shown in the header, the loaders and your quotations.", href: "/admin/company", done: filled(company?.logoUrl) },
    {
      id: "colours",
      title: "Choose your brand colours",
      description: "Pick a theme or your own brand colour.",
      href: "/admin/theme",
      done: filled(company?.brandColor) || (Boolean(company?.theme) && company?.theme !== "whyte-rose"),
    },
    {
      id: "document",
      title: "Personalise your quotation document",
      description: "Your website, social links, wording and cover image.",
      href: "/admin/company",
      done: Boolean(company?.documentSettings && Object.keys(company.documentSettings).length > 0) || filled(company?.coverImageUrl),
    },
    { id: "categories", title: "Add product categories", description: "Group your products, e.g. switches, curtains, locks.", href: "/admin/categories", done: categories > 0 },
    { id: "products", title: "Add your products", description: "Products with variants, prices and GST rates.", href: "/admin/products", done: products > 0 },
    { id: "premises", title: "Set up premises types", description: "E.g. 2 BHK, villa or office, with their default rooms.", href: "/admin/house-types", done: houseTypes > 0 },
    { id: "dealers", title: "Add your dealers", description: "Give your dealers their own logins.", href: "/admin/dealers", done: dealers > 0 },
    { id: "quotation", title: "Create your first quotation", description: "Everything is ready once the first quotation goes out.", href: "/admin/quotations", done: quotations > 0 },
  ];
  const completed = steps.filter((step) => step.done).length;
  return { steps, completed, total: steps.length, dismissed: Boolean(company?.onboardingDismissedAt) };
}
