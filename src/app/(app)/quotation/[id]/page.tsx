import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, Category, RoomType, HouseType, Company } from "@/models";
import ProposalBuilder from "@/components/proposal-builder/ProposalBuilder";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ProposalStep } from "@/components/proposal-builder/StepIndicator";
import {
  normalizeQuotation,
  normalizeCategories,
  normalizeRoomTypes,
  normalizeHouseTypes,
  serializeQuotationForClient,
} from "@/lib/quotationNormalization";
import { attachQuotationActors } from "@/lib/quotationActors";
import { canViewQuotation } from "@/lib/quotationAccess";
import { getEditorCatalog } from "@/lib/editorCatalog";
import { redactQuotationForRole } from "@/lib/variantRedaction";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
};

export default async function QuotationPage(props: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const { id } = await props.params;
  const searchParams = await props.searchParams;

  await connectMongoDB();

  const [qDoc, htDocs, products, cDocs, rtDocs, compDoc] = await Promise.all([
    Quotation.findById(id)
      .populate({ path: "houseType" })
      .populate({ path: "dealer", select: "id name email firstName lastName contactNumber companyName gstNumber address" })
      .populate({
        path: "rooms",
        options: { sort: { sortOrder: 1 } },
        populate: [
          { path: "roomType" },
          {
            path: "items",
            options: { sort: { sortOrder: 1 } },
            // Only the fields the editor/proposal/PDF actually render — never
            // the catalog's full variant list (price/cost included); that
            // duplicated the whole catalog into every quotation payload. The
            // top-level `products` catalog array (`getEditorCatalog()` below,
            // already sent separately) is the picker's data source. See
            // `AGENTS.md`/Phase 3 audit and `QuotationItemVariantSummary` in `@/types`.
            populate: [
              {
                path: "product",
                select: "name code type imageUrl imagePublicId categoryId moduleSize surfaceFinish automationTier notes",
              },
              {
                path: "productVariant",
                select: "surfaceFinish automationTier",
              },
            ],
          },
        ],
      })
      .lean({ virtuals: true }),
    HouseType.find({ isActive: true })
      .sort({ sortOrder: 1 })
      .populate({
        path: "roomTemplate",
        options: { sort: { sortOrder: 1 } },
        populate: { path: "roomType" },
      })
      .lean({ virtuals: true }),
    getEditorCatalog(),
    Category.find({ level: 1 })
      .sort({ sortOrder: 1 })
      .populate({
        path: "children",
        options: { sort: { sortOrder: 1 } },
        populate: {
          path: "children",
          options: { sort: { sortOrder: 1 } },
        },
      })
      .lean({ virtuals: true }),
    RoomType.find({ isActive: true }).sort({ sortOrder: 1 }).lean({ virtuals: true }),
    Company.findOne().lean(),
  ]);

  if (!qDoc) {
    notFound();
  }

  const userRole = (session.user as any)?.role;
  const userId = Number((session.user as any)?.id);

  // IDOR Protection: Dealer can only view and edit their own quotations
  if (!canViewQuotation(userRole, userId, qDoc)) {
    notFound();
  }

  // Fast plain JSON normalization for client component hydration
  const [qDocWithActors] = await attachQuotationActors([qDoc]);
  const quotation = redactQuotationForRole(
    serializeQuotationForClient(normalizeQuotation(JSON.parse(JSON.stringify(qDocWithActors)))),
    userRole
  );
  const houseTypes = normalizeHouseTypes(JSON.parse(JSON.stringify(htDocs)));
  // `products` never carries internal margin fields (cost / purchaseTaxPercent):
  // the editor catalog doesn't select them, so it is the same for every role.
  const categories = normalizeCategories(JSON.parse(JSON.stringify(cDocs)));
  const roomTypes = normalizeRoomTypes(JSON.parse(JSON.stringify(rtDocs)));
  const company = compDoc ? JSON.parse(JSON.stringify(compDoc)) : null;

  // Determine initial step: query param > rooms exist (Step 3) > Step 1
  let step: ProposalStep = 3;
  if (searchParams.step) {
    const parsed = parseInt(searchParams.step, 10);
    if (parsed >= 1 && parsed <= 5) {
      step = parsed as ProposalStep;
    }
  } else if (!quotation.rooms || quotation.rooms.length === 0) {
    step = 2;
  }

  return (
    <div className="w-full mx-auto py-1">
      <ProposalBuilder
        initialQuotation={quotation}
        initialHouseTypes={houseTypes}
        initialProducts={products}
        initialCategories={categories}
        initialRoomTypes={roomTypes}
        initialCompany={company}
        initialStep={step}
      />
    </div>
  );
}
